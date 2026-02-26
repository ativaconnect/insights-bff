import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

const repository = new AdminOwnerRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const plans = await repository.listPlanDefinitions(productCode);
  return ok(plans);
};

export const handler = withLoggedHandler('admin/plans/list-plan-definitions', rawHandler);


