import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const repository = new AdminOwnerRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const planId = event.pathParameters?.planId;
  if (!planId) {
    return fail(400, 'Identificador do plano e obrigatorio.');
  }

  const deleted = await repository.softDeletePlanDefinition(planId, auth.subject);
  if (!deleted) {
    return fail(404, 'Plano nao encontrado.');
  }

  return ok(deleted);
};
