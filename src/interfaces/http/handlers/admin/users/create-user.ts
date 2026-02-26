import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import {
  normalizeOwnerAdminPermissions,
  type OwnerAdminAccessLevel
} from '../../../../../core/domain/value-objects/admin-permissions';
import { OwnerAdminUserRepository } from '../../../../../infrastructure/persistence/dynamodb/owner-admin-user.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';

interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  accessLevel: OwnerAdminAccessLevel;
  permissions?: string[];
  active?: boolean;
}

const repository = new OwnerAdminUserRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  try {
    const body = parseBody<CreateUserRequest>(event);
    if (!body.name || !body.email || !body.password || !body.accessLevel) {
      return fail(400, 'name, email, password e accessLevel sao obrigatorios.');
    }
    if (String(body.password).trim().length < 6) {
      return fail(400, 'Senha deve ter no minimo 6 caracteres.');
    }

    const created = await repository.createUser({
      actorId: auth.subject,
      tenantId: auth.tenantId,
      name: String(body.name).trim(),
      email: String(body.email).trim(),
      password: String(body.password),
      accessLevel: body.accessLevel,
      permissions: normalizeOwnerAdminPermissions(body.permissions),
      active: body.active
    });
    return ok(created, 201);
  } catch (error: unknown) {
    const message = String((error as { message?: string })?.message ?? '');
    if (message.includes('ConditionalCheckFailedException')) {
      return fail(409, 'Ja existe um usuario com este email.');
    }
    return fail(400, 'Nao foi possivel criar usuario.');
  }
};

export const handler = withLoggedHandler('admin/users/create-user', rawHandler);


