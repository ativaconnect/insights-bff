import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { InterviewerRepository } from '../../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import { TenantSubscriptionRepository } from '../../../../../infrastructure/persistence/dynamodb/tenant-subscription.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';

const repository = new InterviewerRepository();
const subscriptionRepository = new TenantSubscriptionRepository();

interface CreateInterviewerRequest {
  name: string;
  login: string;
  password: string;
  phone?: string;
  email?: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  try {
    const body = parseBody<CreateInterviewerRequest>(event);
    if (!body.name || !body.login || !body.password) {
      return fail(400, 'Nome, login e senha sao obrigatorios.');
    }
    if (body.password.length < 6) {
      return fail(400, 'Senha deve ter ao menos 6 caracteres.');
    }

    const subscription = await subscriptionRepository.getSnapshot(auth.tenantId);
    if (!subscription) {
      return fail(404, 'Perfil de assinatura nao encontrado.');
    }
    const interviewers = await repository.list(auth.tenantId);
    if (interviewers.length >= subscription.limits.maxInterviewers) {
      return fail(422, `Seu plano permite no maximo ${subscription.limits.maxInterviewers} entrevistador(es).`);
    }

    const interviewer = await repository.create(auth.tenantId, {
      name: body.name,
      login: body.login,
      password: body.password,
      phone: body.phone,
      email: body.email
    });

    return ok(interviewer, 201);
  } catch (error: unknown) {
    const errorName = (error as { name?: string }).name;
    if (errorName === 'TransactionCanceledException' || errorName === 'ConditionalCheckFailedException') {
      return fail(409, 'Login de entrevistador ja cadastrado.');
    }
    return fail(400, 'Nao foi possivel cadastrar entrevistador.');
  }
};
