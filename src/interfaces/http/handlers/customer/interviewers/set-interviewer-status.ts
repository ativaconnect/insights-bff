import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { InterviewerRepository } from '../../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';

const repository = new InterviewerRepository();

interface SetStatusRequest {
  status: 'active' | 'inactive';
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
    const body = parseBody<SetStatusRequest>(event);
    if (body.status !== 'active' && body.status !== 'inactive') {
      return fail(400, 'Status invalido.');
    }

    const updated = await repository.setStatus(auth.tenantId, interviewerId, body.status);
    if (!updated) {
      return fail(404, 'Entrevistador nao encontrado.');
    }

    return ok(updated);
  } catch {
    return fail(400, 'Nao foi possivel alterar status do entrevistador.');
  }
};
