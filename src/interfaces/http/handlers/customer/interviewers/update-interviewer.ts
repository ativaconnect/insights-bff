import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { InterviewerRepository } from '../../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';

const repository = new InterviewerRepository();

interface UpdateInterviewerRequest {
  name?: string;
  login?: string;
  password?: string;
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

  const interviewerId = event.pathParameters?.interviewerId;
  if (!interviewerId) {
    return fail(400, 'interviewerId obrigatorio.');
  }

  try {
    const body = parseBody<UpdateInterviewerRequest>(event);
    if (body.password && body.password.length < 6) {
      return fail(400, 'Senha deve ter ao menos 6 caracteres.');
    }

    const updated = await repository.update(auth.tenantId, interviewerId, body);
    if (!updated) {
      return fail(404, 'Entrevistador nao encontrado.');
    }

    return ok(updated);
  } catch (error: unknown) {
    const errorName = (error as { name?: string }).name;
    if (errorName === 'TransactionCanceledException' || errorName === 'ConditionalCheckFailedException') {
      return fail(409, 'Login de entrevistador ja cadastrado.');
    }
    return fail(400, 'Nao foi possivel atualizar entrevistador.');
  }
};
