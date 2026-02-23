import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDbDocumentClient, customersTableName } from './dynamo-client';
import { AdminOwnerRepository, type PlanDefinition } from './admin-owner.repository';
import { DEFAULT_PRODUCT_CODE } from '../../../shared/products';

export interface TenantPlanPolicy {
  code: string;
  name: string;
  limits: {
    maxSurveys: number;
    maxQuestionsPerSurvey: number;
    maxResponsesPerSurvey: number;
    maxInterviewers: number;
  };
}

const DEFAULT_START_PLAN: TenantPlanPolicy = {
  code: 'START',
  name: 'Start',
  limits: {
    maxSurveys: 5,
    maxQuestionsPerSurvey: 5,
    maxResponsesPerSurvey: 15,
    maxInterviewers: 1
  }
};

export class TenantPlanPolicyRepository {
  private readonly planRepository = new AdminOwnerRepository();

  async getTenantPolicy(tenantId: string, productCode: string = DEFAULT_PRODUCT_CODE): Promise<TenantPlanPolicy> {
    const tenantOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: customersTableName,
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: 'PROFILE'
        }
      })
    );

    const tenant = tenantOutput.Item as { planCode?: string } | undefined;
    const requestedCode = String(tenant?.planCode ?? 'START').trim().toUpperCase();

    const requestedPlan = await this.planRepository.getPlanDefinitionByCode(requestedCode, productCode);
    if (requestedPlan) {
      return this.toPolicy(requestedPlan);
    }

    const fallbackPlan = await this.planRepository.getPlanDefinitionByCode('START', productCode);
    if (fallbackPlan) {
      return this.toPolicy(fallbackPlan);
    }

    return DEFAULT_START_PLAN;
  }

  private toPolicy(plan: PlanDefinition): TenantPlanPolicy {
    return {
      code: plan.code,
      name: plan.name,
      limits: {
        maxSurveys: Number(plan.maxSurveys || DEFAULT_START_PLAN.limits.maxSurveys),
        maxQuestionsPerSurvey: Number(plan.maxQuestionsPerSurvey || DEFAULT_START_PLAN.limits.maxQuestionsPerSurvey),
        maxResponsesPerSurvey: Number(plan.maxResponsesPerSurvey || DEFAULT_START_PLAN.limits.maxResponsesPerSurvey),
        maxInterviewers: Number(plan.maxInterviewers || DEFAULT_START_PLAN.limits.maxInterviewers)
      }
    };
  }
}
