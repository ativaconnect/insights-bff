import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { FrontendSettingsRepository } from '../../../../../infrastructure/persistence/dynamodb/frontend-settings.repository';
import { normalizeProductCode } from '../../../../../shared/products';
import { ok } from '../../../response';

const repository = new FrontendSettingsRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const productCode = normalizeProductCode(event.queryStringParameters?.productCode);
  const settings = await repository.getOrDefault(productCode);
  return ok(settings);
};
