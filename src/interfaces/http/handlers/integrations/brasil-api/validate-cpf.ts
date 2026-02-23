import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { isValidCpf } from '../../../../../core/domain/services/document-validator';
import { authorizeAppToken } from '../../../middleware/app-token.middleware';
import { fail, ok } from '../../../response';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const appAuthError = authorizeAppToken(event);
  if (appAuthError) {
    return appAuthError;
  }

  const cpf = event.pathParameters?.cpf?.replace(/\D/g, '') ?? '';
  if (cpf.length !== 11) {
    return fail(400, 'CPF invalido.');
  }

  return ok({
    cpf,
    valid: isValidCpf(cpf)
  });
};
