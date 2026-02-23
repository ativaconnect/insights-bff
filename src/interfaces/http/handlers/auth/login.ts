import jwt from 'jsonwebtoken';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerAccountRepository } from '../../../../infrastructure/persistence/dynamodb/customer-account.repository';
import { InterviewerRepository } from '../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import { parseBody } from '../../request';
import { fail, ok } from '../../response';

interface LoginRequest {
  email: string;
  password: string;
}

const repository = new CustomerAccountRepository();
const interviewerRepository = new InterviewerRepository();
const defaultAdminUser = (process.env.DEFAULT_ADMIN_USER ?? 'admin').trim().toLowerCase();
const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? 'admin123';
const defaultAdminName = process.env.DEFAULT_ADMIN_NAME ?? 'Admin';
const defaultAdminTenantId = process.env.DEFAULT_ADMIN_TENANT_ID ?? 'tenant-owner-admin';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = parseBody<LoginRequest>(event);
    if (!body.email || !body.password) {
      return fail(400, 'Email e senha sao obrigatorios.');
    }

    const loginId = body.email.trim().toLowerCase();
    if (loginId === defaultAdminUser && body.password === defaultAdminPassword) {
      const secret = process.env.JWT_SECRET ?? 'local-dev-secret';
      const expiresInSeconds = 2 * 60 * 60;
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
      const token = jwt.sign(
        {
          sub: 'admin-owner',
          role: 'ROLE_ADMIN',
          tenantId: defaultAdminTenantId
        },
        secret,
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
      const secret = process.env.JWT_SECRET ?? 'local-dev-secret';
      const expiresInSeconds = 2 * 60 * 60;
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
      const token = jwt.sign(
        {
          sub: customerSession.userId,
          role: 'ROLE_CUSTOMER',
          tenantId: customerSession.tenantId
        },
        secret,
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
      return fail(401, 'Credenciais invalidas.');
    }

    const secret = process.env.JWT_SECRET ?? 'local-dev-secret';
    const expiresInSeconds = 2 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const token = jwt.sign(
      {
        sub: interviewerSession.interviewerId,
        role: 'ROLE_INTERVIEWER',
        tenantId: interviewerSession.tenantId,
        interviewerId: interviewerSession.interviewerId
      },
      secret,
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
