import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerAccountRepository } from '../../../../infrastructure/persistence/dynamodb/customer-account.repository';
import { authorize, isAuthorizationError } from '../../middleware/auth.middleware';
import { parseBody } from '../../request';
import { fail, ok } from '../../response';

const repository = new CustomerAccountRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  try {
    const body = parseBody<Record<string, unknown>>(event);
    const updated = await repository.updateProfile(auth.tenantId, body as any);
    if (!updated) {
      return fail(404, 'Perfil nao encontrado.');
    }
    return ok(updated);
  } catch {
    return fail(400, 'Nao foi possivel atualizar perfil.');
  }
};
