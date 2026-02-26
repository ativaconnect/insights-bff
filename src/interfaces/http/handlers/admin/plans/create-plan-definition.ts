import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { AdminOwnerRepository } from '../../../../../infrastructure/persistence/dynamodb/admin-owner.repository';
import { parseBody } from '../../../request';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { fail, ok } from '../../../response';
import { normalizeProductCode } from '../../../../../shared/products';

interface CreatePlanRequest {
  productCode?: string;
  code: string;
  name: string;
  description?: string;
  tier: number;
  pricePerForm: number;
  minForms: number;
  maxSurveys: number;
  maxQuestionsPerSurvey: number;
  maxResponsesPerSurvey: number;
  maxInterviewers: number;
  active?: boolean;
}

const repository = new AdminOwnerRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  try {
    const body = parseBody<CreatePlanRequest>(event);
    const productCode = normalizeProductCode(body.productCode);

    if (!body.code || !body.name) {
      return fail(400, 'Codigo e nome do plano sao obrigatorios.');
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

    const plan = await repository.createPlanDefinition({
      actorId: auth.subject,
      productCode,
      code: body.code,
      name: body.name,
      description: body.description,
      tier,
      pricePerForm,
      minForms,
      maxSurveys,
      maxQuestionsPerSurvey,
      maxResponsesPerSurvey,
      maxInterviewers,
      active: body.active ?? true
    });

    return ok(plan, 201);
  } catch (error: any) {
    if (error?.name === 'TransactionCanceledException' || error?.name === 'ConditionalCheckFailedException') {
      return fail(409, 'Codigo de plano ja cadastrado.');
    }

    return fail(400, 'Nao foi possivel criar a definicao do plano.');
  }
};

export const handler = withLoggedHandler('admin/plans/create-plan-definition', rawHandler);


