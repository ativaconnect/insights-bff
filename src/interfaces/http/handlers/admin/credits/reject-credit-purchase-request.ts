import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CreditPurchaseRequestRepository } from '../../../../../infrastructure/persistence/dynamodb/credit-purchase-request.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

interface RejectRequestBody {
  note?: string;
}

const repository = new CreditPurchaseRequestRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const requestId = event.pathParameters?.requestId;
  if (!requestId) {
    return fail(400, 'requestId obrigatorio.');
  }

  try {
    const body: RejectRequestBody = event.body ? (JSON.parse(event.body) as RejectRequestBody) : {};
    const rejected = await repository.rejectRequest(requestId, auth.subject, body.note);
    if (!rejected) {
      return fail(404, 'Solicitacao nao encontrada.');
    }
    return ok(rejected);
  } catch (error: any) {
    if (error?.message === 'REQUEST_NOT_PENDING') {
      return fail(409, 'A solicitacao ja foi analisada.');
    }
    if (error?.name === 'ConditionalCheckFailedException') {
      return fail(409, 'A solicitacao ja foi analisada por outro administrador.');
    }
    return fail(400, 'Nao foi possivel reprovar a solicitacao.');
  }
};
