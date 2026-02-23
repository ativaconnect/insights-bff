import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { fail, ok } from '../../../response';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const cep = event.pathParameters?.cep?.replace(/\D/g, '') ?? '';
  if (cep.length !== 8) {
    return fail(400, 'CEP invalido.');
  }

  const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
  if (!response.ok) {
    return fail(404, 'CEP nao encontrado na BrasilAPI.');
  }

  const data = await response.json();
  return ok(data);
};
