import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { AdminOwnerRepository } from './admin-owner.repository';
import { dynamoDbDocumentClient, billingTableName } from './dynamo-client';
import { TenantSubscriptionRepository } from './tenant-subscription.repository';
import { DEFAULT_PRODUCT_CODE, normalizeProductCode } from '../../../shared/products';

export type CreditPurchaseRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

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

export class CreditPurchaseRequestRepository {
  private readonly plans = new AdminOwnerRepository();
  private readonly subscriptions = new TenantSubscriptionRepository();

  async createRequest(input: {
    tenantId: string;
    requesterUserId: string;
    productCode?: string;
    requestedPlanCode: string;
    requestedCredits: number;
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
          }
        ]
      })
    );

    return this.mapRecord(request);
  }

  async listByTenant(tenantId: string, productCode: string = DEFAULT_PRODUCT_CODE): Promise<CreditPurchaseRequest[]> {
    const normalizedProduct = normalizeProductCode(productCode);
    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: billingTableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantRequestPk(tenantId),
          ':skPrefix': 'CREDIT_REQUEST#'
        }
      })
    );

    const items = (output.Items ?? []) as CreditPurchaseRequestRecord[];
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

    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: billingTableName,
        IndexName: 'GSI2',
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: expressionValues
      })
    );

    const items = (output.Items ?? []) as CreditPurchaseRequestRecord[];
    return items
      .map((item) => this.mapRecord(item))
      .filter((item) => normalizeProductCode(item.productCode) === normalizedProduct)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
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
    if (record.status !== 'PENDING') {
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
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pending',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':pending': 'PENDING'
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
    if (record.status !== 'PENDING') {
      throw new Error('REQUEST_NOT_PENDING');
    }

    const now = new Date().toISOString();
    const updated: CreditPurchaseRequestRecord = {
      ...record,
      status: 'REJECTED',
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
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :pending',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':pending': 'PENDING'
        }
      })
    );

    return this.mapRecord(updated);
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

  private async findPendingByTenant(
    tenantId: string,
    productCode: string = DEFAULT_PRODUCT_CODE
  ): Promise<CreditPurchaseRequestRecord | null> {
    const normalizedProduct = normalizeProductCode(productCode);
    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: billingTableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantRequestPk(tenantId),
          ':skPrefix': 'CREDIT_REQUEST#'
        }
      })
    );

    const pending = (output.Items ?? []).find((item) => {
      const typed = item as CreditPurchaseRequestRecord;
      return (
        String(typed.status) === 'PENDING' &&
        normalizeProductCode(typed.productCode) === normalizedProduct
      );
    });
    return (pending as CreditPurchaseRequestRecord | undefined) ?? null;
  }
}
