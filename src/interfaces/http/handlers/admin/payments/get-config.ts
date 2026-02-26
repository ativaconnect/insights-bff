import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { PaymentGatewayConfigRepository } from '../../../../../infrastructure/persistence/dynamodb/payment-gateway-config.repository';
import { normalizeProductCode } from '../../../../../shared/products';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { ok } from '../../../response';

const repository = new PaymentGatewayConfigRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const config = await repository.get(productCode);
  return ok(
    config ?? {
      productCode,
      provider: 'MANUAL',
      enabledMethods: ['PIX', 'CREDIT_CARD'],
      hasProviderApiToken: false,
      hasWebhookSecret: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      updatedBy: 'system'
    }
  );
};

export const handler = withLoggedHandler('admin/payments/get-config', rawHandler);


