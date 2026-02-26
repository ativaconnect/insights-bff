import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { SurveyAnalyticsSnapshotService } from '../../../../../infrastructure/analytics/survey-analytics-snapshot.service';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

const analytics = new SurveyAnalyticsSnapshotService();

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

  const snapshot = await analytics.getSnapshot(auth.tenantId, surveyId);
  if (!snapshot) {
    return fail(404, 'Pesquisa nao encontrada.');
  }

  return ok({
    surveyId: snapshot.surveyId,
    responsesCount: snapshot.responsesCount,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    generatedAt: snapshot.generatedAt
  });
};

export const handler = withLoggedHandler('customer/surveys/get-responses-summary', rawHandler);


