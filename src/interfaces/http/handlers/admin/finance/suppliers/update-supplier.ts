import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { FinancialControlRepository } from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { parseBody } from '../../../../request';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { fail, ok } from '../../../../response';

const repository = new FinancialControlRepository();

interface UpdateSupplierBody {
  name?: string;
  document?: string;
  category?: string;
  email?: string;
  phone?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  notes?: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const supplierId = String(event.pathParameters?.supplierId ?? '').trim();
  if (!supplierId) {
    return fail(400, 'supplierId e obrigatorio.');
  }

  try {
    const body = parseBody<UpdateSupplierBody>(event);
    const updated = await repository.updateSupplier(supplierId, body);
    if (!updated) {
      return fail(404, 'Fornecedor nao encontrado.');
    }
    return ok(updated);
  } catch {
    return fail(400, 'Corpo da requisicao invalido.');
  }
};

