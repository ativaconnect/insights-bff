import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerAccountRepository } from '../../../../../infrastructure/persistence/dynamodb/customer-account.repository';
import { CreditPurchaseRequestRepository } from '../../../../../infrastructure/persistence/dynamodb/credit-purchase-request.repository';
import { PaymentGatewayConfigRepository } from '../../../../../infrastructure/persistence/dynamodb/payment-gateway-config.repository';
import { PaymentGatewayService } from '../../../../../infrastructure/payments/payment-gateway.service';
import { normalizePaymentMethod } from '../../../../../shared/payments';
import {
  CreditPurchaseRequestInputSchema,
  type CreditPurchaseRequestInputDto
} from '../../../docs/schemas';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBodyWithSchema, RequestValidationError } from '../../../request';
import { fail, ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

const repository = new CreditPurchaseRequestRepository();
const profileRepository = new CustomerAccountRepository();
const paymentGateway = new PaymentGatewayService();
const paymentConfigRepository = new PaymentGatewayConfigRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  try {
    const body = parseBodyWithSchema<CreditPurchaseRequestInputDto>(event, CreditPurchaseRequestInputSchema);

    const credits = Number(body.credits);
    if (!Number.isInteger(credits) || credits <= 0) {
      return fail(400, 'Quantidade de creditos invalida.');
    }
    const productCode = normalizeProductCode(body.productCode);
    const paymentMethod = normalizePaymentMethod(body.paymentMethod);
    const paymentConfig = await paymentConfigRepository.getPrivate(productCode);
    const provider = paymentConfig?.provider;

    const baseRequest = await repository.createRequest({
      tenantId: auth.tenantId,
      requesterUserId: auth.subject,
      productCode,
      requestedPlanCode: body.planCode,
      requestedCredits: credits,
      paymentMethod,
      paymentProvider: provider,
      paymentStatus: provider && provider !== 'MANUAL' ? 'AWAITING_PAYMENT' : undefined,
      note: body.note
    });

    if (!paymentConfig || paymentConfig.provider === 'MANUAL') {
      return ok(baseRequest, 201);
    }

    const profile = await profileRepository.getProfile(auth.tenantId);
    const charge = await paymentGateway.createCharge({
      productCode,
      requestId: baseRequest.id,
      tenantId: auth.tenantId,
      amount: Number(baseRequest.estimatedAmount ?? 0),
      credits: baseRequest.requestedCredits,
      planCode: baseRequest.requestedPlanCode,
      paymentMethod,
      customer: {
        name: profile?.tradeName || profile?.legalName,
        email: profile?.email,
        document: profile?.document
      }
    });

    if (!charge) {
      return ok(baseRequest, 201);
    }

    const created = await repository.attachPaymentCharge(baseRequest.id, {
      provider: charge.provider,
      method: paymentMethod,
      chargeId: charge.chargeId,
      status: charge.status,
      checkoutUrl: charge.checkoutUrl,
      pixQrCode: charge.pixQrCode,
      pixCopyPaste: charge.pixCopyPaste,
      raw: charge.raw
    });

    return ok(created ?? baseRequest, 201);
  } catch (error: any) {
    if (error instanceof RequestValidationError) {
      return fail(400, error.message);
    }
    if (error?.message === 'PLAN_NOT_AVAILABLE') {
      return fail(422, 'Plano informado indisponivel para solicitacao.');
    }
    if (error?.message === 'PLAN_NOT_PURCHASABLE') {
      return fail(422, 'Plano START nao esta disponivel para compra.');
    }
    if (error?.message === 'INVALID_CREDITS') {
      return fail(400, 'Quantidade de creditos invalida.');
    }
    if (error?.message === 'REQUEST_ALREADY_PENDING') {
      return fail(409, 'Ja existe uma solicitacao pendente. Aguarde aprovacao para solicitar novamente.');
    }
    if (error?.message === 'PAYMENT_METHOD_NOT_ENABLED') {
      return fail(422, 'Metodo de pagamento nao habilitado.');
    }
    return fail(400, 'Nao foi possivel solicitar compra de creditos.');
  }
};
