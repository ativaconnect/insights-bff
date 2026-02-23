import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { dynamoDbDocumentClient, customersTableName, plansTableName } from './dynamo-client';
import { DEFAULT_PRODUCT_CODE, normalizeProductCode } from '../../../shared/products';

export interface AdminTenantSummary {
  tenantId: string;
  legalName: string;
  tradeName?: string;
  document: string;
  email: string;
  phone: string;
  personType: 'PF' | 'PJ';
  createdAt: string;
}

export interface PlanDefinition {
  id: string;
  productCode: string;
  code: string;
  name: string;
  description?: string;
  tier: number;
  pricePerForm: number;
  minForms: number;
  maxSurveys: number;
  maxQuestionsPerSurvey: number;
  maxResponsesPerSurvey: number;
  maxInterviewers: number;
  active: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPlanCatalogItem {
  productCode: string;
  code: string;
  name: string;
  description?: string;
  tier: number;
  pricePerForm: number;
  minForms: number;
  maxSurveys: number;
  maxQuestionsPerSurvey: number;
  maxResponsesPerSurvey: number;
  maxInterviewers: number;
}

export interface PlanAuditEntry {
  id: string;
  planId: string;
  action: 'CREATED' | 'UPDATED' | 'SOFT_DELETED';
  actorId: string;
  createdAt: string;
  before?: Partial<PlanDefinition>;
  after?: Partial<PlanDefinition>;
}

const planDefinitionKey = (planId: string) => ({ PK: `PLANDEF#${planId}`, SK: 'PROFILE' });
const planCodeLockKey = (productCode: string, code: string) => ({
  PK: `PLANDEF_CODE#${normalizeProductCode(productCode)}#${code.toUpperCase()}`,
  SK: 'LOCK'
});
const planAuditKey = (planId: string, createdAt: string, auditId: string) => ({
  PK: `PLANDEF#${planId}`,
  SK: `AUDIT#${createdAt}#${auditId}`
});

export class AdminOwnerRepository {
  private normalizePlan(item: Partial<PlanDefinition>): PlanDefinition {
    const productCode = normalizeProductCode((item as { productCode?: string }).productCode);
    return {
      id: String(item.id),
      productCode,
      code: String(item.code),
      name: String(item.name),
      description: item.description,
      tier: Number(item.tier ?? 0),
      pricePerForm: Number(item.pricePerForm ?? 0),
      minForms: Number(item.minForms ?? 0),
      maxSurveys: Number(item.maxSurveys ?? 5),
      maxQuestionsPerSurvey: Number(item.maxQuestionsPerSurvey ?? 5),
      maxResponsesPerSurvey: Number(item.maxResponsesPerSurvey ?? 15),
      maxInterviewers: Number(item.maxInterviewers ?? 1),
      active: Boolean(item.active ?? true),
      deletedAt: item.deletedAt,
      createdAt: String(item.createdAt ?? new Date().toISOString()),
      updatedAt: String(item.updatedAt ?? new Date().toISOString())
    };
  }

