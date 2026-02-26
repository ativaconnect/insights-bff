import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { AdminOwnerRepository } from './admin-owner.repository';
import { dynamoDbDocumentClient, billingTableName } from './dynamo-client';
import { TenantSubscriptionRepository } from './tenant-subscription.repository';
import { DEFAULT_PRODUCT_CODE, normalizeProductCode } from '../../../shared/products';
import {
  normalizePaymentChargeStatus,
  normalizePaymentMethod,
  normalizePaymentProvider,
  type PaymentChargeStatus,
  type PaymentMethodCode,
  type PaymentProviderCode
} from '../../../shared/payments';

export type CreditPurchaseRequestStatus = 'PENDING' | 'IN_ANALYSIS' | 'APPROVED' | 'REJECTED';

interface CreditPurchaseRequestRecord {
  PK: string;
  SK: string;
  GSI2PK: string;
  GSI2SK: string;
  entityType: 'CREDIT_PURCHASE_REQUEST';
  id: string;
  tenantId: string;
  requesterUserId: string;
  productCode: string;
  requestedPlanCode: string;
  requestedCredits: number;
  requestedPricePerForm?: number;
  estimatedAmount?: number;
  status: CreditPurchaseRequestStatus;
  paymentProvider?: PaymentProviderCode;
  paymentMethod?: PaymentMethodCode;
  paymentStatus?: PaymentChargeStatus;
  paymentChargeId?: string;
  paymentCheckoutUrl?: string;
  paymentPixQrCode?: string;
  paymentPixCopyPaste?: string;
  paymentFailureReason?: string;
  paymentUpdatedAt?: string;
  paymentRaw?: Record<string, unknown>;
  note?: string;
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  appliedPlanCode?: string;
  appliedPlanName?: string;
  appliedPlanTier?: number;
  resultingCreditsBalance?: number;
  updatedAt: string;
}

interface CreditPurchaseRequestLock {
  PK: string;
  SK: 'LOCK';
  entityType: 'CREDIT_PURCHASE_REQUEST_LOCK';
  requestId: string;
  tenantId: string;
  requestSk: string;
}

export interface CreditPurchaseRequest {
  id: string;
  tenantId: string;
  requesterUserId: string;
  productCode: string;
  requestedPlanCode: string;
  requestedCredits: number;
  requestedPricePerForm?: number;
  estimatedAmount?: number;
  status: CreditPurchaseRequestStatus;
  paymentProvider?: PaymentProviderCode;
  paymentMethod?: PaymentMethodCode;
  paymentStatus?: PaymentChargeStatus;
  paymentChargeId?: string;
  paymentCheckoutUrl?: string;
  paymentPixQrCode?: string;
  paymentPixCopyPaste?: string;
  paymentFailureReason?: string;
  paymentUpdatedAt?: string;
  note?: string;
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  appliedPlanCode?: string;
  appliedPlanName?: string;
  appliedPlanTier?: number;
  resultingCreditsBalance?: number;
  updatedAt: string;
}

const requestLockKey = (requestId: string) => ({ PK: `CREDIT_REQUEST#${requestId}`, SK: 'LOCK' as const });
const tenantRequestPk = (tenantId: string) => `TENANT#${tenantId}`;
const chargeLookupPk = (provider: PaymentProviderCode, chargeId: string) =>
  `PAYMENT_CHARGE#${normalizePaymentProvider(provider)}#${String(chargeId).trim()}`;

const encodeCursor = (value: Record<string, unknown> | undefined): string | undefined => {
  if (!value) return undefined;
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
};

const decodeCursor = (value: string | undefined): Record<string, unknown> | undefined => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

export class CreditPurchaseRequestRepository {
  private readonly plans = new AdminOwnerRepository();
  private readonly subscriptions = new TenantSubscriptionRepository();

