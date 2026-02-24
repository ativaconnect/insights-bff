import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { OwnerAdminUserRepository } from '../../../../../infrastructure/persistence/dynamodb/owner-admin-user.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const repository = new OwnerAdminUserRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  const users = await repository.listUsers();
  return ok(users);
};

