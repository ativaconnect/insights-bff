import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { billingTableName, dynamoDbDocumentClient } from './dynamo-client';
import { DEFAULT_PRODUCT_CODE, normalizeProductCode } from '../../../shared/products';
import { normalizePaymentMethod, normalizePaymentProvider, type PaymentMethodCode, type PaymentProviderCode } from '../../../shared/payments';

export interface PaymentGatewayConfigRecord {
  PK: string;
  SK: 'PAYMENT_CONFIG';
  GSI2PK: 'ENTITY#PAYMENT_GATEWAY_CONFIG';
  GSI2SK: string;
  entityType: 'PAYMENT_GATEWAY_CONFIG';
  productCode: string;
  provider: PaymentProviderCode;
  enabledMethods: PaymentMethodCode[];
  providerApiBaseUrl?: string;
  providerApiToken?: string;
  webhookSecret?: string;
  pixKey?: string;
  merchantName?: string;
  updatedAt: string;
  updatedBy: string;
  createdAt: string;
}

export interface PaymentGatewayConfig {
  productCode: string;
  provider: PaymentProviderCode;
  enabledMethods: PaymentMethodCode[];
  providerApiBaseUrl?: string;
  hasProviderApiToken: boolean;
  hasWebhookSecret: boolean;
  pixKey?: string;
  merchantName?: string;
  updatedAt: string;
  updatedBy: string;
  createdAt: string;
}

const key = (productCode: string) => ({
  PK: `PRODUCT#${normalizeProductCode(productCode)}`,
  SK: 'PAYMENT_CONFIG' as const
});

export class PaymentGatewayConfigRepository {
  async get(productCode: string = DEFAULT_PRODUCT_CODE): Promise<PaymentGatewayConfig | null> {
    const normalizedProduct = normalizeProductCode(productCode);
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: billingTableName,
        Key: key(normalizedProduct)
      })
    );

    const item = output.Item as PaymentGatewayConfigRecord | undefined;
    return item ? this.mapRecord(item) : null;
  }

  async getPrivate(productCode: string = DEFAULT_PRODUCT_CODE): Promise<PaymentGatewayConfigRecord | null> {
    const normalizedProduct = normalizeProductCode(productCode);
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: billingTableName,
        Key: key(normalizedProduct)
      })
    );
    return (output.Item as PaymentGatewayConfigRecord | undefined) ?? null;
  }

  async upsert(
    productCode: string,
    actorUserId: string,
    input: {
      provider: PaymentProviderCode;
      enabledMethods: PaymentMethodCode[];
      providerApiBaseUrl?: string;
      providerApiToken?: string;
      webhookSecret?: string;
      pixKey?: string;
      merchantName?: string;
    }
  ): Promise<PaymentGatewayConfig> {
    const normalizedProduct = normalizeProductCode(productCode);
    const now = new Date().toISOString();
    const current = await this.getPrivate(normalizedProduct);

    const enabledMethods = Array.from(
      new Set((input.enabledMethods ?? []).map((method) => normalizePaymentMethod(method)))
    );

    const next: PaymentGatewayConfigRecord = {
      ...key(normalizedProduct),
      GSI2PK: 'ENTITY#PAYMENT_GATEWAY_CONFIG',
      GSI2SK: `${normalizedProduct}#PAYMENT_CONFIG`,
      entityType: 'PAYMENT_GATEWAY_CONFIG',
      productCode: normalizedProduct,
      provider: normalizePaymentProvider(input.provider),
      enabledMethods: enabledMethods.length ? enabledMethods : ['PIX'],
      providerApiBaseUrl: input.providerApiBaseUrl?.trim() || undefined,
      providerApiToken: input.providerApiToken?.trim()
        ? input.providerApiToken.trim()
        : current?.providerApiToken,
      webhookSecret: input.webhookSecret?.trim()
        ? input.webhookSecret.trim()
        : current?.webhookSecret,
      pixKey: input.pixKey?.trim() || undefined,
      merchantName: input.merchantName?.trim() || undefined,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      updatedBy: actorUserId
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: billingTableName,
        Item: next
      })
    );

    return this.mapRecord(next);
  }

  private mapRecord(item: PaymentGatewayConfigRecord): PaymentGatewayConfig {
    return {
      productCode: normalizeProductCode(item.productCode),
      provider: normalizePaymentProvider(item.provider),
      enabledMethods: (item.enabledMethods ?? []).map((method) => normalizePaymentMethod(method)),
      providerApiBaseUrl: item.providerApiBaseUrl,
      hasProviderApiToken: Boolean(item.providerApiToken),
      hasWebhookSecret: Boolean(item.webhookSecret),
      pixKey: item.pixKey,
      merchantName: item.merchantName,
      updatedAt: item.updatedAt,
      updatedBy: item.updatedBy,
      createdAt: item.createdAt
    };
  }
}
