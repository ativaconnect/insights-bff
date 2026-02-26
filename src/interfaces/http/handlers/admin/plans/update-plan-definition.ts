import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import { parseBody } from '../../../request';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';

interface UpdatePlanRequest {
  name: string;
  description?: string;
  tier: number;
  pricePerForm: number;
  minForms: number;
  maxSurveys: number;
  maxQuestionsPerSurvey: number;
  maxResponsesPerSurvey: number;
  maxInterviewers: number;
  active: boolean;
}

const repository = new AdminOwnerRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  const planId = event.pathParameters?.planId;
  if (!planId) {
    return fail(400, 'Identificador do plano e obrigatorio.');
  }

  try {
    const body = parseBody<UpdatePlanRequest>(event);

    if (!body.name) {
      return fail(400, 'Nome do plano e obrigatorio.');
    }

    const pricePerForm = Number(body.pricePerForm);
    const tier = Number(body.tier);
    const minForms = Number(body.minForms);
    const maxSurveys = Number(body.maxSurveys);
    const maxQuestionsPerSurvey = Number(body.maxQuestionsPerSurvey);
    const maxResponsesPerSurvey = Number(body.maxResponsesPerSurvey);
    const maxInterviewers = Number(body.maxInterviewers);

    if (!Number.isFinite(pricePerForm) || pricePerForm < 0) {
      return fail(400, 'Preco por formulario invalido.');
    }
    if (!Number.isInteger(tier) || tier < 0) {
      return fail(400, 'Nivel do plano invalido.');
    }

    if (!Number.isInteger(minForms) || minForms < 0) {
      return fail(400, 'Quantidade minima de formularios invalida.');
    }
    if (!Number.isInteger(maxSurveys) || maxSurveys <= 0) {
      return fail(400, 'Limite maximo de pesquisas invalido.');
    }
    if (!Number.isInteger(maxQuestionsPerSurvey) || maxQuestionsPerSurvey <= 0) {
      return fail(400, 'Limite maximo de questoes por pesquisa invalido.');
    }
    if (!Number.isInteger(maxResponsesPerSurvey) || maxResponsesPerSurvey <= 0) {
      return fail(400, 'Limite maximo de respostas por pesquisa invalido.');
    }
    if (!Number.isInteger(maxInterviewers) || maxInterviewers <= 0) {
      return fail(400, 'Limite maximo de entrevistadores invalido.');
    }

    const updated = await repository.updatePlanDefinition(planId, {
      actorId: auth.subject,
      name: body.name,
      description: body.description,
      tier,
      pricePerForm,
      minForms,
      maxSurveys,
      maxQuestionsPerSurvey,
      maxResponsesPerSurvey,
      maxInterviewers,
      active: Boolean(body.active)
    });

    if (!updated) {
      return fail(404, 'Plano nao encontrado.');
    }

    return ok(updated);
  } catch {
    return fail(400, 'Nao foi possivel atualizar o plano.');
  }
};

export const handler = withLoggedHandler('admin/plans/update-plan-definition', rawHandler);


