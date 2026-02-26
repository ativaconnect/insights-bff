import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import { authorizeAppToken } from '../../../middleware/app-token.middleware';
import { ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

const repository = new AdminOwnerRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const appAuthError = authorizeAppToken(event);
  if (appAuthError) {
    return appAuthError;
  }

  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const plans = await repository.listActivePlansForCatalog(productCode);
  return ok(plans);
};

export const handler = withLoggedHandler('public/plans/list-catalog', rawHandler);


