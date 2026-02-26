import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../../logged-handler';
import { FinancialControlRepository } from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { parseBody } from '../../../../request';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { fail, ok } from '../../../../response';

const repository = new FinancialControlRepository();

interface UpsertForecastBody {
  expectedRevenue: number;
  expectedFixedCosts: number;
  expectedVariableCosts: number;
  notes?: string;
}

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const month = String(event.pathParameters?.month ?? '').trim().slice(0, 7);
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return fail(400, 'Mes invalido. Use o formato YYYY-MM.');
  }

  try {
    const body = parseBody<UpsertForecastBody>(event);
    const values = [body.expectedRevenue, body.expectedFixedCosts, body.expectedVariableCosts];
    if (values.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) {
      return fail(400, 'Valores de previsao invalidos.');
    }

    const result = await repository.upsertForecastMonth({
      month,
      expectedRevenue: Number(body.expectedRevenue),
      expectedFixedCosts: Number(body.expectedFixedCosts),
      expectedVariableCosts: Number(body.expectedVariableCosts),
      notes: body.notes,
      updatedBy: auth.subject
    });
    return ok(result);
  } catch {
    return fail(400, 'Corpo da requisicao invalido.');
  }
};

export const handler = withLoggedHandler('admin/finance/forecast/upsert-forecast', rawHandler);


