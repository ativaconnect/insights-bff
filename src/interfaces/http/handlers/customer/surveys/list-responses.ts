import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { CustomerSurveyRepository } from '../../../../../infrastructure/persistence/dynamodb/customer-survey.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const repository = new CustomerSurveyRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
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

  const responses = await repository.listResponses(auth.tenantId, surveyId);
  return ok(responses);
};

export const handler = withLoggedHandler('customer/surveys/list-responses', rawHandler);


