import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../../logged-handler';
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

interface CreateExpenseBody {
  occurredOn: string;
  dueOn?: string;
  description: string;
  type: FinancialExpenseType;
  category: string;
  amount: number;
  status?: FinancialExpenseStatus;
  supplierId?: string;
  paymentMethod?: FinancialPaymentMethod;
  notes?: string;
  isForecast?: boolean;
}

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  try {
    const body = parseBody<CreateExpenseBody>(event);
    if (!body.occurredOn?.trim()) {
      return fail(400, 'Data de ocorrencia e obrigatoria.');
    }
    if (!body.description?.trim()) {
      return fail(400, 'Descricao e obrigatoria.');
    }
    if (!body.category?.trim()) {
      return fail(400, 'Categoria e obrigatoria.');
    }
    if (!Number.isFinite(Number(body.amount)) || Number(body.amount) < 0) {
      return fail(400, 'Valor da despesa invalido.');
    }

    let supplierName: string | undefined;
    if (body.supplierId?.trim()) {
      const supplier = await repository.getSupplierById(body.supplierId.trim());
      supplierName = supplier?.name;
    }

    const created = await repository.createExpense({
      ...body,
      supplierId: body.supplierId?.trim() || undefined,
      supplierName,
      createdBy: auth.subject
    });
    return ok(created, 201);
  } catch {
    return fail(400, 'Corpo da requisicao invalido.');
  }
};

export const handler = withLoggedHandler('admin/finance/expenses/create-expense', rawHandler);


