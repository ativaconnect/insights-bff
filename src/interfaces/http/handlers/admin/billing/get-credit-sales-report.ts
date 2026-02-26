import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import {
  CreditPurchaseRequestRepository,
  type CreditPurchaseRequestStatus
} from '../../../../../infrastructure/persistence/dynamodb/credit-purchase-request.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

const adminRepository = new AdminOwnerRepository();
const requestsRepository = new CreditPurchaseRequestRepository();

type BillingFilterStatus = 'ALL' | CreditPurchaseRequestStatus | 'OPEN';

const parseDateOnly = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
};

const matchesStatus = (status: CreditPurchaseRequestStatus, filter: BillingFilterStatus): boolean => {
  if (filter === 'ALL') return true;
  if (filter === 'OPEN') return status === 'PENDING' || status === 'IN_ANALYSIS';
  return status === filter;
};

const inPeriod = (requestedAt: string, fromDate: string | null, toDate: string | null): boolean => {
  const day = requestedAt.slice(0, 10);
  if (fromDate && day < fromDate) return false;
  if (toDate && day > toDate) return false;
  return true;
};

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const tenantIdFilter = String(event.queryStringParameters?.tenantId ?? '').trim();
  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const rawStatus = String(event.queryStringParameters?.status ?? 'ALL').trim().toUpperCase();
  const statusFilter = (
    rawStatus === 'PENDING' ||
    rawStatus === 'IN_ANALYSIS' ||
    rawStatus === 'APPROVED' ||
    rawStatus === 'REJECTED' ||
    rawStatus === 'OPEN'
    ? rawStatus
    : 'ALL') as BillingFilterStatus;
  const fromDate = parseDateOnly(event.queryStringParameters?.dateFrom);
  const toDate = parseDateOnly(event.queryStringParameters?.dateTo);

  const requestsPromise =
    statusFilter === 'PENDING' || statusFilter === 'IN_ANALYSIS' || statusFilter === 'APPROVED' || statusFilter === 'REJECTED'
      ? requestsRepository.listForAdmin(statusFilter, productCode)
      : statusFilter === 'OPEN'
        ? Promise.all([
            requestsRepository.listForAdmin('PENDING', productCode),
            requestsRepository.listForAdmin('IN_ANALYSIS', productCode)
          ]).then(([pending, inAnalysis]) => [...pending, ...inAnalysis])
        : requestsRepository.listForAdmin(undefined, productCode);

  const [customers, plans, requests] = await Promise.all([
    adminRepository.listCustomers(),
    adminRepository.listPlanDefinitions(productCode),
    requestsPromise
  ]);

  const tenantNameMap = new Map(customers.map((customer) => [customer.tenantId, customer.tradeName || customer.legalName]));
  const planPriceMap = new Map(
    plans.map((plan) => [plan.code.toUpperCase(), Number(plan.pricePerForm ?? 0)])
  );

  const filtered = requests.filter((item) => {
    if (tenantIdFilter && item.tenantId !== tenantIdFilter) {
      return false;
    }
    if (!matchesStatus(item.status, statusFilter)) {
      return false;
    }
    if (!inPeriod(item.requestedAt, fromDate, toDate)) {
      return false;
    }
    return true;
  });

  const items = filtered
    .map((request) => {
      const fallbackPrice = planPriceMap.get(String(request.requestedPlanCode).toUpperCase()) ?? 0;
      const pricePerForm = Number.isFinite(request.requestedPricePerForm)
        ? Number(request.requestedPricePerForm)
        : fallbackPrice;
      const estimatedAmount = Number.isFinite(request.estimatedAmount)
        ? Number(request.estimatedAmount)
        : Number((Number(request.requestedCredits ?? 0) * pricePerForm).toFixed(2));
      return {
        ...request,
        tenantName: tenantNameMap.get(request.tenantId) ?? request.tenantId,
        pricePerForm,
        estimatedAmount
      };
    })
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

  const summary = {
    totalRequests: items.length,
    approvedRequests: items.filter((item) => item.status === 'APPROVED').length,
    pendingRequests: items.filter((item) => item.status === 'PENDING').length,
    inAnalysisRequests: items.filter((item) => item.status === 'IN_ANALYSIS').length,
    rejectedRequests: items.filter((item) => item.status === 'REJECTED').length,
    approvedRevenue: Number(
      items
        .filter((item) => item.status === 'APPROVED')
        .reduce((acc, item) => acc + item.estimatedAmount, 0)
        .toFixed(2)
    ),
    openRevenue: Number(
      items
        .filter((item) => item.status === 'PENDING')
        .concat(items.filter((item) => item.status === 'IN_ANALYSIS'))
        .reduce((acc, item) => acc + item.estimatedAmount, 0)
        .toFixed(2)
    )
  };

  const revenueByTenant = Array.from(
    items.reduce((acc, item) => {
      const key = item.tenantId;
      const current = acc.get(key) ?? {
        tenantId: item.tenantId,
        tenantName: item.tenantName,
        approvedRevenue: 0,
        openRevenue: 0,
        requests: 0
      };
      current.requests += 1;
      if (item.status === 'APPROVED') {
        current.approvedRevenue = Number((current.approvedRevenue + item.estimatedAmount).toFixed(2));
      }
      if (item.status === 'PENDING' || item.status === 'IN_ANALYSIS') {
        current.openRevenue = Number((current.openRevenue + item.estimatedAmount).toFixed(2));
      }
      acc.set(key, current);
      return acc;
    }, new Map<string, { tenantId: string; tenantName: string; approvedRevenue: number; openRevenue: number; requests: number }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => b.approvedRevenue - a.approvedRevenue);

  return ok({
    filters: {
      tenantId: tenantIdFilter || null,
      productCode,
      status: statusFilter,
      dateFrom: fromDate,
      dateTo: toDate
    },
    summary,
    revenueByTenant,
    items
  });
};

export const handler = withLoggedHandler('admin/billing/get-credit-sales-report', rawHandler);


