import jwt from 'jsonwebtoken';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerAccountRepository } from '../../../../infrastructure/persistence/dynamodb/customer-account.repository';
import { CaptchaVerifierService } from '../../../../infrastructure/security/captcha-verifier.service';
import { assertConfiguredSecret } from '../../../../infrastructure/security/security-config';
import { RegisterRequestSchema, type RegisterRequestDto } from '../../docs/schemas';
import { authorizeAppToken } from '../../middleware/app-token.middleware';
import { parseBodyWithSchema, RequestValidationError } from '../../request';
import { fail, ok } from '../../response';

const repository = new CustomerAccountRepository();
const captchaVerifier = new CaptchaVerifierService();
const jwtSecret = assertConfiguredSecret('JWT_SECRET', process.env.JWT_SECRET, process.env.APP_STAGE);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const appAuthError = authorizeAppToken(event);
  if (appAuthError) {
    return appAuthError;
  }

  try {
    const body = parseBodyWithSchema<RegisterRequestDto>(event, RegisterRequestSchema);

    const captchaToken =
      body.captchaToken ??
      event.headers['x-captcha-token'] ??
      event.headers['X-Captcha-Token'];
    if (!(await captchaVerifier.verify(captchaToken, event.requestContext.http.sourceIp))) {
      return fail(401, 'CAPTCHA invalido.');
    }

    const session = await repository.register(body);
    const expiresInSeconds = 2 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    const token = jwt.sign(
      {
        sub: session.userId,
        role: 'ROLE_CUSTOMER',
        tenantId: session.tenantId
      },
      jwtSecret,
      { expiresIn: `${expiresInSeconds}s` }
    );

    return ok(
      {
        token,
        expiresInSeconds,
        expiresAt,
        session: {
          role: 'ROLE_CUSTOMER',
          userName: session.userName,
          tenantName: session.tenantName,
          tenantId: session.tenantId,
          email: session.email
        }
      },
      201
    );
  } catch (error: any) {
    if (error instanceof RequestValidationError) {
      return fail(400, error.message);
    }
    if (error?.name === 'TransactionCanceledException' || error?.name === 'ConditionalCheckFailedException') {
      return fail(409, 'Email ou CPF/CNPJ ja cadastrado.');
    }
    return fail(400, 'Nao foi possivel concluir o cadastro.');
  }
};
