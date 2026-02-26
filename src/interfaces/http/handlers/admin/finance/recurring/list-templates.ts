import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../../logged-handler';
import { FinancialControlRepository } from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { ok } from '../../../../response';

const repository = new FinancialControlRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const items = await repository.listRecurringTemplates();
  return ok(items);
};

export const handler = withLoggedHandler('admin/finance/recurring/list-templates', rawHandler);


