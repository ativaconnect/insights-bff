import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const repository = new AdminOwnerRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const planId = event.pathParameters?.planId;
  if (!planId) {
    return fail(400, 'Identificador do plano e obrigatorio.');
  }

  const audits = await repository.listPlanAudits(planId);
  return ok(audits);
};

export const handler = withLoggedHandler('admin/plans/list-plan-audits', rawHandler);


