import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { CustomerSurveyRepository } from '../../../../../infrastructure/persistence/dynamodb/customer-survey.repository';
import { TenantSubscriptionRepository } from '../../../../../infrastructure/persistence/dynamodb/tenant-subscription.repository';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';

const repository = new CustomerSurveyRepository();
const subscriptionRepository = new TenantSubscriptionRepository();

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

  try {
    const body = parseBody<Record<string, unknown>>(event);
    if (Array.isArray(body.questions)) {
      const subscription = await subscriptionRepository.getSnapshot(auth.tenantId);
      if (!subscription) {
        return fail(404, 'Perfil de assinatura nao encontrado.');
      }
      if (body.questions.length > subscription.limits.maxQuestionsPerSurvey) {
        return fail(
          422,
          `Seu plano permite no maximo ${subscription.limits.maxQuestionsPerSurvey} questoes por pesquisa.`
        );
      }
    }
    if (Array.isArray(body.waves) || Array.isArray(body.interviewerAssignments)) {
      const subscription = await subscriptionRepository.getSnapshot(auth.tenantId);
      if (!subscription) {
        return fail(404, 'Perfil de assinatura nao encontrado.');
      }
      const maxInterviewers = subscription.limits.maxInterviewers;
      if (Array.isArray(body.waves)) {
        for (const wave of body.waves as Array<{ interviewerAssignments?: unknown[] }>) {
          const count = Array.isArray(wave?.interviewerAssignments) ? wave.interviewerAssignments.length : 0;
          if (count > maxInterviewers) {
            return fail(422, `Seu plano permite no maximo ${maxInterviewers} entrevistadores por rodada.`);
          }
        }
      } else if (Array.isArray(body.interviewerAssignments) && body.interviewerAssignments.length > maxInterviewers) {
        return fail(422, `Seu plano permite no maximo ${maxInterviewers} entrevistadores vinculados por pesquisa.`);
      }
    }
    const survey = await repository.update(auth.tenantId, surveyId, body as any);
    if (!survey) {
      return fail(404, 'Pesquisa nao encontrada.');
    }
    return ok(survey);
  } catch {
    return fail(400, 'Nao foi possivel atualizar pesquisa.');
  }
};

export const handler = withLoggedHandler('customer/surveys/update-survey', rawHandler);


