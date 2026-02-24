import { randomUUID } from 'crypto';
import { PaymentGatewayConfigRepository } from '../persistence/dynamodb/payment-gateway-config.repository';
import { normalizeProductCode } from '../../shared/products';
import {
  normalizePaymentChargeStatus,
  normalizePaymentMethod,
  normalizePaymentProvider,
  type PaymentChargeStatus,
  type PaymentMethodCode,
  type PaymentProviderCode
} from '../../shared/payments';

interface PaymentGatewayConfigPrivate {
  productCode: string;
  provider: PaymentProviderCode;
  enabledMethods: PaymentMethodCode[];
  providerApiBaseUrl?: string;
  providerApiToken?: string;
  webhookSecret?: string;
  pixKey?: string;
  merchantName?: string;
}

export interface CreatePaymentChargeInput {
  productCode: string;
  requestId: string;
  tenantId: string;
  amount: number;
  credits: number;
  planCode: string;
  paymentMethod: PaymentMethodCode;
  customer: {
    name?: string;
    email?: string;
    document?: string;
  };
}

export interface PaymentChargeResult {
  provider: PaymentProviderCode;
  chargeId: string;
  status: PaymentChargeStatus;
  checkoutUrl?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  raw?: Record<string, unknown>;
}

export interface WebhookPaymentEvent {
  productCode: string;
  provider: PaymentProviderCode;
  chargeId: string;
  status: PaymentChargeStatus;
  receivedAt: string;
  reason?: string;
  rawPayload?: Record<string, unknown>;
}

const toNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export class PaymentGatewayService {
  private readonly configRepository = new PaymentGatewayConfigRepository();

  async createCharge(input: CreatePaymentChargeInput): Promise<PaymentChargeResult | null> {
    const config = await this.getConfig(input.productCode);
    if (!config || config.provider === 'MANUAL') {
      return null;
    }

    const method = normalizePaymentMethod(input.paymentMethod);
    if (!config.enabledMethods.includes(method)) {
      throw new Error('PAYMENT_METHOD_NOT_ENABLED');
    }

    const payload = {
      referenceId: input.requestId,
      tenantId: input.tenantId,
      amount: Number(input.amount.toFixed(2)),
      credits: input.credits,
      planCode: input.planCode,
      method,
      productCode: normalizeProductCode(input.productCode),
      customer: input.customer
    };

    if (!config.providerApiBaseUrl || !config.providerApiToken) {
      return this.mockCharge(config.provider, method, payload);
    }

    try {
      const response = await fetch(`${config.providerApiBaseUrl.replace(/\/$/, '')}/charges`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.providerApiToken}`
        },
        body: JSON.stringify(payload)
      });

      const rawPayload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(`PAYMENT_PROVIDER_ERROR_${response.status}`);
      }

      const chargeId = String(
        rawPayload.chargeId ??
        rawPayload.id ??
        rawPayload.referenceId ??
        randomUUID()
      );
      const status = normalizePaymentChargeStatus(String(rawPayload.status ?? 'AWAITING_PAYMENT'));
      const checkoutUrl = typeof rawPayload.checkoutUrl === 'string' ? rawPayload.checkoutUrl : undefined;
      const pixQrCode = typeof rawPayload.pixQrCode === 'string' ? rawPayload.pixQrCode : undefined;
      const pixCopyPaste = typeof rawPayload.pixCopyPaste === 'string' ? rawPayload.pixCopyPaste : undefined;

      return {
        provider: config.provider,
        chargeId,
        status,
        checkoutUrl,
        pixQrCode,
        pixCopyPaste,
        raw: rawPayload
      };
    } catch {
      return this.mockCharge(config.provider, method, payload);
    }
  }

  async parseWebhook(
    providerRaw: string,
    productCodeRaw: string | undefined,
    event: {
      headers: Record<string, string | undefined>;
      body: Record<string, unknown>;
    }
  ): Promise<WebhookPaymentEvent> {
    const provider = normalizePaymentProvider(providerRaw);
    const productCode = normalizeProductCode(productCodeRaw);
    const config = await this.getConfig(productCode);
    if (!config || config.provider !== provider) {
      throw new Error('WEBHOOK_PROVIDER_NOT_CONFIGURED');
    }

    if (!config.webhookSecret) {
      throw new Error('WEBHOOK_SECRET_NOT_CONFIGURED');
    }

    const receivedToken = event.headers['x-webhook-token'] ?? event.headers['X-Webhook-Token'];
    if (!receivedToken || receivedToken.trim() !== config.webhookSecret) {
      throw new Error('WEBHOOK_UNAUTHORIZED');
    }

    const body = event.body ?? {};
    const chargeIdRaw =
      body['chargeId'] ??
      body['id'] ??
      body['paymentId'] ??
      body['referenceId'];
    const chargeId = String(chargeIdRaw ?? '').trim();
    if (!chargeId) {
      throw new Error('WEBHOOK_CHARGE_ID_REQUIRED');
    }

    const statusRaw =
      body['status'] ??
      body['event'] ??
      body['paymentStatus'] ??
      body['transactionStatus'];
    const status = this.normalizeWebhookStatus(statusRaw);
    const reason = typeof body['reason'] === 'string' ? body['reason'] : undefined;

    return {
      productCode,
      provider,
      chargeId,
      status,
      receivedAt: new Date().toISOString(),
      reason,
      rawPayload: body
    };
  }

  private async getConfig(productCode: string): Promise<PaymentGatewayConfigPrivate | null> {
    const record = await this.configRepository.getPrivate(productCode);
    if (!record) {
      return null;
    }

    return {
      productCode: normalizeProductCode(record.productCode),
      provider: normalizePaymentProvider(record.provider),
      enabledMethods: (record.enabledMethods ?? []).map((method) => normalizePaymentMethod(method)),
      providerApiBaseUrl: record.providerApiBaseUrl,
      providerApiToken: record.providerApiToken,
      webhookSecret: record.webhookSecret,
      pixKey: record.pixKey,
      merchantName: record.merchantName
    };
  }

  private mockCharge(
    provider: PaymentProviderCode,
    method: PaymentMethodCode,
    payload: Record<string, unknown>
  ): PaymentChargeResult {
    const chargeId = `${provider.toLowerCase()}-${randomUUID()}`;
    const checkoutUrl = method === 'CREDIT_CARD'
      ? `https://checkout.${provider.toLowerCase()}.example/pay/${chargeId}`
      : undefined;
    const pixCopyPaste = method === 'PIX'
      ? `00020101021226890014BR.GOV.BCB.PIX0114+55119999999990218Ativa Connect 5204000053039865802BR5925ATIVA CONNECT TECNOLOGIA6009SAO PAULO62140510${chargeId.slice(0, 10)}6304ABCD`
      : undefined;
    const pixQrCode = method === 'PIX' ? `PIX:${chargeId}` : undefined;

    return {
      provider,
      chargeId,
      status: 'AWAITING_PAYMENT',
      checkoutUrl,
      pixQrCode,
      pixCopyPaste,
      raw: payload
    };
  }

  private normalizeWebhookStatus(raw: unknown): PaymentChargeStatus {
    const value = String(raw ?? '').trim().toUpperCase();
    if (['PAID', 'APPROVED', 'CONFIRMED', 'PAYMENT_APPROVED', 'PAYMENT.PAID'].includes(value)) {
      return 'PAID';
    }
    if (['FAILED', 'REJECTED', 'DECLINED', 'CANCELED', 'CANCELLED', 'PAYMENT.REJECTED'].includes(value)) {
      return 'FAILED';
    }
    if (['IN_ANALYSIS', 'UNDER_REVIEW', 'ANALYSIS', 'WAITING_REVIEW', 'PAYMENT.IN_ANALYSIS'].includes(value)) {
      return 'IN_ANALYSIS';
    }
    const asNumber = toNumber(raw);
    if (asNumber === 3) return 'PAID';
    if (asNumber === 7 || asNumber === 8) return 'FAILED';
    if (asNumber === 2 || asNumber === 12) return 'IN_ANALYSIS';
    return 'AWAITING_PAYMENT';
  }
}

