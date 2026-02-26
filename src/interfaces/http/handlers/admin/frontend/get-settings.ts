import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { FrontendSettingsRepository } from '../../../../../infrastructure/persistence/dynamodb/frontend-settings.repository';
import { normalizeProductCode } from '../../../../../shared/products';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { ok } from '../../../response';

const repository = new FrontendSettingsRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const settings = await repository.getOrDefault(productCode);
  return ok(settings);
};

export const handler = withLoggedHandler('admin/frontend/get-settings', rawHandler);


