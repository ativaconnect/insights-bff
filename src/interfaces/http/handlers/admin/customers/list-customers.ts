import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import { TenantSubscriptionRepository } from '../../../../../infrastructure/persistence/dynamodb/tenant-subscription.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

const repository = new AdminOwnerRepository();
const subscriptionRepository = new TenantSubscriptionRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const customers = await repository.listCustomers();
  const enriched = await Promise.all(
    customers.map(async (customer) => {
      const subscription = await subscriptionRepository.getSnapshot(customer.tenantId, productCode);
      return {
        ...customer,
        subscription
      };
    })
  );
  return ok(enriched);
};
