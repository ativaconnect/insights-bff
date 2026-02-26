import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../../logged-handler';
import { FinancialControlRepository } from '../../../../../../infrastructure/persistence/dynamodb/financial-control.repository';
import { parseBody } from '../../../../request';
import { authorize, isAuthorizationError } from '../../../../middleware/auth.middleware';
import { fail, ok } from '../../../../response';

const repository = new FinancialControlRepository();

interface CreateSupplierBody {
  name: string;
  document?: string;
  category?: string;
  email?: string;
  phone?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  notes?: string;
}

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  try {
    const body = parseBody<CreateSupplierBody>(event);
    if (!body.name?.trim()) {
      return fail(400, 'Nome do fornecedor e obrigatorio.');
    }

    const created = await repository.createSupplier(body);
    return ok(created, 201);
  } catch {
    return fail(400, 'Corpo da requisicao invalido.');
  }
};

export const handler = withLoggedHandler('admin/finance/suppliers/create-supplier', rawHandler);


