import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { FinancialControlRepository } from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { parseBody } from '../../../../request';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { fail, ok } from '../../../../response';

const repository = new FinancialControlRepository();

interface GenerateMonthBody {
  month: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) return auth;

  try {
    const body = parseBody<GenerateMonthBody>(event);
    const month = String(body.month ?? '').trim().slice(0, 7);
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return fail(400, 'Mes invalido. Use YYYY-MM.');
    }
    const result = await repository.generateRecurringExpensesForMonth(month, auth.subject);
    return ok(result);
  } catch {
    return fail(400, 'Corpo da requisicao invalido.');
  }
};
