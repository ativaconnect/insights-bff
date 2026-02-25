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
import { CreateSurveyRequestSchema, type CreateSurveyRequestDto } from '../../../docs/schemas';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBodyWithSchema, RequestValidationError } from '../../../request';
import { fail, ok } from '../../../response';

const repository = new CustomerSurveyRepository();
const subscriptionRepository = new TenantSubscriptionRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_CUSTOMER');
  if (isAuthorizationError(auth)) {
    return auth;
  }
  if (!auth.tenantId) {
    return fail(403, 'Tenant invalido.');
  }

  try {
    const body = parseBodyWithSchema<CreateSurveyRequestDto>(event, CreateSurveyRequestSchema);

    const subscription = await subscriptionRepository.getSnapshot(auth.tenantId);
    if (!subscription) {
      return fail(404, 'Perfil de assinatura nao encontrado.');
    }
    const surveys = await repository.list(auth.tenantId);
    if (surveys.length >= subscription.limits.maxSurveys) {
      return fail(422, `Seu plano permite no maximo ${subscription.limits.maxSurveys} pesquisas.`);
    }

    const questionCount = (body.questions ?? []).length;
    if (questionCount > subscription.limits.maxQuestionsPerSurvey) {
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
          return fail(422, `Seu plano permite no maximo ${maxInterviewers} entrevistadores por rodada.`);
        }
      }
    } else if ((body.interviewerAssignments ?? []).length > subscription.limits.maxInterviewers) {
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

    return ok(survey, 201);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return fail(400, error.message);
    }
    return fail(400, 'Nao foi possivel criar pesquisa.');
  }
};
