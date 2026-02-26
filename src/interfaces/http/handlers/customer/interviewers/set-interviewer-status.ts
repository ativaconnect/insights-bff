import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { InterviewerRepository } from '../../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import {
  SetInterviewerStatusRequestSchema,
  type SetInterviewerStatusRequestDto
} from '../../../docs/schemas';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBodyWithSchema, RequestValidationError } from '../../../request';
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

  const interviewerId = event.pathParameters?.interviewerId;
  if (!interviewerId) {
    return fail(400, 'interviewerId obrigatorio.');
  }

  try {
    const body = parseBodyWithSchema<SetInterviewerStatusRequestDto>(event, SetInterviewerStatusRequestSchema);

    const updated = await repository.setStatus(auth.tenantId, interviewerId, body.status);
    if (!updated) {
      return fail(404, 'Entrevistador nao encontrado.');
    }

    return ok(updated);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return fail(400, error.message);
    }
    return fail(400, 'Nao foi possivel alterar status do entrevistador.');
  }
};

export const handler = withLoggedHandler('customer/interviewers/set-interviewer-status', rawHandler);


