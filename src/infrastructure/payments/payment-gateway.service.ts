import { randomUUID } from 'crypto';
import { PaymentGatewayConfigRepository } from '../persistence/dynamodb/payment-gateway-config.repository';
import { logger } from '../observability/logger';
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
  pagSeguroPublicKey?: string;
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
  cardToken?: string;
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

export interface PaymentChargeLookupResult {
  provider: PaymentProviderCode;
  chargeId: string;
  status: PaymentChargeStatus;
  reason?: string;
  rawPayload?: Record<string, unknown>;
}

const toNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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
      cardToken: input.cardToken,
      customer: input.customer
    };

    if (!config.providerApiBaseUrl || !config.providerApiToken) {
      if (config.provider === 'PAGSEGURO') {
        throw new Error('PAGSEGURO_CONFIG_INCOMPLETE');
      }
      return this.mockCharge(config.provider, method, payload);
    }

    try {
      if (config.provider === 'PAGSEGURO') {
        logger.info('payments.pagseguro.create_order.request', {
          referenceId: payload.referenceId,
          tenantId: payload.tenantId,
          method: payload.method,
          amount: payload.amount
        });
        return await this.createPagSeguroCharge(config, payload);
      }

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

      const chargeId = String(rawPayload.chargeId ?? rawPayload.id ?? rawPayload.referenceId ?? randomUUID());
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
    } catch (error: any) {
      if (String(error?.message ?? '').includes('CARD_TOKEN_REQUIRED')) {
        throw error;
      }
      if (config.provider === 'PAGSEGURO') {
        logger.error('payments.pagseguro.create_order.failed', {
          referenceId: payload.referenceId,
          tenantId: payload.tenantId,
          method: payload.method,
          message: String(error?.message ?? 'unknown_error')
        });
        throw error;
      }
      return this.mockCharge(config.provider, method, payload);
    }
  }

  async lookupChargeStatus(input: {
    productCode: string;
    provider: PaymentProviderCode;
    chargeId: string;
  }): Promise<PaymentChargeLookupResult | null> {
    const provider = normalizePaymentProvider(input.provider);
    const chargeId = String(input.chargeId ?? '').trim();
    if (!chargeId) {
      return null;
    }

    const config = await this.getConfig(input.productCode);
    if (!config || config.provider !== provider || !config.providerApiBaseUrl || !config.providerApiToken) {
      return null;
    }

    if (provider === 'PAGSEGURO') {
      return this.fetchPagSeguroCharge(config, chargeId);
    }

    return null;
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
    let chargeId = this.extractChargeId(body);
    if (!chargeId) {
      throw new Error('WEBHOOK_CHARGE_ID_REQUIRED');
    }

    const statusRaw =
      body['status'] ??
      body['event'] ??
      body['paymentStatus'] ??
      body['transactionStatus'];

    let status = this.normalizeWebhookStatus(statusRaw);
    let reason = typeof body['reason'] === 'string' ? body['reason'] : undefined;
    let rawPayload = body;

    if (provider === 'PAGSEGURO') {
      const lookedUp = await this.fetchPagSeguroCharge(config, chargeId);
      chargeId = lookedUp.chargeId;
      status = lookedUp.status;
      reason = lookedUp.reason ?? reason;
      rawPayload = lookedUp.rawPayload ?? rawPayload;
    }

    return {
      productCode,
      provider,
      chargeId,
      status,
      receivedAt: new Date().toISOString(),
      reason,
      rawPayload
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
      pagSeguroPublicKey: record.pagSeguroPublicKey,
      webhookSecret: record.webhookSecret,
      pixKey: record.pixKey,
      merchantName: record.merchantName
    };
  }

  private async createPagSeguroCharge(
    config: PaymentGatewayConfigPrivate,
    payload: {
      referenceId: string;
      tenantId: string;
      amount: number;
      credits: number;
      planCode: string;
      method: PaymentMethodCode;
      productCode: string;
      cardToken?: string;
      customer: {
        name?: string;
        email?: string;
        document?: string;
      };
    }
  ): Promise<PaymentChargeResult> {
    const baseUrl = config.providerApiBaseUrl?.replace(/\/$/, '');
    const amountInCents = Math.max(100, Math.round(Number(payload.amount ?? 0) * 100));
    const webhookUrl = this.buildProviderWebhookUrl(payload.productCode, 'pagseguro');

    const response = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.providerApiToken}`,
        'x-idempotency-key': payload.referenceId
      },
      body: JSON.stringify({
        reference_id: payload.referenceId,
        customer: {
          name: payload.customer.name,
          email: payload.customer.email,
          tax_id: payload.customer.document
        },
        items: [
          {
            reference_id: payload.planCode,
            name: `Creditos ${payload.productCode}`,
            quantity: 1,
            unit_amount: amountInCents
          }
        ],
        charges: [
          {
            reference_id: payload.referenceId,
            description: `${payload.credits} creditos de questionario`,
            amount: {
              value: amountInCents,
              currency: 'BRL'
            },
            payment_method: this.pagSeguroPaymentMethod(payload),
            notification_urls: webhookUrl ? [webhookUrl] : []
          }
        ]
      })
    });

    logger.info('payments.pagseguro.notification_url', {
      referenceId: payload.referenceId,
      webhookUrl
    });

    const rawPayload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    logger.info('payments.pagseguro.create_order.response', {
      status: response.status,
      ok: response.ok,
      orderId: rawPayload['id'],
      referenceId: rawPayload['reference_id'],
      notificationUrls: rawPayload['notification_urls'],
      charges: rawPayload['charges']
    });
    if (!response.ok) {
      logger.warn('payments.pagseguro.create_order.provider_error', {
        status: response.status,
        payload: rawPayload
      });
      throw new Error(`PAGSEGURO_CREATE_ORDER_ERROR_${response.status}`);
    }

    const charge = this.extractPrimaryCharge(rawPayload);
    const chargeId = String(charge?.id ?? rawPayload.id ?? payload.referenceId);
    const status = this.normalizeWebhookStatus(charge?.status ?? rawPayload.status);

    return {
      provider: 'PAGSEGURO',
      chargeId,
      status,
      checkoutUrl: this.extractCheckoutUrl(charge, rawPayload),
      pixQrCode: this.extractPixCode(charge),
      pixCopyPaste: this.extractPixCode(charge),
      raw: rawPayload
    };
  }

  private pagSeguroPaymentMethod(payload: { method: PaymentMethodCode; cardToken?: string }): Record<string, unknown> {
    if (payload.method === 'CREDIT_CARD') {
      const encryptedCard = String(payload.cardToken ?? '').trim();
      if (!encryptedCard) {
        throw new Error('PAGSEGURO_CARD_TOKEN_REQUIRED');
      }
      return {
        type: 'CREDIT_CARD',
        installments: 1,
        capture: true,
        card: {
          encrypted: encryptedCard,
          store: false
        }
      };
    }

    return {
      type: 'PIX'
    };
  }

  private async fetchPagSeguroCharge(
    config: PaymentGatewayConfigPrivate,
    chargeId: string
  ): Promise<PaymentChargeLookupResult> {
    const baseUrl = config.providerApiBaseUrl?.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/charges/${encodeURIComponent(chargeId)}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${config.providerApiToken}`
      }
    });

    if (!response.ok) {
      const orderResponse = await fetch(`${baseUrl}/orders/${encodeURIComponent(chargeId)}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${config.providerApiToken}`
        }
      });
      if (!orderResponse.ok) {
        throw new Error(`PAGSEGURO_FETCH_CHARGE_ERROR_${response.status}`);
      }
      const orderPayload = (await orderResponse.json().catch(() => ({}))) as Record<string, unknown>;
      const orderCharge = this.extractPrimaryCharge(orderPayload);
      if (!orderCharge?.id) {
        throw new Error('PAGSEGURO_ORDER_WITHOUT_CHARGE');
      }
      return {
        provider: 'PAGSEGURO',
        chargeId: String(orderCharge.id),
        status: this.normalizeWebhookStatus(orderCharge.status),
        rawPayload: orderPayload
      };
    }

    const rawPayload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      provider: 'PAGSEGURO',
      chargeId: String(rawPayload.id ?? chargeId),
      status: this.normalizeWebhookStatus(rawPayload.status),
      rawPayload
    };
  }

  private extractPrimaryCharge(rawPayload: Record<string, unknown>): Record<string, unknown> | null {
    const charges = rawPayload['charges'];
    if (!Array.isArray(charges) || !charges.length) {
      return null;
    }
    return asRecord(charges[0]);
  }

  private extractCheckoutUrl(charge: Record<string, unknown> | null, rawPayload: Record<string, unknown>): string | undefined {
    const fromCharge = this.findHttpLink(charge?.['links']);
    if (fromCharge) {
      return fromCharge;
    }
    return this.findHttpLink(rawPayload['links']);
  }

  private findHttpLink(rawLinks: unknown): string | undefined {
    if (!Array.isArray(rawLinks)) {
      return undefined;
    }
    for (const item of rawLinks) {
      const link = asRecord(item);
      if (!link) continue;
      if (typeof link['href'] === 'string' && link['href'].startsWith('http')) {
        return link['href'];
      }
    }
    return undefined;
  }

  private extractPixCode(charge: Record<string, unknown> | null): string | undefined {
    const paymentResponse = asRecord(charge?.['payment_response']);
    const qrCodes = paymentResponse?.['qr_codes'];
    if (!Array.isArray(qrCodes) || !qrCodes.length) {
      return undefined;
    }
    const first = asRecord(qrCodes[0]);
    if (!first || typeof first['text'] !== 'string') {
      return undefined;
    }
    return first['text'];
  }

  private extractChargeId(body: Record<string, unknown>): string {
    const chargeIdRaw =
      body['chargeId'] ??
      body['id'] ??
      body['paymentId'] ??
      body['referenceId'] ??
      asRecord(body['data'])?.['id'] ??
      asRecord(body['charge'])?.['id'] ??
      this.extractChargeIdFromCharges(body['charges']);

    return String(chargeIdRaw ?? '').trim();
  }

  private extractChargeIdFromCharges(charges: unknown): string | null {
    if (!Array.isArray(charges) || !charges.length) {
      return null;
    }
    const first = asRecord(charges[0]);
    const id = first?.['id'];
    if (typeof id !== 'string') {
      return null;
    }
    return id;
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
    if (
      [
        'PAID',
        'APPROVED',
        'CONFIRMED',
        'PAYMENT_APPROVED',
        'PAYMENT.PAID',
        'PAID_AT',
        'SETTLED'
      ].includes(value)
    ) {
      return 'PAID';
    }
    if (
      [
        'FAILED',
        'REJECTED',
        'DECLINED',
        'CANCELED',
        'CANCELLED',
        'PAYMENT.REJECTED',
        'DENIED',
        'EXPIRED'
      ].includes(value)
    ) {
      return 'FAILED';
    }
    if (
      [
        'IN_ANALYSIS',
        'UNDER_REVIEW',
        'ANALYSIS',
        'WAITING_REVIEW',
        'PAYMENT.IN_ANALYSIS',
        'WAITING',
        'AUTHORIZED'
      ].includes(value)
    ) {
      return 'IN_ANALYSIS';
    }

    const asNumber = toNumber(raw);
    if (asNumber === 3) return 'PAID';
    if (asNumber === 7 || asNumber === 8) return 'FAILED';
    if (asNumber === 2 || asNumber === 12) return 'IN_ANALYSIS';

    return 'AWAITING_PAYMENT';
  }

  private buildProviderWebhookUrl(productCode: string, provider: string): string | null {
    const rawWebhookBase = String(process.env.APP_WEBHOOK_BASE_URL ?? '').trim();
    const rawApiDomain = String(process.env.APP_API_DOMAIN ?? '').trim();
    const stage = String(process.env.APP_STAGE ?? '').trim().toLowerCase();

    let base = rawWebhookBase;
    if (!base && rawApiDomain) {
      const hasProtocol = /^https?:\/\//i.test(rawApiDomain);
      base = hasProtocol ? rawApiDomain : `https://${rawApiDomain}`;
    }
    if (!base && stage === 'local') {
      base = 'https://supermarine-outlandishly-mike.ngrok-free.dev';
    }
    if (!base) {
      return null;
    }

    const cleanBase = base.replace(/\/$/, '');
    const query = `productCode=${encodeURIComponent(normalizeProductCode(productCode))}`;
    return `${cleanBase}/webhooks/payments/${encodeURIComponent(provider)}?${query}`;
  }
}
