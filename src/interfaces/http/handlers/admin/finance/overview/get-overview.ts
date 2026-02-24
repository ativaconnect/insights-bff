import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  FinancialControlRepository,
  type FinancialExpense
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

const sum = (items: FinancialExpense[]): number =>
  Number(items.reduce((acc, item) => acc + Number(item.amount ?? 0), 0).toFixed(2));

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const fromDate = String(event.queryStringParameters?.dateFrom ?? '').trim() || undefined;
  const toDate = String(event.queryStringParameters?.dateTo ?? '').trim() || undefined;
  const month = String(event.queryStringParameters?.month ?? '').trim().slice(0, 7) || undefined;

  const [suppliers, expenses, forecasts] = await Promise.all([
    repository.listSuppliers(),
    month ? repository.listExpensesByMonth(month) : repository.listExpenses(),
    repository.listForecastMonths()
  ]);
  const templates = await repository.listRecurringTemplates();

  const filtered = expenses.filter((item) => {
    if (month && item.competenceMonth !== month) {
      return false;
    }
    if (!inPeriod(item.occurredOn, fromDate, toDate)) {
      return false;
    }
    return true;
  });

  const fixed = filtered.filter((item) => item.type === 'FIXED');
  const variable = filtered.filter((item) => item.type === 'VARIABLE');
  const open = filtered.filter((item) => item.status === 'OPEN');
  const paid = filtered.filter((item) => item.status === 'PAID');
  const planned = filtered.filter((item) => item.status === 'PLANNED');
  const forecastExpenses = filtered.filter((item) => item.isForecast);

  const topCategories = Array.from(
    filtered.reduce((acc, item) => {
      const key = item.category || 'Sem categoria';
      const current = acc.get(key) ?? 0;
      acc.set(key, current + Number(item.amount ?? 0));
      return acc;
    }, new Map<string, number>())
  )
    .map(([category, amount]) => ({ category, amount: Number(amount.toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const topSuppliers = Array.from(
    filtered.reduce((acc, item) => {
      const key = item.supplierId || item.supplierName || 'Sem fornecedor';
      const current = acc.get(key) ?? { supplier: item.supplierName || 'Sem fornecedor', amount: 0 };
      current.amount += Number(item.amount ?? 0);
      acc.set(key, current);
      return acc;
    }, new Map<string, { supplier: string; amount: number }>())
  )
    .map(([, value]) => ({ supplier: value.supplier, amount: Number(value.amount.toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const monthKey = month ?? new Date().toISOString().slice(0, 7);
  const monthForecast = forecasts.find((item) => item.month === monthKey) ?? null;
  const pendingValueUpdates = filtered.filter((item) => item.status === 'PENDING_VALUE');
  const projectedResult = monthForecast
    ? Number(
        (
          monthForecast.expectedRevenue -
          monthForecast.expectedFixedCosts -
          monthForecast.expectedVariableCosts
        ).toFixed(2)
      )
    : 0;

  return ok({
    filters: {
      dateFrom: fromDate ?? null,
      dateTo: toDate ?? null,
      month: month ?? null
    },
    summary: {
      supplierCount: suppliers.length,
      recurringTemplateCount: templates.filter((item) => item.active).length,
      totalExpenses: sum(filtered),
      fixedExpenses: sum(fixed),
      variableExpenses: sum(variable),
      openExpenses: sum(open),
      paidExpenses: sum(paid),
      plannedExpenses: sum(planned),
      forecastExpenses: sum(forecastExpenses),
      pendingValueUpdates: pendingValueUpdates.length
    },
    topCategories,
    topSuppliers,
    forecast: monthForecast,
    projectedResult
  });
};

