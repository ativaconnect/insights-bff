import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { InterviewerRepository } from '../../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import { TenantSubscriptionRepository } from '../../../../../infrastructure/persistence/dynamodb/tenant-subscription.repository';
import {
  CreateInterviewerRequestSchema,
  type CreateInterviewerRequestDto
} from '../../../docs/schemas';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBodyWithSchema, RequestValidationError } from '../../../request';
import { fail, ok } from '../../../response';

const repository = new InterviewerRepository();
const subscriptionRepository = new TenantSubscriptionRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  try {
    const body = parseBodyWithSchema<CreateInterviewerRequestDto>(event, CreateInterviewerRequestSchema);

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
    if (error instanceof RequestValidationError) {
      return fail(400, error.message);
    }
    const errorName = (error as { name?: string }).name;
    if (errorName === 'TransactionCanceledException' || errorName === 'ConditionalCheckFailedException') {
      return fail(409, 'Login de entrevistador ja cadastrado.');
    }
    return fail(400, 'Nao foi possivel cadastrar entrevistador.');
  }
};

export const handler = withLoggedHandler('customer/interviewers/create-interviewer', rawHandler);


