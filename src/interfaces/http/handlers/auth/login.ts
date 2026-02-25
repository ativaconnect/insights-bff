import jwt from 'jsonwebtoken';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerAccountRepository } from '../../../../infrastructure/persistence/dynamodb/customer-account.repository';
import { InterviewerRepository } from '../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import { OwnerAdminUserRepository } from '../../../../infrastructure/persistence/dynamodb/owner-admin-user.repository';
import { CaptchaVerifierService } from '../../../../infrastructure/security/captcha-verifier.service';
import { LoginGuardService } from '../../../../infrastructure/security/login-guard.service';
import { assertConfiguredSecret, isLocalStage } from '../../../../infrastructure/security/security-config';
import { LoginRequestSchema, type LoginRequestDto } from '../../docs/schemas';
import { authorizeAppToken } from '../../middleware/app-token.middleware';
import { parseBodyWithSchema, RequestValidationError } from '../../request';
import { fail, ok } from '../../response';

const repository = new CustomerAccountRepository();
const interviewerRepository = new InterviewerRepository();
const ownerAdminRepository = new OwnerAdminUserRepository();
const loginGuard = new LoginGuardService();
const captchaVerifier = new CaptchaVerifierService();
const jwtSecret = assertConfiguredSecret('JWT_SECRET', process.env.JWT_SECRET, process.env.APP_STAGE);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const appAuthError = authorizeAppToken(event);
  if (appAuthError) {
    return appAuthError;
  }

  try {
    const body = parseBodyWithSchema<LoginRequestDto>(event, LoginRequestSchema);

    const loginId = body.email.trim().toLowerCase();
    const sourceIp = event.requestContext.http.sourceIp;
    const guard = await loginGuard.evaluate(loginId, sourceIp);
    if (guard.blocked) {
      return fail(429, `Muitas tentativas. Tente novamente em ${guard.retryAfterSeconds}s.`);
    }

    const captchaToken =
      body.captchaToken ??
      event.headers['x-captcha-token'] ??
      event.headers['X-Captcha-Token'];
    if ((guard.requiresCaptcha || captchaVerifier.isEnabled()) && !(await captchaVerifier.verify(captchaToken, sourceIp))) {
      await loginGuard.registerFailure(loginId, sourceIp);
      return fail(401, 'CAPTCHA invalido.');
    }

    if (isLocalStage(process.env.APP_STAGE)) {
      await ownerAdminRepository.ensureBootstrapAdmin({
        tenantId: (process.env.DEFAULT_ADMIN_TENANT_ID ?? 'tenant-owner-admin').trim() || 'tenant-owner-admin',
        name: (process.env.DEFAULT_ADMIN_NAME ?? 'Administrador Principal').trim() || 'Administrador Principal',
        email: (process.env.DEFAULT_ADMIN_USER ?? 'admin@ativaconnect.com.br').trim().toLowerCase(),
        password: (process.env.DEFAULT_ADMIN_PASSWORD ?? 'admin123').trim()
      });
    }

    const ownerAdminSession = await ownerAdminRepository.authenticate(body.email, body.password);
    if (ownerAdminSession) {
      await loginGuard.registerSuccess(loginId, sourceIp);
      const expiresInSeconds = 2 * 60 * 60;
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
      const token = jwt.sign(
        {
          sub: ownerAdminSession.id,
          role: 'ROLE_ADMIN',
          tenantId: ownerAdminSession.tenantId,
          adminAccessLevel: ownerAdminSession.accessLevel,
          adminPermissions: ownerAdminSession.permissions
        },
        jwtSecret,
        { expiresIn: `${expiresInSeconds}s` }
      );

      return ok({
        token,
        expiresInSeconds,
        expiresAt,
        session: {
          role: 'ROLE_ADMIN',
          userName: ownerAdminSession.name,
          tenantName: 'Owner SaaS',
          tenantId: ownerAdminSession.tenantId,
          email: ownerAdminSession.email,
          adminAccessLevel: ownerAdminSession.accessLevel,
          adminPermissions: ownerAdminSession.permissions
        }
      });
    }

    const customerSession = await repository.authenticate(body.email, body.password);
    if (customerSession) {
      await loginGuard.registerSuccess(loginId, sourceIp);
      const expiresInSeconds = 2 * 60 * 60;
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
      const token = jwt.sign(
        {
          sub: customerSession.userId,
          role: 'ROLE_CUSTOMER',
          tenantId: customerSession.tenantId
        },
        jwtSecret,
        { expiresIn: `${expiresInSeconds}s` }
      );

      return ok({
        token,
        expiresInSeconds,
        expiresAt,
        session: {
          role: 'ROLE_CUSTOMER',
          userName: customerSession.userName,
          tenantName: customerSession.tenantName,
          tenantId: customerSession.tenantId,
          email: customerSession.email
        }
      });
    }

    const interviewerSession = await interviewerRepository.authenticate(body.email, body.password);
    if (!interviewerSession) {
      await loginGuard.registerFailure(loginId, sourceIp);
      return fail(401, 'Credenciais invalidas.');
    }
    await loginGuard.registerSuccess(loginId, sourceIp);

    const expiresInSeconds = 2 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const token = jwt.sign(
      {
        sub: interviewerSession.interviewerId,
        role: 'ROLE_INTERVIEWER',
        tenantId: interviewerSession.tenantId,
        interviewerId: interviewerSession.interviewerId
      },
      jwtSecret,
      { expiresIn: `${expiresInSeconds}s` }
    );

    return ok({
      token,
      expiresInSeconds,
      expiresAt,
      session: {
        role: 'ROLE_INTERVIEWER',
        userName: interviewerSession.interviewerName,
        tenantName: 'Operacao de Campo',
        tenantId: interviewerSession.tenantId,
        email: interviewerSession.login
      }
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return fail(400, error.message);
    }
    return fail(400, 'Nao foi possivel efetuar login.');
  }
};
