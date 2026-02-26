import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { InterviewerRepository } from '../../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const repository = new InterviewerRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  const interviewers = await repository.list(auth.tenantId);
  return ok(interviewers);
};

export const handler = withLoggedHandler('customer/interviewers/list-interviewers', rawHandler);


