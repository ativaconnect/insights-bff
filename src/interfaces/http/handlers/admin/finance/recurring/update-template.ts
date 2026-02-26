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

interface UpdateTemplateBody {
  name?: string;
  category?: string;
  type?: FinancialExpenseType;
  recurringFrequency?: FinancialRecurringFrequency;
  updateDay?: number;
  dueDay?: number;
  requiresValueUpdate?: boolean;
  defaultAmount?: number;
  supplierId?: string;
  paymentMethod?: FinancialPaymentMethod;
  startMonth?: string;
  endMonth?: string;
  active?: boolean;
  notes?: string;
}

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) return auth;

  const templateId = String(event.pathParameters?.templateId ?? '').trim();
  if (!templateId) return fail(400, 'templateId e obrigatorio.');

  try {
    const body = parseBody<UpdateTemplateBody>(event);
    const supplier = body.supplierId?.trim()
      ? await repository.getSupplierById(body.supplierId.trim())
      : null;
    const updated = await repository.updateRecurringTemplate(templateId, {
      ...body,
      supplierId: body.supplierId !== undefined ? body.supplierId.trim() : undefined,
      supplierName: body.supplierId !== undefined ? (supplier?.name ?? undefined) : undefined
    });
    if (!updated) return fail(404, 'Template nao encontrado.');
    return ok(updated);
  } catch {
    return fail(400, 'Corpo da requisicao invalido.');
  }
};

export const handler = withLoggedHandler('admin/finance/recurring/update-template', rawHandler);