  async createRequest(input: {
    tenantId: string;
    requesterUserId: string;
    productCode?: string;
    requestedPlanCode: string;
    requestedCredits: number;
    paymentProvider?: PaymentProviderCode;
    paymentMethod?: PaymentMethodCode;
    paymentStatus?: PaymentChargeStatus;
    paymentChargeId?: string;
    paymentCheckoutUrl?: string;
    paymentPixQrCode?: string;
    paymentPixCopyPaste?: string;
    paymentRaw?: Record<string, unknown>;
    note?: string;
  }): Promise<CreditPurchaseRequest> {
    const productCode = normalizeProductCode(input.productCode);
    const pending = await this.findPendingByTenant(input.tenantId, productCode);
    if (pending) {
      throw new Error('REQUEST_ALREADY_PENDING');
    }

    const now = new Date().toISOString();
    const requestId = uuid();
    const requestedPlanCode = input.requestedPlanCode.trim().toUpperCase();
    if (requestedPlanCode === 'START') {
      throw new Error('PLAN_NOT_PURCHASABLE');
    }
    const requestedCredits = Math.floor(Number(input.requestedCredits));
    if (!Number.isInteger(requestedCredits) || requestedCredits <= 0) {
      throw new Error('INVALID_CREDITS');
    }

    const plan = await this.plans.getPlanDefinitionByCode(requestedPlanCode, productCode);
    if (!plan || !plan.active || plan.deletedAt) {
      throw new Error('PLAN_NOT_AVAILABLE');
    }

    const requestSk = `CREDIT_REQUEST#${now}#${requestId}`;
    const requestedPricePerForm = Number(plan.pricePerForm ?? 0);
    const estimatedAmount = Number((requestedCredits * requestedPricePerForm).toFixed(2));
    const request: CreditPurchaseRequestRecord = {
      PK: tenantRequestPk(input.tenantId),
      SK: requestSk,
      GSI2PK: 'ENTITY#CREDIT_PURCHASE_REQUEST',
      GSI2SK: `PENDING#${now}#${input.tenantId}#${requestId}`,
      entityType: 'CREDIT_PURCHASE_REQUEST',
      id: requestId,
      tenantId: input.tenantId,
      requesterUserId: input.requesterUserId,
      productCode,
      requestedPlanCode,
      requestedCredits,
      requestedPricePerForm,
      estimatedAmount,
      status: 'PENDING',
      paymentProvider: input.paymentProvider ? normalizePaymentProvider(input.paymentProvider) : undefined,
      paymentMethod: input.paymentMethod ? normalizePaymentMethod(input.paymentMethod) : undefined,
      paymentStatus: input.paymentStatus ? normalizePaymentChargeStatus(input.paymentStatus) : undefined,
      paymentChargeId: input.paymentChargeId?.trim() || undefined,
      paymentCheckoutUrl: input.paymentCheckoutUrl?.trim() || undefined,
      paymentPixQrCode: input.paymentPixQrCode?.trim() || undefined,
      paymentPixCopyPaste: input.paymentPixCopyPaste?.trim() || undefined,
      paymentUpdatedAt: input.paymentStatus ? now : undefined,
      paymentRaw: input.paymentRaw,
      note: input.note?.trim() || undefined,
      requestedAt: now,
      updatedAt: now
    };

    const lock: CreditPurchaseRequestLock = {
      ...requestLockKey(requestId),
      entityType: 'CREDIT_PURCHASE_REQUEST_LOCK',
      requestId,
      tenantId: input.tenantId,
      requestSk
    };

    await dynamoDbDocumentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: billingTableName,
              Item: lock,
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: billingTableName,
              Item: request,
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          },
          ...(request.paymentChargeId && request.paymentProvider
            ? [
                {
                  Put: {
                    TableName: billingTableName,
                    Item: {
                      PK: chargeLookupPk(request.paymentProvider, request.paymentChargeId),
                      SK: 'REQUEST',
                      entityType: 'CREDIT_PURCHASE_PAYMENT_LOOKUP',
                      requestId: request.id,
                      tenantId: request.tenantId,
                      requestSk
                    },
                    ConditionExpression: 'attribute_not_exists(PK)'
                  }
                }
              ]
            : [])
        ]
      })
    );

    return this.mapRecord(request);
  }

  async listByTenant(tenantId: string, productCode: string = DEFAULT_PRODUCT_CODE): Promise<CreditPurchaseRequest[]> {
    const normalizedProduct = normalizeProductCode(productCode);
    const items: CreditPurchaseRequestRecord[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: billingTableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': tenantRequestPk(tenantId),
            ':skPrefix': 'CREDIT_REQUEST#'
          },
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      items.push(...((output.Items ?? []) as CreditPurchaseRequestRecord[]));
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items
      .map((item) => this.mapRecord(item))
      .filter((item) => normalizeProductCode(item.productCode) === normalizedProduct)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async listForAdmin(status?: CreditPurchaseRequestStatus, productCode: string = DEFAULT_PRODUCT_CODE): Promise<CreditPurchaseRequest[]> {
    const normalizedProduct = normalizeProductCode(productCode);
    const normalizedStatus = status?.trim().toUpperCase() as CreditPurchaseRequestStatus | undefined;
    const keyCondition = normalizedStatus
      ? 'GSI2PK = :pk AND begins_with(GSI2SK, :statusPrefix)'
      : 'GSI2PK = :pk';
    const expressionValues: Record<string, string> = {
      ':pk': 'ENTITY#CREDIT_PURCHASE_REQUEST'
    };
    if (normalizedStatus) {
      expressionValues[':statusPrefix'] = `${normalizedStatus}#`;
    }

    const items: CreditPurchaseRequestRecord[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: billingTableName,
          IndexName: 'GSI2',
          KeyConditionExpression: keyCondition,
          ExpressionAttributeValues: expressionValues,
          ExclusiveStartKey: lastEvaluatedKey
        })
      );
      items.push(...((output.Items ?? []) as CreditPurchaseRequestRecord[]));
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items
      .map((item) => this.mapRecord(item))
      .filter((item) => normalizeProductCode(item.productCode) === normalizedProduct)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async listForAdminPage(input: {
    status?: CreditPurchaseRequestStatus;
    productCode?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: CreditPurchaseRequest[]; nextCursor?: string }> {
    const productCode = normalizeProductCode(input.productCode);
    const normalizedStatus = input.status?.trim().toUpperCase() as CreditPurchaseRequestStatus | undefined;
    const keyCondition = normalizedStatus
      ? 'GSI2PK = :pk AND begins_with(GSI2SK, :statusPrefix)'
      : 'GSI2PK = :pk';
    const expressionValues: Record<string, string> = {
      ':pk': 'ENTITY#CREDIT_PURCHASE_REQUEST'
    };
    if (normalizedStatus) {
      expressionValues[':statusPrefix'] = `${normalizedStatus}#`;
    }
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(200, Math.floor(Number(input.limit)))) : 50;

    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: billingTableName,
        IndexName: 'GSI2',
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: expressionValues,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(input.cursor)
      })
    );

    const items = ((output.Items ?? []) as CreditPurchaseRequestRecord[])
      .map((item) => this.mapRecord(item))
      .filter((item) => normalizeProductCode(item.productCode) === productCode);

    return {
      items,
      nextCursor: encodeCursor(output.LastEvaluatedKey as Record<string, unknown> | undefined)
    };
  }

  async approveRequest(
    requestId: string,
    approverUserId: string,
    reviewNote?: string
  ): Promise<CreditPurchaseRequest | null> {
    const record = await this.getRecordById(requestId);
    if (!record) {
      return null;
    }
    if (!(record.status === 'PENDING' || record.status === 'IN_ANALYSIS')) {
      throw new Error('REQUEST_NOT_PENDING');
    }

    const applied = await this.subscriptions.purchaseCredits(
      record.tenantId,
      record.requestedPlanCode,
      record.requestedCredits,
      record.productCode
    );
    if (!applied) {
      throw new Error('TENANT_NOT_FOUND');
    }

    const now = new Date().toISOString();
    const updated: CreditPurchaseRequestRecord = {
      ...record,
      status: 'APPROVED',
      paymentStatus: 'PAID',
      GSI2SK: `APPROVED#${record.requestedAt}#${record.tenantId}#${record.id}`,
      reviewedAt: now,
      reviewedBy: approverUserId,
      reviewNote: reviewNote?.trim() || undefined,
      appliedPlanCode: applied.planCode,
      appliedPlanName: applied.planName,
      appliedPlanTier: applied.planTier,
      resultingCreditsBalance: applied.questionnaireCreditsBalance,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: billingTableName,
        Item: updated,
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND (#status = :pending OR #status = :analysis)',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':pending': 'PENDING',
          ':analysis': 'IN_ANALYSIS'
        }
      })
    );

    return this.mapRecord(updated);
  }

  async rejectRequest(
    requestId: string,
    approverUserId: string,
    reviewNote?: string
  ): Promise<CreditPurchaseRequest | null> {
    const record = await this.getRecordById(requestId);
    if (!record) {
      return null;
    }
    if (!(record.status === 'PENDING' || record.status === 'IN_ANALYSIS')) {
      throw new Error('REQUEST_NOT_PENDING');
    }

    const now = new Date().toISOString();
    const updated: CreditPurchaseRequestRecord = {
      ...record,
      status: 'REJECTED',
      paymentStatus: 'FAILED',
      paymentFailureReason: reviewNote?.trim() || undefined,
      GSI2SK: `REJECTED#${record.requestedAt}#${record.tenantId}#${record.id}`,
      reviewedAt: now,
      reviewedBy: approverUserId,
      reviewNote: reviewNote?.trim() || undefined,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: billingTableName,
        Item: updated,
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND (#status = :pending OR #status = :analysis)',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':pending': 'PENDING',
          ':analysis': 'IN_ANALYSIS'
        }
      })
    );

    return this.mapRecord(updated);
  }

  async attachPaymentCharge(
    requestId: string,
    payment: {
      provider: PaymentProviderCode;
      method: PaymentMethodCode;
      chargeId: string;
      status: PaymentChargeStatus;
      checkoutUrl?: string;
      pixQrCode?: string;
      pixCopyPaste?: string;
      raw?: Record<string, unknown>;
    }
  ): Promise<CreditPurchaseRequest | null> {
    const record = await this.getRecordById(requestId);
    if (!record) {
      return null;
    }
    if (!(record.status === 'PENDING' || record.status === 'IN_ANALYSIS')) {
      return this.mapRecord(record);
    }

    const now = new Date().toISOString();
    const provider = normalizePaymentProvider(payment.provider);
    const chargeId = String(payment.chargeId ?? '').trim();
    if (!chargeId) {
      throw new Error('PAYMENT_CHARGE_REQUIRED');
    }

    const updated: CreditPurchaseRequestRecord = {
      ...record,
      paymentProvider: provider,
      paymentMethod: normalizePaymentMethod(payment.method),
      paymentChargeId: chargeId,
      paymentStatus: normalizePaymentChargeStatus(payment.status),
      paymentCheckoutUrl: payment.checkoutUrl?.trim() || undefined,
      paymentPixQrCode: payment.pixQrCode?.trim() || undefined,
      paymentPixCopyPaste: payment.pixCopyPaste?.trim() || undefined,
      paymentUpdatedAt: now,
      paymentRaw: payment.raw,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: billingTableName,
              Item: updated,
              ConditionExpression:
                'attribute_exists(PK) AND attribute_exists(SK) AND (#status = :pending OR #status = :analysis)',
              ExpressionAttributeNames: {
                '#status': 'status'
              },
              ExpressionAttributeValues: {
                ':pending': 'PENDING',
                ':analysis': 'IN_ANALYSIS'
              }
            }
          },
          {
            Put: {
              TableName: billingTableName,
              Item: {
                PK: chargeLookupPk(provider, chargeId),
                SK: 'REQUEST',
                entityType: 'CREDIT_PURCHASE_PAYMENT_LOOKUP',
                requestId: updated.id,
                tenantId: updated.tenantId,
                requestSk: updated.SK
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          }
        ]
      })
    );

    return this.mapRecord(updated);
  }

  async getById(requestId: string): Promise<CreditPurchaseRequest | null> {
    const record = await this.getRecordById(requestId);
    return record ? this.mapRecord(record) : null;
  }

  async getByIdForTenant(requestId: string, tenantId: string): Promise<CreditPurchaseRequest | null> {
    const record = await this.getRecordById(requestId);
    if (!record || String(record.tenantId) !== String(tenantId)) {
      return null;
    }
    return this.mapRecord(record);
  }

  private async getRecordById(requestId: string): Promise<CreditPurchaseRequestRecord | null> {
    const lockOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: billingTableName,
        Key: requestLockKey(requestId)
      })
    );
    const lock = lockOutput.Item as CreditPurchaseRequestLock | undefined;
    if (!lock?.tenantId || !lock?.requestSk) {
      return null;
    }

    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: billingTableName,
        Key: {
          PK: tenantRequestPk(lock.tenantId),
          SK: lock.requestSk
        }
      })
    );

    return (output.Item as CreditPurchaseRequestRecord | undefined) ?? null;
  }

  private mapRecord(item: CreditPurchaseRequestRecord): CreditPurchaseRequest {
    return {
      id: item.id,
      tenantId: item.tenantId,
      requesterUserId: item.requesterUserId,
      productCode: normalizeProductCode(item.productCode),
      requestedPlanCode: item.requestedPlanCode,
      requestedCredits: Number(item.requestedCredits ?? 0),
      requestedPricePerForm: Number(item.requestedPricePerForm ?? 0),
      estimatedAmount: Number(item.estimatedAmount ?? 0),
      status: item.status,
      paymentProvider: item.paymentProvider ? normalizePaymentProvider(item.paymentProvider) : undefined,
      paymentMethod: item.paymentMethod ? normalizePaymentMethod(item.paymentMethod) : undefined,
      paymentStatus: item.paymentStatus ? normalizePaymentChargeStatus(item.paymentStatus) : undefined,
      paymentChargeId: item.paymentChargeId,
      paymentCheckoutUrl: item.paymentCheckoutUrl,
      paymentPixQrCode: item.paymentPixQrCode,
      paymentPixCopyPaste: item.paymentPixCopyPaste,
      paymentFailureReason: item.paymentFailureReason,
      paymentUpdatedAt: item.paymentUpdatedAt,
      note: item.note,
      requestedAt: item.requestedAt,
      reviewedAt: item.reviewedAt,
      reviewedBy: item.reviewedBy,
      reviewNote: item.reviewNote,
      appliedPlanCode: item.appliedPlanCode,
      appliedPlanName: item.appliedPlanName,
      appliedPlanTier: item.appliedPlanTier,
      resultingCreditsBalance: item.resultingCreditsBalance,
      updatedAt: item.updatedAt
    };
  }

  async markPaymentStatusByCharge(params: {
    provider: PaymentProviderCode;
    chargeId: string;
    status: PaymentChargeStatus;
    reason?: string;
    rawPayload?: Record<string, unknown>;
  }): Promise<CreditPurchaseRequest | null> {
    const lookupOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: billingTableName,
        Key: {
          PK: chargeLookupPk(params.provider, params.chargeId),
          SK: 'REQUEST'
        }
      })
    );

    const requestId = String(lookupOutput.Item?.requestId ?? '').trim();
    if (!requestId) {
      return null;
    }

    const record = await this.getRecordById(requestId);
    if (!record) {
      return null;
    }

    const now = new Date().toISOString();
    const nextStatus: CreditPurchaseRequestStatus =
      params.status === 'PAID'
        ? 'APPROVED'
        : params.status === 'FAILED'
          ? 'REJECTED'
          : params.status === 'IN_ANALYSIS'
            ? 'IN_ANALYSIS'
            : 'PENDING';

    if (record.status === 'APPROVED' || record.status === 'REJECTED') {
      return this.mapRecord(record);
    }

    if (nextStatus === 'APPROVED') {
      return this.approveRequest(record.id, 'payment-webhook', 'Aprovado automaticamente via webhook');
    }

    const updated: CreditPurchaseRequestRecord = {
      ...record,
      status: nextStatus,
      paymentStatus: params.status,
      paymentFailureReason: params.reason?.trim() || record.paymentFailureReason,
      paymentUpdatedAt: now,
      paymentRaw: params.rawPayload ?? record.paymentRaw,
      ...(nextStatus === 'REJECTED'
        ? {
            reviewedAt: now,
            reviewedBy: 'payment-webhook',
            reviewNote: params.reason?.trim() || 'Pagamento reprovado via webhook'
          }
        : {}),
      GSI2SK: `${nextStatus}#${record.requestedAt}#${record.tenantId}#${record.id}`,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: billingTableName,
        Item: updated,
        ConditionExpression:
          'attribute_exists(PK) AND attribute_exists(SK) AND (#status = :pending OR #status = :analysis)',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':pending': 'PENDING',
          ':analysis': 'IN_ANALYSIS'
        }
      })
    );

    return this.mapRecord(updated);
  }

  private async findPendingByTenant(
    tenantId: string,
    productCode: string = DEFAULT_PRODUCT_CODE
  ): Promise<CreditPurchaseRequestRecord | null> {
    const normalizedProduct = normalizeProductCode(productCode);
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: billingTableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': tenantRequestPk(tenantId),
            ':skPrefix': 'CREDIT_REQUEST#'
          },
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      const pending = (output.Items ?? []).find((item) => {
        const typed = item as CreditPurchaseRequestRecord;
        return (
          (String(typed.status) === 'PENDING' || String(typed.status) === 'IN_ANALYSIS') &&
          normalizeProductCode(typed.productCode) === normalizedProduct
        );
      });
      if (pending) {
        return pending as CreditPurchaseRequestRecord;
      }

      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return null;
  }
}
