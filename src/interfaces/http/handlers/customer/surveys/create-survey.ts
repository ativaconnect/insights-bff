import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  CustomerSurveyRepository,
  type SurveyInterviewerAssignment,
  type SurveyKioskSettings,
  type SurveyLocationCapture,
  type SurveyQuotaRule,
  type SurveyWave,
  type SurveyQuestion
} from '../../../../../infrastructure/persistence/dynamodb/customer-survey.repository';
import { TenantSubscriptionRepository } from '../../../../../infrastructure/persistence/dynamodb/tenant-subscription.repository';
import { logger } from '../../../../../infrastructure/observability/logger';
import { CreateSurveyRequestSchema, type CreateSurveyRequestDto } from '../../../docs/schemas';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBodyWithSchema, RequestValidationError } from '../../../request';
import { fail, ok } from '../../../response';

const repository = new CustomerSurveyRepository();
const subscriptionRepository = new TenantSubscriptionRepository();

const serializeError = (error: unknown): Record<string, unknown> => {
  if (!error || typeof error !== 'object') {
    return { value: String(error) };
  }
  const maybe = error as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    code?: unknown;
    statusCode?: unknown;
    '$metadata'?: { requestId?: unknown; httpStatusCode?: unknown };
  };
  return {
    name: String(maybe.name ?? 'Error'),
    message: String(maybe.message ?? 'unknown_error'),
    code: maybe.code ? String(maybe.code) : undefined,
    statusCode: maybe.statusCode ? Number(maybe.statusCode) : undefined,
    awsRequestId: maybe.$metadata?.requestId ? String(maybe.$metadata.requestId) : undefined,
    awsHttpStatusCode: maybe.$metadata?.httpStatusCode ? Number(maybe.$metadata.httpStatusCode) : undefined,
    stack: typeof maybe.stack === 'string' ? maybe.stack : undefined
  };
};

const summarizePayload = (body: CreateSurveyRequestDto): Record<string, unknown> => ({
  name: body.name,
  status: body.status ?? 'draft',
  audience: body.audience ?? null,
  questionsCount: Array.isArray(body.questions) ? body.questions.length : 0,
  quotaRulesCount: Array.isArray(body.quotaRules) ? body.quotaRules.length : 0,
  interviewerAssignmentsCount: Array.isArray(body.interviewerAssignments) ? body.interviewerAssignments.length : 0,
  wavesCount: Array.isArray(body.waves) ? body.waves.length : 0,
  hasLocationCapture: Boolean(body.locationCapture),
  hasKioskSettings: Boolean(body.kioskSettings)
});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  const requestContext = {
    requestId: event.requestContext.requestId,
    tenantId: auth.tenantId,
    subject: auth.subject,
    path: event.rawPath,
    method: event.requestContext.http.method,
    sourceIp: event.requestContext.http.sourceIp
  };

  try {
    logger.info('survey.create.request.received', {
      ...requestContext,
      hasBody: Boolean(event.body),
      bodyLength: event.body ? event.body.length : 0
    });

    const body = parseBodyWithSchema<CreateSurveyRequestDto>(event, CreateSurveyRequestSchema);
    logger.debug('survey.create.request.validated', {
      ...requestContext,
      payload: summarizePayload(body)
    });

    const subscription = await subscriptionRepository.getSnapshot(auth.tenantId);
    if (!subscription) {
      logger.warn('survey.create.subscription.not_found', requestContext);
      return fail(404, 'Perfil de assinatura nao encontrado.');
    }
    logger.debug('survey.create.subscription.loaded', {
      ...requestContext,
      planCode: subscription.planCode,
      limits: subscription.limits
    });
    const surveys = await repository.list(auth.tenantId);
    if (surveys.length >= subscription.limits.maxSurveys) {
      logger.warn('survey.create.limit.max_surveys', {
        ...requestContext,
        existingSurveys: surveys.length,
        maxSurveys: subscription.limits.maxSurveys
      });
      return fail(422, `Seu plano permite no maximo ${subscription.limits.maxSurveys} pesquisas.`);
    }

    const questionCount = (body.questions ?? []).length;
    if (questionCount > subscription.limits.maxQuestionsPerSurvey) {
      logger.warn('survey.create.limit.max_questions', {
        ...requestContext,
        questionCount,
        maxQuestionsPerSurvey: subscription.limits.maxQuestionsPerSurvey
      });
      return fail(
        422,
        `Seu plano permite no maximo ${subscription.limits.maxQuestionsPerSurvey} questoes por pesquisa.`
      );
    }
    if (Array.isArray(body.waves)) {
      const maxInterviewers = subscription.limits.maxInterviewers;
      for (const wave of body.waves) {
        const count = Array.isArray(wave?.interviewerAssignments) ? wave.interviewerAssignments.length : 0;
        if (count > maxInterviewers) {
          logger.warn('survey.create.limit.max_interviewers_per_wave', {
            ...requestContext,
            waveId: wave?.id ?? null,
            assignedInterviewers: count,
            maxInterviewers
          });
          return fail(422, `Seu plano permite no maximo ${maxInterviewers} entrevistadores por rodada.`);
        }
      }
    } else if ((body.interviewerAssignments ?? []).length > subscription.limits.maxInterviewers) {
      logger.warn('survey.create.limit.max_interviewers_legacy', {
        ...requestContext,
        assignedInterviewers: (body.interviewerAssignments ?? []).length,
        maxInterviewers: subscription.limits.maxInterviewers
      });
      return fail(
        422,
        `Seu plano permite no maximo ${subscription.limits.maxInterviewers} entrevistadores vinculados por pesquisa.`
      );
    }

    const survey = await repository.create(auth.tenantId, {
      name: body.name,
      description: body.description ?? '',
      status: body.status ?? 'draft',
      audience: body.audience,
      questions: (body.questions as SurveyQuestion[] | undefined) ?? [],
      quotaRules: (body.quotaRules as SurveyQuotaRule[] | undefined) ?? [],
      interviewerAssignments: (body.interviewerAssignments as SurveyInterviewerAssignment[] | undefined) ?? [],
      waves: (body.waves as SurveyWave[] | undefined) ?? [],
      locationCapture: body.locationCapture as SurveyLocationCapture | undefined,
      kioskSettings: body.kioskSettings as SurveyKioskSettings | undefined
    });

    logger.info('survey.create.success', {
      ...requestContext,
      surveyId: survey.id,
      status: survey.status,
      questionsCount: survey.questions?.length ?? 0
    });
    return ok(survey, 201);
  } catch (error: unknown) {
    logger.error('survey.create.failed', {
      ...requestContext,
      error: serializeError(error)
    });
    if (error instanceof RequestValidationError) {
      return fail(400, error.message);
    }
    return fail(500, 'Nao foi possivel criar pesquisa.');
  }
};
