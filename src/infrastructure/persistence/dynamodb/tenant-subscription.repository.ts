import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AdminOwnerRepository, type PlanDefinition } from './admin-owner.repository';
import { dynamoDbDocumentClient, customersTableName } from './dynamo-client';
import { DEFAULT_PRODUCT_CODE, normalizeProductCode } from '../../../shared/products';
import { logger } from '../../observability/logger';

interface TenantProfileRecord {
  PK: string;
  SK: string;
  GSI2PK: string;
  GSI2SK: string;
  entityType: 'TENANT';
  id: string;
  personType: 'PF' | 'PJ';
  document: string;
  legalName: string;
  tradeName?: string;
  email: string;
  phone: string;
  planCode?: string;
  questionnaireCreditsBalance?: number;
  address: {
    cep: string;
    state: string;
    city: string;
    neighborhood: string;
    street: string;
    number: string;
    complement?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TenantSubscriptionSnapshot {
  tenantId: string;
  planCode: string;
  planName: string;
  planTier: number;
  questionnaireCreditsBalance: number;
  limits: {
    maxSurveys: number;
    maxQuestionsPerSurvey: number;
    maxResponsesPerSurvey: number;
    maxInterviewers: number;
  };
}

const DEFAULT_LIMITS = {
  maxSurveys: 5,
  maxQuestionsPerSurvey: 5,
  maxResponsesPerSurvey: 15,
  maxInterviewers: 1
};

const defaultCreditsForPlan = (plan: PlanDefinition): number => {
  const computed = Number(plan.maxSurveys) * Number(plan.maxResponsesPerSurvey);
  return Number.isFinite(computed) && computed > 0 ? computed : 75;
};

const buildDefaultStartPlan = (productCode: string): PlanDefinition => {
  const now = new Date().toISOString();
  return {
    id: 'default-start-plan',
    productCode: normalizeProductCode(productCode),
    code: 'START',
    name: 'Start',
    description: 'Fallback automatico quando catalogo de planos nao esta disponivel.',
    tier: 0,
    pricePerForm: 0,
    minForms: 1,
    maxSurveys: DEFAULT_LIMITS.maxSurveys,
    maxQuestionsPerSurvey: DEFAULT_LIMITS.maxQuestionsPerSurvey,
    maxResponsesPerSurvey: DEFAULT_LIMITS.maxResponsesPerSurvey,
    maxInterviewers: DEFAULT_LIMITS.maxInterviewers,
    active: true,
    createdAt: now,
    updatedAt: now
  };
};

export class TenantSubscriptionRepository {
  private readonly plans = new AdminOwnerRepository();

  async getSnapshot(tenantId: string, productCode: string = DEFAULT_PRODUCT_CODE): Promise<TenantSubscriptionSnapshot | null> {
    const tenant = await this.getTenantRecord(tenantId);
    if (!tenant) {
      return null;
    }

    const currentPlan = await this.resolveTenantPlan(tenant.planCode, productCode);
    const balance = this.resolveBalance(tenant.questionnaireCreditsBalance, currentPlan);

    return {
      tenantId,
      planCode: currentPlan.code,
      planName: currentPlan.name,
      planTier: Number(currentPlan.tier ?? 0),
      questionnaireCreditsBalance: balance,
      limits: {
        maxSurveys: Number(currentPlan.maxSurveys ?? DEFAULT_LIMITS.maxSurveys),
        maxQuestionsPerSurvey: Number(currentPlan.maxQuestionsPerSurvey ?? DEFAULT_LIMITS.maxQuestionsPerSurvey),
        maxResponsesPerSurvey: Number(currentPlan.maxResponsesPerSurvey ?? DEFAULT_LIMITS.maxResponsesPerSurvey),
        maxInterviewers: Number(currentPlan.maxInterviewers ?? DEFAULT_LIMITS.maxInterviewers)
      }
    };
  }

  async purchaseCredits(
    tenantId: string,
    purchasePlanCode: string,
    creditsRequested?: number,
    productCode: string = DEFAULT_PRODUCT_CODE
  ): Promise<TenantSubscriptionSnapshot | null> {
    if (String(purchasePlanCode).trim().toUpperCase() === 'START') {
      throw new Error('PLAN_NOT_PURCHASABLE');
    }

    const tenant = await this.getTenantRecord(tenantId);
    if (!tenant) {
      return null;
    }

    const normalizedProduct = normalizeProductCode(productCode);
    const currentPlan = await this.resolveTenantPlan(tenant.planCode, normalizedProduct);
    const requestedPlan = await this.plans.getPlanDefinitionByCode(purchasePlanCode, normalizedProduct);
    if (!requestedPlan || !requestedPlan.active || requestedPlan.deletedAt) {
      throw new Error('PLAN_NOT_AVAILABLE');
    }

    const currentTier = Number(currentPlan.tier ?? 0);
    const requestedTier = Number(requestedPlan.tier ?? 0);
    const nextPlan = requestedTier > currentTier ? requestedPlan : currentPlan;

    const autoCredits = Math.max(Number(requestedPlan.minForms ?? 0), 1);
    const creditsToAdd = creditsRequested && creditsRequested > 0 ? Math.floor(creditsRequested) : autoCredits;

    const currentBalance = this.resolveBalance(tenant.questionnaireCreditsBalance, currentPlan);
    const nextBalance = currentBalance + creditsToAdd;
    const now = new Date().toISOString();

    const updated: TenantProfileRecord = {
      ...tenant,
      planCode: nextPlan.code,
      questionnaireCreditsBalance: nextBalance,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: customersTableName,
        Item: updated,
        ConditionExpression: 'attribute_exists(PK)'
      })
    );

    return {
      tenantId,
      planCode: nextPlan.code,
      planName: nextPlan.name,
      planTier: Number(nextPlan.tier ?? 0),
      questionnaireCreditsBalance: nextBalance,
      limits: {
        maxSurveys: Number(nextPlan.maxSurveys ?? DEFAULT_LIMITS.maxSurveys),
        maxQuestionsPerSurvey: Number(nextPlan.maxQuestionsPerSurvey ?? DEFAULT_LIMITS.maxQuestionsPerSurvey),
        maxResponsesPerSurvey: Number(nextPlan.maxResponsesPerSurvey ?? DEFAULT_LIMITS.maxResponsesPerSurvey),
        maxInterviewers: Number(nextPlan.maxInterviewers ?? DEFAULT_LIMITS.maxInterviewers)
      }
    };
  }

