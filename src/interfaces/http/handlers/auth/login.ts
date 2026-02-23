import jwt from 'jsonwebtoken';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerAccountRepository } from '../../../../infrastructure/persistence/dynamodb/customer-account.repository';
import { InterviewerRepository } from '../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import { CaptchaVerifierService } from '../../../../infrastructure/security/captcha-verifier.service';
import { LoginGuardService } from '../../../../infrastructure/security/login-guard.service';
import { assertConfiguredSecret } from '../../../../infrastructure/security/security-config';
import { authorizeAppToken } from '../../middleware/app-token.middleware';
import { parseBody } from '../../request';
import { fail, ok } from '../../response';

interface LoginRequest {
  email: string;
  password: string;
  captchaToken?: string;
}

const repository = new CustomerAccountRepository();
const interviewerRepository = new InterviewerRepository();
const loginGuard = new LoginGuardService();
const captchaVerifier = new CaptchaVerifierService();
const appStage = (process.env.APP_STAGE ?? 'local').trim().toLowerCase();
const defaultAdminUser = (process.env.DEFAULT_ADMIN_USER ?? '').trim().toLowerCase();
const defaultAdminPassword = (process.env.DEFAULT_ADMIN_PASSWORD ?? '').trim();
const defaultAdminName = process.env.DEFAULT_ADMIN_NAME ?? 'Admin';
const defaultAdminTenantId = process.env.DEFAULT_ADMIN_TENANT_ID ?? 'tenant-owner-admin';
const jwtSecret = assertConfiguredSecret('JWT_SECRET', process.env.JWT_SECRET, process.env.APP_STAGE);

const isDefaultAdminEnabled = appStage === 'local'
  ? defaultAdminUser.length > 0 && defaultAdminPassword.length > 0
  : false;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const appAuthError = authorizeAppToken(event);
  if (appAuthError) {
    return appAuthError;
  }

  try {
    const body = parseBody<LoginRequest>(event);
    if (!body.email || !body.password) {
      return fail(400, 'Email e senha sao obrigatorios.');
    }

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

    if (isDefaultAdminEnabled && loginId === defaultAdminUser && body.password === defaultAdminPassword) {
      await loginGuard.registerSuccess(loginId, sourceIp);
      const expiresInSeconds = 2 * 60 * 60;
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
      const token = jwt.sign(
        {
          sub: 'admin-owner',
          role: 'ROLE_ADMIN',
          tenantId: defaultAdminTenantId
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
          userName: defaultAdminName,
          tenantName: 'Owner SaaS',
          tenantId: defaultAdminTenantId,
          email: defaultAdminUser
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
  } catch {
    return fail(400, 'Nao foi possivel efetuar login.');
  }
};
