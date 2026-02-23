import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { FinancialControlRepository } from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { fail, ok } from '../../../../response';

const repository = new FinancialControlRepository();

const emptyForecast = (month: string) => ({
  month,
  expectedRevenue: 0,
  expectedFixedCosts: 0,
  expectedVariableCosts: 0,
  notes: '',
  updatedAt: '',
  updatedBy: ''
});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const month = String(event.pathParameters?.month ?? '').trim().slice(0, 7);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return fail(400, 'Mes invalido. Use o formato YYYY-MM.');
  }

  const forecast = await repository.getForecastMonth(month);
  return ok(forecast ?? emptyForecast(month));
};

