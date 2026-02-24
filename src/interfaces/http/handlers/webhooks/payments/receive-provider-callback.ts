import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CreditPurchaseRequestRepository } from '../../../../../infrastructure/persistence/dynamodb/credit-purchase-request.repository';
import { PaymentGatewayService } from '../../../../../infrastructure/payments/payment-gateway.service';
import { fail, ok } from '../../../response';

const paymentGateway = new PaymentGatewayService();
const requestRepository = new CreditPurchaseRequestRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const provider = event.pathParameters?.provider;
  if (!provider) {
    return fail(400, 'provider obrigatorio.');
  }

  if (!event.body) {
    return fail(400, 'body obrigatorio.');
  }

  try {
    const parsedBody = JSON.parse(event.body) as Record<string, unknown>;
    const webhookEvent = await paymentGateway.parseWebhook(provider, event.queryStringParameters?.productCode, {
      headers: event.headers ?? {},
      body: parsedBody
    });

    const updated = await requestRepository.markPaymentStatusByCharge({
      provider: webhookEvent.provider,
      chargeId: webhookEvent.chargeId,
      status: webhookEvent.status,
      reason: webhookEvent.reason,
      rawPayload: webhookEvent.rawPayload
    });

    if (!updated) {
      return ok({ accepted: true, updated: false, reason: 'request_not_found' }, 202);
    }

    return ok({ accepted: true, updated: true, request: updated });
  } catch (error: any) {
    const message = String(error?.message ?? 'webhook_error');
    if (message === 'WEBHOOK_UNAUTHORIZED') {
      return fail(401, 'Webhook nao autorizado.');
    }
    if (
      message === 'WEBHOOK_PROVIDER_NOT_CONFIGURED' ||
      message === 'WEBHOOK_SECRET_NOT_CONFIGURED' ||
      message === 'WEBHOOK_CHARGE_ID_REQUIRED'
    ) {
      return fail(400, 'Payload de webhook invalido.');
    }
    return fail(400, 'Nao foi possivel processar webhook.');
  }
};