  async listCustomers(): Promise<AdminTenantSummary[]> {
    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: customersTableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': 'ENTITY#TENANT'
        }
      })
    );

    const items = (output.Items ?? []) as Array<{
      id: string;
      legalName: string;
      tradeName?: string;
      document: string;
      email: string;
      phone: string;
      personType: 'PF' | 'PJ';
      createdAt: string;
    }>;

    return items
      .map((item) => ({
        tenantId: item.id,
        legalName: item.legalName,
        tradeName: item.tradeName,
        document: item.document,
        email: item.email,
        phone: item.phone,
        personType: item.personType,
        createdAt: item.createdAt
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listPlanDefinitions(productCode: string = DEFAULT_PRODUCT_CODE): Promise<PlanDefinition[]> {
    const normalizedProduct = normalizeProductCode(productCode);
    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: plansTableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': 'ENTITY#PLAN_DEFINITION'
        }
      })
    );

    const items = (output.Items ?? [])
      .map((item) => this.normalizePlan(item as Partial<PlanDefinition>))
      .filter((item) => normalizeProductCode(item.productCode) === normalizedProduct);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listActivePlansForCatalog(productCode: string = DEFAULT_PRODUCT_CODE): Promise<PublicPlanCatalogItem[]> {
    const plans = await this.listPlanDefinitions(productCode);
    return plans
      .filter((plan) => plan.active)
      .sort((a, b) => a.minForms - b.minForms)
      .map((plan) => ({
        productCode: plan.productCode,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        tier: plan.tier,
        pricePerForm: plan.pricePerForm,
        minForms: plan.minForms,
        maxSurveys: plan.maxSurveys,
        maxQuestionsPerSurvey: plan.maxQuestionsPerSurvey,
        maxResponsesPerSurvey: plan.maxResponsesPerSurvey,
        maxInterviewers: plan.maxInterviewers
      }));
  }

  async getPlanDefinitionByCode(code: string, productCode: string = DEFAULT_PRODUCT_CODE): Promise<PlanDefinition | null> {
    const normalizedCode = code.trim().toUpperCase();
    const normalizedProduct = normalizeProductCode(productCode);
    const lockOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: planCodeLockKey(normalizedProduct, normalizedCode)
      })
    );

    let planId = lockOutput.Item?.planId as string | undefined;
    if (!planId && normalizedProduct === DEFAULT_PRODUCT_CODE) {
      const legacyLock = await dynamoDbDocumentClient.send(
        new GetCommand({
          TableName: plansTableName,
          Key: { PK: `PLANDEF_CODE#${normalizedCode}`, SK: 'LOCK' }
        })
      );
      planId = legacyLock.Item?.planId as string | undefined;
    }
    if (!planId) {
      return null;
    }

    const planOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: planDefinitionKey(planId)
      })
    );

    if (!planOutput.Item) {
      return null;
    }
    const plan = this.normalizePlan(planOutput.Item as Partial<PlanDefinition>);
    if (normalizeProductCode(plan.productCode) !== normalizedProduct) {
      return null;
    }
    return plan;
  }

  async createPlanDefinition(input: {
    actorId: string;
    productCode?: string;
    code: string;
    name: string;
    description?: string;
    tier: number;
    pricePerForm: number;
    minForms: number;
    maxSurveys: number;
    maxQuestionsPerSurvey: number;
    maxResponsesPerSurvey: number;
    maxInterviewers: number;
    active: boolean;
  }): Promise<PlanDefinition> {
    const now = new Date().toISOString();
    const id = uuid();
    const auditId = uuid();
    const normalizedCode = input.code.trim().toUpperCase();
    const productCode = normalizeProductCode(input.productCode);

    const plan: PlanDefinition = {
      id,
      productCode,
      code: normalizedCode,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      tier: input.tier,
      pricePerForm: input.pricePerForm,
      minForms: input.minForms,
      maxSurveys: input.maxSurveys,
      maxQuestionsPerSurvey: input.maxQuestionsPerSurvey,
      maxResponsesPerSurvey: input.maxResponsesPerSurvey,
      maxInterviewers: input.maxInterviewers,
      active: input.active,
      createdAt: now,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: plansTableName,
              Item: {
                ...planCodeLockKey(productCode, normalizedCode),
                entityType: 'PLAN_DEFINITION_CODE_LOCK',
                planId: id,
                productCode,
                code: normalizedCode
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: plansTableName,
              Item: {
                ...planDefinitionKey(id),
                GSI2PK: 'ENTITY#PLAN_DEFINITION',
                GSI2SK: `${now}#${id}`,
                entityType: 'PLAN_DEFINITION',
                ...plan
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: plansTableName,
              Item: {
                ...planAuditKey(id, now, auditId),
                entityType: 'PLAN_DEFINITION_AUDIT',
                id: auditId,
                planId: id,
                action: 'CREATED',
                actorId: input.actorId,
                createdAt: now,
                after: plan
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          }
        ]
      })
    );

    return plan;
  }

  async updatePlanDefinition(
    planId: string,
    input: {
      actorId: string;
      name: string;
      description?: string;
      tier: number;
      pricePerForm: number;
      minForms: number;
      maxSurveys: number;
      maxQuestionsPerSurvey: number;
      maxResponsesPerSurvey: number;
      maxInterviewers: number;
      active: boolean;
    }
  ): Promise<PlanDefinition | null> {
    const currentOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: planDefinitionKey(planId)
      })
    );

    const current = currentOutput.Item
      ? this.normalizePlan(currentOutput.Item as Partial<PlanDefinition>)
      : undefined;
    if (!current) {
      return null;
    }

    const now = new Date().toISOString();
    const auditId = uuid();
    const next: PlanDefinition = {
      ...current,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      tier: input.tier,
      pricePerForm: input.pricePerForm,
      minForms: input.minForms,
      maxSurveys: input.maxSurveys,
      maxQuestionsPerSurvey: input.maxQuestionsPerSurvey,
      maxResponsesPerSurvey: input.maxResponsesPerSurvey,
      maxInterviewers: input.maxInterviewers,
      active: input.active,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: plansTableName,
              Item: {
                ...planDefinitionKey(planId),
                GSI2PK: 'ENTITY#PLAN_DEFINITION',
                GSI2SK: `${current.createdAt}#${planId}`,
                entityType: 'PLAN_DEFINITION',
                ...next
              },
              ConditionExpression: 'attribute_exists(PK)'
            }
          },
          {
            Put: {
              TableName: plansTableName,
              Item: {
                ...planAuditKey(planId, now, auditId),
                entityType: 'PLAN_DEFINITION_AUDIT',
                id: auditId,
                planId,
                action: 'UPDATED',
                actorId: input.actorId,
                createdAt: now,
                before: current,
                after: next
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          }
        ]
      })
    );

    return next;
  }

  async softDeletePlanDefinition(planId: string, actorId: string): Promise<PlanDefinition | null> {
    const currentOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: planDefinitionKey(planId)
      })
    );

    const current = currentOutput.Item
      ? this.normalizePlan(currentOutput.Item as Partial<PlanDefinition>)
      : undefined;
    if (!current) {
      return null;
    }

    if (current.deletedAt) {
      return current;
    }

    const now = new Date().toISOString();
    const auditId = uuid();
    const next: PlanDefinition = {
      ...current,
      active: false,
      deletedAt: now,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: plansTableName,
              Item: {
                ...planDefinitionKey(planId),
                GSI2PK: 'ENTITY#PLAN_DEFINITION',
                GSI2SK: `${current.createdAt}#${planId}`,
                entityType: 'PLAN_DEFINITION',
                ...next
              },
              ConditionExpression: 'attribute_exists(PK)'
            }
          },
          {
            Put: {
              TableName: plansTableName,
              Item: {
                ...planAuditKey(planId, now, auditId),
                entityType: 'PLAN_DEFINITION_AUDIT',
                id: auditId,
                planId,
                action: 'SOFT_DELETED',
                actorId,
                createdAt: now,
                before: current,
                after: next
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          }
        ]
      })
    );

    return next;
  }

  async listPlanAudits(planId: string): Promise<PlanAuditEntry[]> {
    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: plansTableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `PLANDEF#${planId}`,
          ':sk': 'AUDIT#'
        }
      })
    );

    const items = (output.Items ?? []) as PlanAuditEntry[];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
