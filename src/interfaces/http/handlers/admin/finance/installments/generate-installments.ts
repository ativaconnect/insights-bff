import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  FinancialControlRepository,
  type FinancialExpenseType,
  type FinancialPaymentMethod,
  type FinancialRecurringFrequency
} from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { parseBody } from '../../../../request';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { fail, ok } from '../../../../response';

const repository = new FinancialControlRepository();

interface GenerateInstallmentsBody {
  description: string;
  category: string;
  type: FinancialExpenseType;
  totalAmount: number;
  installments: number;
  firstDueOn: string;
  recurringFrequency?: FinancialRecurringFrequency;
  supplierId?: string;
  paymentMethod?: FinancialPaymentMethod;
  notes?: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) return auth;

  try {
    const body = parseBody<GenerateInstallmentsBody>(event);
    if (!body.description?.trim()) return fail(400, 'Descricao e obrigatoria.');
    if (!body.category?.trim()) return fail(400, 'Categoria e obrigatoria.');
    if (!body.firstDueOn?.trim()) return fail(400, 'Primeiro vencimento e obrigatorio.');
    if (!Number.isFinite(Number(body.totalAmount)) || Number(body.totalAmount) <= 0) {
      return fail(400, 'Valor total invalido.');
    }
    if (!Number.isFinite(Number(body.installments)) || Number(body.installments) < 1) {
      return fail(400, 'Quantidade de parcelas invalida.');
    }

    const supplier = body.supplierId?.trim()
      ? await repository.getSupplierById(body.supplierId.trim())
      : null;
    const created = await repository.generateInstallments({
      description: body.description,
      category: body.category,
      type: body.type,
      totalAmount: Number(body.totalAmount),
      installments: Number(body.installments),
      firstDueOn: body.firstDueOn,
      recurringFrequency: body.recurringFrequency ?? 'MONTHLY',
      supplierId: body.supplierId?.trim() || undefined,
      supplierName: supplier?.name,
      paymentMethod: body.paymentMethod,
      notes: body.notes,
      createdBy: auth.subject
    });
    return ok({ createdCount: created.length, items: created }, 201);
  } catch {
    return fail(400, 'Corpo da requisicao invalido.');
  }
};

