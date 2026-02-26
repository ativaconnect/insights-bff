import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { CreditPurchaseRequestRepository } from '../../../../../infrastructure/persistence/dynamodb/credit-purchase-request.repository';
import { PaymentGatewayService } from '../../../../../infrastructure/payments/payment-gateway.service';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const requestRepository = new CreditPurchaseRequestRepository();
const paymentGateway = new PaymentGatewayService();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  const requestId = String(event.pathParameters?.requestId ?? '').trim();
  if (!requestId) {
    return fail(400, 'requestId obrigatorio.');
  }

  const current = await requestRepository.getByIdForTenant(requestId, auth.tenantId);
  if (!current) {
    return fail(404, 'Solicitacao nao encontrada.');
  }

  if (!current.paymentProvider || current.paymentProvider === 'MANUAL' || !current.paymentChargeId) {
    return ok(current);
  }

  try {
    const lookup = await paymentGateway.lookupChargeStatus({
      productCode: current.productCode,
      provider: current.paymentProvider,
      chargeId: current.paymentChargeId
    });

    const resolvedStatus = lookup?.status ?? current.paymentStatus;
    const shouldReconcile =
      resolvedStatus === 'PAID'
        ? current.status !== 'APPROVED'
        : resolvedStatus === 'FAILED'
          ? current.status !== 'REJECTED'
          : resolvedStatus === 'IN_ANALYSIS'
            ? current.status !== 'IN_ANALYSIS'
            : Boolean(lookup && lookup.status !== current.paymentStatus);

    if (!resolvedStatus || !shouldReconcile) {
      return ok(current);
    }

    const updated = await requestRepository.markPaymentStatusByCharge({
      provider: current.paymentProvider,
      chargeId: current.paymentChargeId,
      status: resolvedStatus,
      reason: lookup?.reason,
      rawPayload: lookup?.rawPayload
    });

    return ok(updated ?? current);
  } catch {
    return ok(current);
  }
};

export const handler = withLoggedHandler('customer/subscription/get-credit-purchase-request-status', rawHandler);
