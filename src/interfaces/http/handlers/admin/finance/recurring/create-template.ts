import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../../logged-handler';
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

interface CreateTemplateBody {
  name: string;
  category: string;
  type: FinancialExpenseType;
  recurringFrequency: FinancialRecurringFrequency;
  updateDay: number;
  dueDay?: number;
  requiresValueUpdate: boolean;
  defaultAmount?: number;
  supplierId?: string;
  paymentMethod?: FinancialPaymentMethod;
  startMonth: string;
  endMonth?: string;
  active?: boolean;
  notes?: string;
}

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) return auth;

  try {
    const body = parseBody<CreateTemplateBody>(event);
    if (!body.name?.trim()) return fail(400, 'Nome do template e obrigatorio.');
    if (!body.category?.trim()) return fail(400, 'Categoria e obrigatoria.');
    if (!body.startMonth?.trim()) return fail(400, 'Mes inicial e obrigatorio.');
    if (!Number.isFinite(Number(body.updateDay)) || Number(body.updateDay) < 1) {
      return fail(400, 'Dia de atualizacao invalido.');
    }

    const supplier = body.supplierId?.trim()
      ? await repository.getSupplierById(body.supplierId.trim())
      : null;
    const created = await repository.createRecurringTemplate({
      ...body,
      supplierId: body.supplierId?.trim() || undefined,
      supplierName: supplier?.name,
      createdBy: auth.subject
    });
    return ok(created, 201);
  } catch {
    return fail(400, 'Corpo da requisicao invalido.');
  }
};

export const handler = withLoggedHandler('admin/finance/recurring/create-template', rawHandler);


