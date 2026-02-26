import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import {
  CustomerSurveyRepository,
  SurveySubmissionError
} from '../../../../../infrastructure/persistence/dynamodb/customer-survey.repository';
import { TenantSubscriptionRepository } from '../../../../../infrastructure/persistence/dynamodb/tenant-subscription.repository';
import {
  SubmitSurveyResponsesBatchRequestSchema,
  type SubmitSurveyResponsesBatchRequestDto
} from '../../../docs/schemas';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBodyWithSchema, RequestValidationError } from '../../../request';
import { fail, ok } from '../../../response';

const repository = new CustomerSurveyRepository();
const subscriptionRepository = new TenantSubscriptionRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
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
    if (auth.role === 'ROLE_INTERVIEWER') {
      const interviewerId = auth.interviewerId ?? auth.subject;
      const allowed = await repository.listAvailableForInterviewer(auth.tenantId, interviewerId);
      if (!allowed.some((survey) => survey.id === surveyId)) {
        return fail(403, 'Entrevistador nao vinculado ou sem cota para esta pesquisa.');
      }
    }

    const body = parseBodyWithSchema<SubmitSurveyResponsesBatchRequestDto>(
      event,
      SubmitSurveyResponsesBatchRequestSchema
    );

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
    if (error instanceof RequestValidationError) {
      return fail(400, error.message);
    }
    if (error instanceof SurveySubmissionError) {
      return fail(422, error.message);
    }
    return fail(400, 'Nao foi possivel registrar respostas.');
  }
};

export const handler = withLoggedHandler('customer/surveys/submit-responses-batch', rawHandler);


