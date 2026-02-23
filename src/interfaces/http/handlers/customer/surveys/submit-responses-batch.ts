import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  CustomerSurveyRepository,
  SurveySubmissionError,
  type SurveyGeoPoint
} from '../../../../../infrastructure/persistence/dynamodb/customer-survey.repository';
import { TenantSubscriptionRepository } from '../../../../../infrastructure/persistence/dynamodb/tenant-subscription.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';

const repository = new CustomerSurveyRepository();
const subscriptionRepository = new TenantSubscriptionRepository();

interface SubmitResponseBatchRequest {
  responses: Array<{
    answers: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    clientResponseId?: string;
    submittedAt?: string;
    interviewerId?: string;
    deviceId?: string;
    location?: SurveyGeoPoint;
  }>;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, ['ROLE_CUSTOMER', 'ROLE_INTERVIEWER']);
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

  try {
    const body = parseBody<SubmitResponseBatchRequest>(event);
    if (!Array.isArray(body.responses) || body.responses.length === 0) {
      return fail(400, 'responses obrigatorio.');
    }

    const subscription = await subscriptionRepository.getSnapshot(auth.tenantId);
    if (!subscription) {
      return fail(404, 'Perfil de assinatura nao encontrado.');
    }

    const normalized = body.responses.map((item) => ({
      ...item,
      interviewerId: auth.role === 'ROLE_INTERVIEWER' ? auth.interviewerId ?? auth.subject : item.interviewerId,
      maxResponsesPerSurvey: subscription.limits.maxResponsesPerSurvey,
      defaultCreditsBalance: subscription.questionnaireCreditsBalance
    }));

    const created = await repository.addResponsesBatch(auth.tenantId, surveyId, normalized);
    return ok({ accepted: created.length, responses: created }, 201);
  } catch (error: unknown) {
    if (error instanceof SurveySubmissionError) {
      return fail(422, error.message);
    }
    return fail(400, 'Nao foi possivel registrar respostas.');
  }
};
