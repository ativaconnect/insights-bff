import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { FinancialControlRepository } from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { fail, ok } from '../../../../response';

const repository = new FinancialControlRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) return auth;

  const month = String(event.queryStringParameters?.month ?? '').trim().slice(0, 7);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return fail(400, 'Mes invalido. Use YYYY-MM.');
  }

  const items = await repository.listPendingValueUpdates(month);
  return ok(items);
};
