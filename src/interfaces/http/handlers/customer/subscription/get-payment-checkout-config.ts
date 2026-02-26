import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { PaymentGatewayConfigRepository } from '../../../../../infrastructure/persistence/dynamodb/payment-gateway-config.repository';
import { normalizeProductCode } from '../../../../../shared/products';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { ok } from '../../../response';

const repository = new PaymentGatewayConfigRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const config = await repository.get(productCode);

  return ok({
    productCode,
    provider: config?.provider ?? 'MANUAL',
    enabledMethods: config?.enabledMethods ?? ['PIX', 'CREDIT_CARD'],
    pagSeguroPublicKey: config?.pagSeguroPublicKey,
    merchantName: config?.merchantName,
    pixKey: config?.pixKey,
    checkoutTransparentScriptUrl: 'https://assets.pagseguro.com.br/checkout-sdk-js/rc/dist/browser/pagseguro.min.js'
  });
};

export const handler = withLoggedHandler('customer/subscription/get-payment-checkout-config', rawHandler);
