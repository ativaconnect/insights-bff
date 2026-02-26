import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { InterviewerRepository } from '../../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const repository = new InterviewerRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
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
    const removed = await repository.removeIfUnused(auth.tenantId, interviewerId);
    if (removed === 'not_found') {
      return fail(404, 'Entrevistador nao encontrado.');
    }
    if (removed === 'in_use') {
      return fail(409, 'Entrevistador vinculado a pesquisa/respostas e nao pode ser removido.');
    }

    return ok({ deleted: true });
  } catch {
    return fail(400, 'Nao foi possivel remover entrevistador.');
  }
};

export const handler = withLoggedHandler('customer/interviewers/delete-interviewer', rawHandler);


