import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import {
  CreditPurchaseRequestRepository,
  type CreditPurchaseRequestStatus
} from '../../../../../infrastructure/persistence/dynamodb/credit-purchase-request.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

const repository = new CreditPurchaseRequestRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const rawStatus = event.queryStringParameters?.status;
  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const normalized = rawStatus?.trim().toUpperCase();
  const allowed =
    normalized === 'PENDING' ||
    normalized === 'IN_ANALYSIS' ||
    normalized === 'APPROVED' ||
    normalized === 'REJECTED';
  const status = (allowed ? normalized : undefined) as CreditPurchaseRequestStatus | undefined;

  const requests = await repository.listForAdmin(status, productCode);
  return ok(requests);
};

export const handler = withLoggedHandler('admin/credits/list-credit-purchase-requests', rawHandler);


