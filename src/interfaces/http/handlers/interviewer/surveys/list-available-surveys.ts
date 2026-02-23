import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerSurveyRepository } from '../../../../../infrastructure/persistence/dynamodb/customer-survey.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const repository = new CustomerSurveyRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_INTERVIEWER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId || !auth.interviewerId) {
    return fail(403, 'Entrevistador invalido.');
  }

  const surveys = await repository.listAvailableForInterviewer(auth.tenantId, auth.interviewerId);
  return ok(surveys);
};
