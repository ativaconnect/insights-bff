import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import { ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

const repository = new AdminOwnerRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const plans = await repository.listActivePlansForCatalog(productCode);
  return ok(plans);
};
