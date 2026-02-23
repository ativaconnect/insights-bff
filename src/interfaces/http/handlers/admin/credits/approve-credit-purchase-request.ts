import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CreditPurchaseRequestRepository } from '../../../../../infrastructure/persistence/dynamodb/credit-purchase-request.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

interface ApproveRequestBody {
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
    const body: ApproveRequestBody = event.body ? (JSON.parse(event.body) as ApproveRequestBody) : {};
    const approved = await repository.approveRequest(requestId, auth.subject, body.note);
    if (!approved) {
      return fail(404, 'Solicitacao nao encontrada.');
    }
    return ok(approved);
  } catch (error: any) {
    if (error?.message === 'REQUEST_NOT_PENDING') {
      return fail(409, 'A solicitacao ja foi analisada.');
    }
    if (error?.message === 'PLAN_NOT_AVAILABLE') {
      return fail(422, 'Plano solicitado indisponivel.');
    }
    if (error?.name === 'ConditionalCheckFailedException') {
      return fail(409, 'A solicitacao ja foi analisada por outro administrador.');
    }
    return fail(400, 'Nao foi possivel aprovar a solicitacao.');
  }
};
