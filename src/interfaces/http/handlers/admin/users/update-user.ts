import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  normalizeOwnerAdminPermissions,
  type OwnerAdminAccessLevel
} from '../../../../../core/domain/value-objects/admin-permissions';
import { OwnerAdminUserRepository } from '../../../../../infrastructure/persistence/dynamodb/owner-admin-user.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';

interface UpdateUserRequest {
  name?: string;
  password?: string;
  accessLevel?: OwnerAdminAccessLevel;
  permissions?: string[];
  active?: boolean;
}

const repository = new OwnerAdminUserRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const userId = event.pathParameters?.userId;
  if (!userId) {
    return fail(400, 'userId obrigatorio.');
  }

  try {
    const body = parseBody<UpdateUserRequest>(event);
    if (body.password && String(body.password).trim().length < 6) {
      return fail(400, 'Senha deve ter no minimo 6 caracteres.');
    }

    const updated = await repository.updateUser(userId, {
      actorId: auth.subject,
      name: body.name ? String(body.name).trim() : undefined,
      password: body.password ? String(body.password) : undefined,
      accessLevel: body.accessLevel,
      permissions: body.permissions ? normalizeOwnerAdminPermissions(body.permissions) : undefined,
      active: typeof body.active === 'boolean' ? body.active : undefined
    });
    if (!updated) {
      return fail(404, 'Usuario nao encontrado.');
    }
    return ok(updated);
  } catch {
    return fail(400, 'Nao foi possivel atualizar usuario.');
  }
};

