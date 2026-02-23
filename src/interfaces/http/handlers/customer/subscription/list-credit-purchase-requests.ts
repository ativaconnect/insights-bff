import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CreditPurchaseRequestRepository } from '../../../../../infrastructure/persistence/dynamodb/credit-purchase-request.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

const repository = new CreditPurchaseRequestRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(401, 'Tenant nao identificado.');
  }

  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const items = await repository.listByTenant(auth.tenantId, productCode);
  return ok(items);
};
