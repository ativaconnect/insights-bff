import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { fail, ok } from '../../../response';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const cnpj = event.pathParameters?.cnpj?.replace(/\D/g, '') ?? '';
  if (cnpj.length !== 14) {
    return fail(400, 'CNPJ invalido.');
  }

  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!response.ok) {
    return fail(404, 'CNPJ nao encontrado na BrasilAPI.');
  }

  const data = await response.json();
  return ok(data);
};
