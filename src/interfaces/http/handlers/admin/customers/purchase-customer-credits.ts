import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { TenantSubscriptionRepository } from '../../../../../infrastructure/persistence/dynamodb/tenant-subscription.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

interface PurchaseCreditsRequest {
  productCode?: string;
  planCode: string;
  credits?: number;
}

const repository = new TenantSubscriptionRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const tenantId = event.pathParameters?.tenantId;
  if (!tenantId) {
    return fail(400, 'tenantId obrigatorio.');
  }

  try {
    const body = parseBody<PurchaseCreditsRequest>(event);
    if (!body.planCode) {
      return fail(400, 'planCode obrigatorio.');
    }

    const credits = body.credits === undefined ? undefined : Number(body.credits);
    const productCode = normalizeProductCode(body.productCode);
    if (credits !== undefined && (!Number.isInteger(credits) || credits <= 0)) {
      return fail(400, 'Quantidade de creditos invalida.');
    }

    const updated = await repository.purchaseCredits(tenantId, body.planCode, credits, productCode);
    if (!updated) {
      return fail(404, 'Tenant nao encontrado.');
    }

    return ok(updated);
  } catch (error: any) {
    if (error?.message === 'PLAN_NOT_AVAILABLE') {
      return fail(422, 'Plano informado indisponivel para compra.');
    }
    if (error?.message === 'PLAN_NOT_PURCHASABLE') {
      return fail(422, 'Plano START nao esta disponivel para compra.');
    }
    return fail(400, 'Nao foi possivel concluir a compra de creditos.');
  }
};
