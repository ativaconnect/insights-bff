import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerAccountRepository } from '../../../../infrastructure/persistence/dynamodb/customer-account.repository';
import { TenantSubscriptionRepository } from '../../../../infrastructure/persistence/dynamodb/tenant-subscription.repository';
import { authorize, isAuthorizationError } from '../../middleware/auth.middleware';
import { fail, ok } from '../../response';

const repository = new CustomerAccountRepository();
const subscriptionRepository = new TenantSubscriptionRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  const profile = await repository.getProfile(auth.tenantId);
  if (!profile) {
    return fail(404, 'Perfil nao encontrado.');
  }

  const subscription = await subscriptionRepository.getSnapshot(auth.tenantId);

  return ok({
    ...profile,
    questionnaireCreditsBalance:
      subscription?.questionnaireCreditsBalance ?? profile.questionnaireCreditsBalance ?? 0,
    plan: subscription
      ? {
          code: subscription.planCode,
          name: subscription.planName,
          tier: subscription.planTier,
          limits: subscription.limits
        }
      : undefined
  });
};
