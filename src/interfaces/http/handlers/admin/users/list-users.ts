import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { OwnerAdminUserRepository } from '../../../../../infrastructure/persistence/dynamodb/owner-admin-user.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const repository = new OwnerAdminUserRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
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

export const handler = withLoggedHandler('admin/users/list-users', rawHandler);


