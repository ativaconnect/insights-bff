import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CreditPurchaseRequestRepository } from '../../../../../infrastructure/persistence/dynamodb/credit-purchase-request.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

interface RequestCreditsBody {
  productCode?: string;
  planCode: string;
  credits: number;
  note?: string;
}

const repository = new CreditPurchaseRequestRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(401, 'Tenant nao identificado.');
  }

  try {
    const body = parseBody<RequestCreditsBody>(event);
    if (!body.planCode) {
      return fail(400, 'planCode obrigatorio.');
    }

    const credits = Number(body.credits);
    if (!Number.isInteger(credits) || credits <= 0) {
      return fail(400, 'credits deve ser inteiro positivo.');
    }
    const productCode = normalizeProductCode(body.productCode);

    const created = await repository.createRequest({
      tenantId: auth.tenantId,
      requesterUserId: auth.subject,
      productCode,
      requestedPlanCode: body.planCode,
      requestedCredits: credits,
      note: body.note
    });

    return ok(created, 201);
  } catch (error: any) {
    if (error?.message === 'PLAN_NOT_AVAILABLE') {
      return fail(404, 'Plano nao encontrado ou indisponivel.');
    }
    if (error?.message === 'PLAN_NOT_PURCHASABLE') {
      return fail(422, 'Plano START nao esta disponivel para compra.');
    }
    if (error?.message === 'INVALID_CREDITS') {
      return fail(400, 'Quantidade de creditos invalida.');
    }
    if (error?.message === 'REQUEST_ALREADY_PENDING') {
      return fail(409, 'Ja existe uma solicitacao pendente. Aguarde aprovacao para solicitar novamente.');
    }
    return fail(400, 'Nao foi possivel solicitar compra de creditos.');
  }
};
