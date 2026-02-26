import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { InterviewerRepository } from '../../../../../infrastructure/persistence/dynamodb/interviewer.repository';
import {
  UpdateInterviewerRequestSchema,
  type UpdateInterviewerRequestDto
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
    const body = parseBodyWithSchema<UpdateInterviewerRequestDto>(event, UpdateInterviewerRequestSchema);

    const updated = await repository.update(auth.tenantId, interviewerId, body);
    if (!updated) {
      return fail(404, 'Entrevistador nao encontrado.');
    }

    return ok(updated);
  } catch (error: unknown) {
    if (error instanceof RequestValidationError) {
      return fail(400, error.message);
    }
    const errorName = (error as { name?: string }).name;
    if (errorName === 'TransactionCanceledException' || errorName === 'ConditionalCheckFailedException') {
      return fail(409, 'Login de entrevistador ja cadastrado.');
    }
    return fail(400, 'Nao foi possivel atualizar entrevistador.');
  }
};

export const handler = withLoggedHandler('customer/interviewers/update-interviewer', rawHandler);


