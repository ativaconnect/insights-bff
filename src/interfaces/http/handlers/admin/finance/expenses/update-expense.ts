import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  FinancialControlRepository,
  type FinancialExpenseStatus,
  type FinancialExpenseType,
  type FinancialPaymentMethod
} from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { parseBody } from '../../../../request';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { fail, ok } from '../../../../response';

const repository = new FinancialControlRepository();

interface UpdateExpenseBody {
  occurredOn?: string;
  dueOn?: string;
  description?: string;
  type?: FinancialExpenseType;
  category?: string;
  amount?: number;
  status?: FinancialExpenseStatus;
  supplierId?: string;
  paymentMethod?: FinancialPaymentMethod;
  notes?: string;
  isForecast?: boolean;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const expenseId = String(event.pathParameters?.expenseId ?? '').trim();
  if (!expenseId) {
    return fail(400, 'expenseId e obrigatorio.');
  }

  try {
    const body = parseBody<UpdateExpenseBody>(event);
    let supplierName: string | undefined;
    if (body.supplierId !== undefined) {
      const normalized = body.supplierId.trim();
      if (normalized) {
        const supplier = await repository.getSupplierById(normalized);
        supplierName = supplier?.name;
      }
    }

    const updated = await repository.updateExpense(expenseId, {
      ...body,
      supplierId: body.supplierId !== undefined ? body.supplierId.trim() : undefined,
      supplierName
    });
    if (!updated) {
      return fail(404, 'Despesa nao encontrada.');
    }
    return ok(updated);
  } catch {
    return fail(400, 'Corpo da requisicao invalido.');
  }
};