  private async resolveTenantPlan(
    planCode: string | undefined,
    productCode: string = DEFAULT_PRODUCT_CODE
  ): Promise<PlanDefinition> {
    const normalizedProduct = normalizeProductCode(productCode);
    const preferredCode = String(planCode ?? 'START').trim().toUpperCase();
    try {
      const preferred = await this.plans.getPlanDefinitionByCode(preferredCode, normalizedProduct);
      if (preferred) {
        return preferred;
      }

      const fallback = await this.plans.getPlanDefinitionByCode('START', normalizedProduct);
      if (fallback) {
        logger.warn('tenant.subscription.plan.fallback_to_start', {
          productCode: normalizedProduct,
          preferredCode
        });
        return fallback;
      }
    } catch (error: unknown) {
      logger.error('tenant.subscription.plan.lookup_failed', {
        productCode: normalizedProduct,
        preferredCode,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    logger.warn('tenant.subscription.plan.using_default_start', {
      productCode: normalizedProduct,
      preferredCode
    });
    return buildDefaultStartPlan(normalizedProduct);
  }

  private resolveBalance(currentBalance: number | undefined, plan: PlanDefinition): number {
    const raw = Number(currentBalance);
    if (Number.isFinite(raw) && raw >= 0) {
      return raw;
    }
    return defaultCreditsForPlan(plan);
  }

  private async getTenantRecord(tenantId: string): Promise<TenantProfileRecord | null> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: customersTableName,
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: 'PROFILE'
        }
      })
    );

    return (output.Item as TenantProfileRecord | undefined) ?? null;
  }
}
