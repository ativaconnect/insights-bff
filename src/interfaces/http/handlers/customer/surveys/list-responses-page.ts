import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerSurveyRepository } from '../../../../../infrastructure/persistence/dynamodb/customer-survey.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const repository = new CustomerSurveyRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  const surveyId = event.pathParameters?.surveyId;
  if (!surveyId) {
    return fail(400, 'surveyId obrigatorio.');
  }

  const limitRaw = Number(event.queryStringParameters?.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  const cursor = event.queryStringParameters?.cursor;

  const page = await repository.listResponsesPage(auth.tenantId, surveyId, limit, cursor);
  return ok(page);
};

