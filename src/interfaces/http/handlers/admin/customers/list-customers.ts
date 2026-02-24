import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

const repository = new AdminOwnerRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const [customers, plans] = await Promise.all([
    repository.listCustomers(),
    repository.listPlanDefinitions(productCode)
  ]);

  const planMap = new Map(plans.map((plan) => [String(plan.code).toUpperCase(), plan]));
  const defaultPlan = planMap.get('START');
  const enriched = customers.map((customer) => {
    const chosenPlanCode = String(customer.planCode ?? 'START').toUpperCase();
    const plan = planMap.get(chosenPlanCode) ?? defaultPlan;
    const subscription = plan
      ? {
          tenantId: customer.tenantId,
          planCode: plan.code,
          planName: plan.name,
          planTier: Number(plan.tier ?? 0),
          questionnaireCreditsBalance: Number(customer.questionnaireCreditsBalance ?? 0),
          limits: {
            maxSurveys: Number(plan.maxSurveys ?? 5),
            maxQuestionsPerSurvey: Number(plan.maxQuestionsPerSurvey ?? 5),
            maxResponsesPerSurvey: Number(plan.maxResponsesPerSurvey ?? 15),
            maxInterviewers: Number(plan.maxInterviewers ?? 1)
          }
        }
      : undefined;

    return {
      ...customer,
      subscription
    };
  });
  return ok(enriched);
};
