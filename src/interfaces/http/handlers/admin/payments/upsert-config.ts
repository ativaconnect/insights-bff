import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { PaymentGatewayConfigRepository } from '../../../../../infrastructure/persistence/dynamodb/payment-gateway-config.repository';
import { normalizeProductCode } from '../../../../../shared/products';
import {
  normalizePaymentMethod,
  normalizePaymentProvider,
  type PaymentMethodCode,
  type PaymentProviderCode
} from '../../../../../shared/payments';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';

interface UpsertPaymentConfigBody {
  productCode?: string;
  provider: PaymentProviderCode;
  enabledMethods?: PaymentMethodCode[];
  providerApiBaseUrl?: string;
  providerApiToken?: string;
  webhookSecret?: string;
  pixKey?: string;
  merchantName?: string;
}

const repository = new PaymentGatewayConfigRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  try {
    const body = parseBody<UpsertPaymentConfigBody>(event);
    const productCode = normalizeProductCode(body.productCode);
    const provider = normalizePaymentProvider(body.provider);
    const enabledMethods = (body.enabledMethods ?? ['PIX', 'CREDIT_CARD']).map((method) =>
      normalizePaymentMethod(method)
    );

    if (!enabledMethods.length) {
      return fail(400, 'enabledMethods obrigatorio.');
    }

    const updated = await repository.upsert(productCode, auth.subject, {
      provider,
      enabledMethods,
      providerApiBaseUrl: body.providerApiBaseUrl,
      providerApiToken: body.providerApiToken,
      webhookSecret: body.webhookSecret,
      pixKey: body.pixKey,
      merchantName: body.merchantName
    });

    return ok(updated);
  } catch {
    return fail(400, 'Nao foi possivel salvar configuracao de pagamentos.');
  }
};

export const handler = withLoggedHandler('admin/payments/upsert-config', rawHandler);


