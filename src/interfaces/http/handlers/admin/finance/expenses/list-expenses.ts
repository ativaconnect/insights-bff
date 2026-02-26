import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../../logged-handler';
import {
  FinancialControlRepository,
  type FinancialExpense,
  type FinancialExpenseStatus,
  type FinancialExpenseType
} from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { ok } from '../../../../response';

const repository = new FinancialControlRepository();

const inPeriod = (occurredOn: string, fromDate?: string, toDate?: string): boolean => {
  const day = occurredOn.slice(0, 10);
  if (fromDate && day < fromDate) return false;
  if (toDate && day > toDate) return false;
  return true;
};

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const statusFilter = String(event.queryStringParameters?.status ?? '').trim().toUpperCase();
  const typeFilter = String(event.queryStringParameters?.type ?? '').trim().toUpperCase();
  const fromDate = String(event.queryStringParameters?.dateFrom ?? '').trim() || undefined;
  const toDate = String(event.queryStringParameters?.dateTo ?? '').trim() || undefined;
  const supplierId = String(event.queryStringParameters?.supplierId ?? '').trim() || undefined;
  const month = String(event.queryStringParameters?.month ?? '').trim().slice(0, 7) || undefined;
  const isForecastRaw = String(event.queryStringParameters?.isForecast ?? '').trim().toLowerCase();
  const isForecastFilter = isForecastRaw === 'true' ? true : isForecastRaw === 'false' ? false : undefined;

  const all = month
    ? await repository.listExpensesByMonth(month, statusFilter ? statusFilter as FinancialExpenseStatus : undefined)
    : await repository.listExpenses();
  const filtered = all.filter((item: FinancialExpense) => {
    if (statusFilter && item.status !== statusFilter as FinancialExpenseStatus) return false;
    if (typeFilter && item.type !== typeFilter as FinancialExpenseType) return false;
    if (supplierId && item.supplierId !== supplierId) return false;
    if (isForecastFilter !== undefined && Boolean(item.isForecast) !== isForecastFilter) return false;
    if (!inPeriod(item.occurredOn, fromDate, toDate)) return false;
    return true;
  });

  return ok(filtered);
};

export const handler = withLoggedHandler('admin/finance/expenses/list-expenses', rawHandler);


