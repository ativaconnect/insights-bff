import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  CreateInterviewerRequestSchema,
  CreateSurveyRequestSchema,
  CreditPurchaseRequestInputSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  SetInterviewerStatusRequestSchema,
  SubmitSurveyResponseRequestSchema,
  SubmitSurveyResponsesBatchRequestSchema,
  UpdateInterviewerRequestSchema
} from './schemas';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    message: z.string()
  })
);

const GenericObject = registry.register('GenericObject', z.record(z.string(), z.unknown()));

const HealthResponse = registry.register(
  'HealthResponse',
  z.object({
    service: z.string(),
    status: z.enum(['UP', 'DEGRADED']),
    timestamp: z.string().datetime()
  })
);

const RegisterRequest = registry.register(
  'RegisterRequest',
  RegisterRequestSchema
);

const LoginRequest = registry.register(
  'LoginRequest',
  LoginRequestSchema
);

const AuthResponse = registry.register(
  'AuthResponse',
  z.object({
    token: z.string(),
    expiresInSeconds: z.number().int(),
    expiresAt: z.string().datetime(),
    session: z.object({
      role: z.string(),
      userName: z.string(),
      tenantName: z.string(),
      tenantId: z.string(),
      email: z.string(),
      adminAccessLevel: z.string().optional(),
      adminPermissions: z.array(z.string()).optional()
    })
  })
);

const CreditPurchaseRequestInput = registry.register(
  'CreditPurchaseRequestInput',
  CreditPurchaseRequestInputSchema
);

const CreditPurchaseRequest = registry.register('CreditPurchaseRequest', GenericObject);
const CreditPurchaseRequestsPage = registry.register(
  'CreditPurchaseRequestsPage',
  z.object({ items: z.array(CreditPurchaseRequest), nextCursor: z.string().optional() })
);

const InterviewerProfile = registry.register(
  'InterviewerProfile',
  z.object({
    id: z.string(),
    tenantId: z.string(),
    name: z.string(),
    login: z.string(),
    phone: z.string().optional(),
    email: z.string().optional(),
    status: z.enum(['active', 'inactive']),
    createdAt: z.string(),
    updatedAt: z.string()
  })
);

const CreateInterviewerRequest = registry.register(
  'CreateInterviewerRequest',
  CreateInterviewerRequestSchema
);

const UpdateInterviewerRequest = registry.register(
  'UpdateInterviewerRequest',
  UpdateInterviewerRequestSchema
);

const SetInterviewerStatusRequest = registry.register(
  'SetInterviewerStatusRequest',
  SetInterviewerStatusRequestSchema
);

const DeleteFlagResponse = registry.register('DeleteFlagResponse', z.object({ deleted: z.boolean() }));

const CustomerSurvey = registry.register('CustomerSurvey', GenericObject);
const CreateSurveyRequest = registry.register('CreateSurveyRequest', CreateSurveyRequestSchema);
const UpdateSurveyRequest = registry.register('UpdateSurveyRequest', z.record(z.string(), z.unknown()));
const SurveyResponseRecord = registry.register('SurveyResponseRecord', GenericObject);
const SubmitSurveyResponseRequest = registry.register(
  'SubmitSurveyResponseRequest',
  SubmitSurveyResponseRequestSchema
);
const SubmitSurveyResponsesBatchRequest = registry.register(
  'SubmitSurveyResponsesBatchRequest',
  SubmitSurveyResponsesBatchRequestSchema
);
const SubmitBatchResponse = registry.register('SubmitBatchResponse', z.object({ accepted: z.number().int(), responses: z.array(SurveyResponseRecord) }));
const CursorSurveyResponsesPage = registry.register('CursorSurveyResponsesPage', z.object({ items: z.array(SurveyResponseRecord), nextCursor: z.string().optional() }));

const UpdateMeRequest = registry.register('UpdateMeRequest', z.record(z.string(), z.unknown()));
const CustomerProfile = registry.register('CustomerProfile', GenericObject);

const ApproveRejectCreditRequest = registry.register('ApproveRejectCreditRequest', z.object({ note: z.string().optional() }));
const PaymentGatewayConfig = registry.register('PaymentGatewayConfig', GenericObject);
const UpsertPaymentConfigRequest = registry.register('UpsertPaymentConfigRequest', z.object({ provider: z.string() }).catchall(z.unknown()));
const PlanDefinition = registry.register('PlanDefinition', GenericObject);
const PlanAuditEntry = registry.register('PlanAuditEntry', GenericObject);
const CreatePlanRequest = registry.register('CreatePlanRequest', z.object({ code: z.string(), name: z.string(), tier: z.number(), pricePerForm: z.number(), minForms: z.number().int(), maxSurveys: z.number().int(), maxQuestionsPerSurvey: z.number().int(), maxResponsesPerSurvey: z.number().int(), maxInterviewers: z.number().int() }).catchall(z.unknown()));
const UpdatePlanRequest = registry.register('UpdatePlanRequest', z.object({ name: z.string(), tier: z.number(), pricePerForm: z.number(), minForms: z.number().int(), maxSurveys: z.number().int(), maxQuestionsPerSurvey: z.number().int(), maxResponsesPerSurvey: z.number().int(), maxInterviewers: z.number().int(), active: z.boolean() }).catchall(z.unknown()));

const OwnerAdminUser = registry.register('OwnerAdminUser', GenericObject);
const CreateAdminUserRequest = registry.register('CreateAdminUserRequest', z.object({ name: z.string(), email: z.string(), password: z.string().min(6), accessLevel: z.string() }).catchall(z.unknown()));
const UpdateAdminUserRequest = registry.register('UpdateAdminUserRequest', z.record(z.string(), z.unknown()));

const FinancialSupplier = registry.register('FinancialSupplier', GenericObject);
const CreateSupplierRequest = registry.register('CreateSupplierRequest', z.object({ name: z.string() }).catchall(z.unknown()));
const UpdateSupplierRequest = registry.register('UpdateSupplierRequest', z.record(z.string(), z.unknown()));
const FinancialExpense = registry.register('FinancialExpense', GenericObject);
const CreateExpenseRequest = registry.register('CreateExpenseRequest', z.object({ occurredOn: z.string(), description: z.string(), type: z.string(), category: z.string(), amount: z.number() }).catchall(z.unknown()));
const UpdateExpenseRequest = registry.register('UpdateExpenseRequest', z.record(z.string(), z.unknown()));
const FinancialForecastMonth = registry.register('FinancialForecastMonth', GenericObject);
const UpsertForecastRequest = registry.register('UpsertForecastRequest', z.object({ expectedRevenue: z.number(), expectedFixedCosts: z.number(), expectedVariableCosts: z.number() }).catchall(z.unknown()));
const FinancialRecurringTemplate = registry.register('FinancialRecurringTemplate', GenericObject);
const CreateRecurringTemplateRequest = registry.register('CreateRecurringTemplateRequest', z.object({ name: z.string(), category: z.string(), type: z.string(), recurringFrequency: z.string(), updateDay: z.number(), requiresValueUpdate: z.boolean(), startMonth: z.string() }).catchall(z.unknown()));
const UpdateRecurringTemplateRequest = registry.register('UpdateRecurringTemplateRequest', z.record(z.string(), z.unknown()));
const GenerateRecurringMonthRequest = registry.register('GenerateRecurringMonthRequest', z.object({ month: z.string() }));
const GenerateRecurringMonthResponse = registry.register('GenerateRecurringMonthResponse', GenericObject);
const GenerateInstallmentsRequest = registry.register('GenerateInstallmentsRequest', z.object({ description: z.string(), category: z.string(), type: z.string(), totalAmount: z.number(), installments: z.number().int().positive(), firstDueOn: z.string() }).catchall(z.unknown()));
const GenerateInstallmentsResponse = registry.register('GenerateInstallmentsResponse', GenericObject);

const FrontendSettings = registry.register('FrontendSettings', GenericObject);
const UpsertFrontendSettingsRequest = registry.register('UpsertFrontendSettingsRequest', z.record(z.string(), z.unknown()));

const AdminCustomerSummaryEnriched = registry.register('AdminCustomerSummaryEnriched', GenericObject);
const TenantSubscriptionSnapshot = registry.register('TenantSubscriptionSnapshot', GenericObject);
const PurchaseCustomerCreditsRequest = registry.register('PurchaseCustomerCreditsRequest', z.object({ planCode: z.string(), productCode: z.string().optional(), credits: z.number().int().positive().optional() }));

const BillingCreditSalesReport = registry.register('BillingCreditSalesReport', GenericObject);
const FinancialOverview = registry.register('FinancialOverview', GenericObject);

const WebhookResponse = registry.register(
  'WebhookResponse',
  z.object({ accepted: z.boolean(), updated: z.boolean(), reason: z.string().optional(), request: CreditPurchaseRequest.optional() })
);

const authSec = [{ BearerAuth: [], AppToken: [] }];
const appTokenSec = [{ AppToken: [] }];

const errResponses: Record<string, any> = {
  400: { description: 'Requisicao invalida', content: { 'application/json': { schema: ErrorResponse } } },
  401: { description: 'Nao autorizado', content: { 'application/json': { schema: ErrorResponse } } },
  403: { description: 'Sem permissao', content: { 'application/json': { schema: ErrorResponse } } },
  404: { description: 'Nao encontrado', content: { 'application/json': { schema: ErrorResponse } } },
  409: { description: 'Conflito', content: { 'application/json': { schema: ErrorResponse } } },
  422: { description: 'Nao processavel', content: { 'application/json': { schema: ErrorResponse } } }
};

const addPath = (path: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', cfg: { summary: string; operationId: string; tags: string[]; security?: Array<Record<string, string[]>>; parameters?: Array<Record<string, unknown>>; requestSchema?: z.ZodTypeAny; requestRequired?: boolean; responseSchema?: z.ZodTypeAny; responseCode?: number; responseArray?: boolean; includeErrors?: boolean; extraResponses?: Record<number, any>; }) => {
  const responses: Record<string, any> = {
    [String(cfg.responseCode ?? 200)]: {
      description: 'Sucesso',
      content: {
        'application/json': {
          schema: cfg.responseArray ? z.array(cfg.responseSchema ?? GenericObject) : (cfg.responseSchema ?? GenericObject)
        }
      }
    },
    ...(cfg.includeErrors === false ? {} : errResponses),
    ...(cfg.extraResponses ?? {})
  };

  registry.registerPath({
    method,
    path,
    summary: cfg.summary,
    operationId: cfg.operationId,
    tags: cfg.tags,
    ...(cfg.security ? { security: cfg.security } : {}),
    ...(cfg.parameters ? { request: { params: undefined, query: undefined } } : {}),
    request: {
      ...(cfg.parameters ? {
        params: z.object(
          Object.fromEntries(
            cfg.parameters
              .filter((p) => p['in'] === 'path')
              .map((p) => [String(p.name), z.string()])
          )
        ).partial(),
        query: z.object(
          Object.fromEntries(
            cfg.parameters
              .filter((p) => p['in'] === 'query')
              .map((p) => [String(p.name), z.union([z.string(), z.number(), z.boolean()]).optional()])
          )
        ).partial()
      } : {}),
      ...(cfg.requestSchema
        ? {
            body: {
              required: cfg.requestRequired ?? true,
              content: { 'application/json': { schema: cfg.requestSchema } }
            }
          }
        : {})
    },
    responses: responses as any
  });
};

addPath('/docs', 'get', { summary: 'Swagger UI', operationId: 'getSwaggerUi', tags: ['Docs'], security: [], includeErrors: false, responseCode: 200, responseSchema: z.string() });
addPath('/docs/openapi.json', 'get', { summary: 'OpenAPI JSON', operationId: 'getOpenApiJson', tags: ['Docs'], security: [], includeErrors: false, responseSchema: GenericObject });
addPath('/health', 'get', { summary: 'Health check', operationId: 'getHealth', tags: ['Health'], security: [], includeErrors: false, responseSchema: HealthResponse, extraResponses: { 503: { description: 'Servico degradado', content: { 'application/json': { schema: HealthResponse } } } } });

addPath('/auth/register', 'post', { summary: 'Registrar conta', operationId: 'register', tags: ['Auth'], security: appTokenSec, requestSchema: RegisterRequest, responseCode: 201, responseSchema: AuthResponse });
addPath('/auth/login', 'post', { summary: 'Login', operationId: 'login', tags: ['Auth'], security: appTokenSec, requestSchema: LoginRequest, responseSchema: AuthResponse, extraResponses: { 429: { description: 'Muitas tentativas', content: { 'application/json': { schema: ErrorResponse } } } } });

addPath('/me', 'get', { summary: 'Obter perfil autenticado', operationId: 'getMe', tags: ['Me'], security: authSec, responseSchema: CustomerProfile });
addPath('/me', 'put', { summary: 'Atualizar perfil autenticado', operationId: 'updateMe', tags: ['Me'], security: authSec, requestSchema: UpdateMeRequest, responseSchema: CustomerProfile });
addPath('/me/credits/purchase', 'post', { summary: 'Comprar creditos diretamente', operationId: 'purchaseMyCredits', tags: ['Me'], security: authSec, requestSchema: CreditPurchaseRequestInput, responseCode: 201, responseSchema: CreditPurchaseRequest });
addPath('/me/credits/requests', 'post', { summary: 'Solicitar compra de creditos', operationId: 'requestMyCreditsPurchase', tags: ['Me'], security: authSec, requestSchema: CreditPurchaseRequestInput, responseCode: 201, responseSchema: CreditPurchaseRequest });
addPath('/me/credits/requests', 'get', { summary: 'Listar solicitacoes de compra de creditos', operationId: 'listMyCreditsPurchaseRequests', tags: ['Me'], security: authSec, parameters: [{ name: 'productCode', in: 'query' }], responseSchema: CreditPurchaseRequest, responseArray: true });

addPath('/interviewers', 'get', { summary: 'Listar entrevistadores', operationId: 'listInterviewers', tags: ['Interviewers'], security: authSec, responseSchema: InterviewerProfile, responseArray: true });
addPath('/interviewers', 'post', { summary: 'Criar entrevistador', operationId: 'createInterviewer', tags: ['Interviewers'], security: authSec, requestSchema: CreateInterviewerRequest, responseCode: 201, responseSchema: InterviewerProfile });
addPath('/interviewers/{interviewerId}', 'put', { summary: 'Atualizar entrevistador', operationId: 'updateInterviewer', tags: ['Interviewers'], security: authSec, parameters: [{ name: 'interviewerId', in: 'path' }], requestSchema: UpdateInterviewerRequest, responseSchema: InterviewerProfile });
addPath('/interviewers/{interviewerId}', 'delete', { summary: 'Remover entrevistador', operationId: 'deleteInterviewer', tags: ['Interviewers'], security: authSec, parameters: [{ name: 'interviewerId', in: 'path' }], responseSchema: DeleteFlagResponse });
addPath('/interviewers/{interviewerId}/status', 'put', { summary: 'Atualizar status do entrevistador', operationId: 'setInterviewerStatus', tags: ['Interviewers'], security: authSec, parameters: [{ name: 'interviewerId', in: 'path' }], requestSchema: SetInterviewerStatusRequest, responseSchema: InterviewerProfile });

addPath('/surveys', 'get', { summary: 'Listar pesquisas', operationId: 'listSurveys', tags: ['Surveys'], security: authSec, responseSchema: CustomerSurvey, responseArray: true });
addPath('/surveys', 'post', { summary: 'Criar pesquisa', operationId: 'createSurvey', tags: ['Surveys'], security: authSec, requestSchema: CreateSurveyRequest, responseCode: 201, responseSchema: CustomerSurvey });
addPath('/surveys/{surveyId}', 'get', { summary: 'Obter pesquisa', operationId: 'getSurvey', tags: ['Surveys'], security: authSec, parameters: [{ name: 'surveyId', in: 'path' }], responseSchema: CustomerSurvey });
addPath('/surveys/{surveyId}', 'put', { summary: 'Atualizar pesquisa', operationId: 'updateSurvey', tags: ['Surveys'], security: authSec, parameters: [{ name: 'surveyId', in: 'path' }], requestSchema: UpdateSurveyRequest, responseSchema: CustomerSurvey });
addPath('/surveys/{surveyId}/responses', 'get', { summary: 'Listar respostas da pesquisa', operationId: 'listSurveyResponses', tags: ['Surveys'], security: authSec, parameters: [{ name: 'surveyId', in: 'path' }], responseSchema: SurveyResponseRecord, responseArray: true });
addPath('/surveys/{surveyId}/responses', 'post', { summary: 'Enviar resposta da pesquisa', operationId: 'submitSurveyResponse', tags: ['Surveys'], security: authSec, parameters: [{ name: 'surveyId', in: 'path' }], requestSchema: SubmitSurveyResponseRequest, responseCode: 201, responseSchema: SurveyResponseRecord });
addPath('/surveys/{surveyId}/responses/page', 'get', { summary: 'Listar respostas paginadas', operationId: 'listSurveyResponsesPage', tags: ['Surveys'], security: authSec, parameters: [{ name: 'surveyId', in: 'path' }, { name: 'limit', in: 'query' }, { name: 'cursor', in: 'query' }], responseSchema: CursorSurveyResponsesPage });
addPath('/surveys/{surveyId}/responses/summary', 'get', { summary: 'Resumo de respostas', operationId: 'getSurveyResponsesSummary', tags: ['Surveys'], security: authSec, parameters: [{ name: 'surveyId', in: 'path' }], responseSchema: GenericObject });
addPath('/surveys/{surveyId}/heatmap', 'get', { summary: 'Heatmap de respostas', operationId: 'getSurveyHeatmap', tags: ['Surveys'], security: authSec, parameters: [{ name: 'surveyId', in: 'path' }], responseSchema: GenericObject, responseArray: true });
addPath('/surveys/{surveyId}/responses/batch', 'post', { summary: 'Enviar lote de respostas', operationId: 'submitSurveyResponsesBatch', tags: ['Surveys'], security: authSec, parameters: [{ name: 'surveyId', in: 'path' }], requestSchema: SubmitSurveyResponsesBatchRequest, responseCode: 201, responseSchema: SubmitBatchResponse });

addPath('/interviewer/surveys', 'get', { summary: 'Listar pesquisas disponiveis para entrevistador', operationId: 'listAvailableInterviewerSurveys', tags: ['Interviewer'], security: authSec, responseSchema: CustomerSurvey, responseArray: true });

addPath('/admin/customers', 'get', { summary: 'Listar clientes', operationId: 'listAdminCustomers', tags: ['Admin Customers'], security: authSec, parameters: [{ name: 'productCode', in: 'query' }], responseSchema: AdminCustomerSummaryEnriched, responseArray: true });
addPath('/admin/customers/{tenantId}/credits/purchase', 'post', { summary: 'Comprar creditos para cliente', operationId: 'purchaseCustomerCredits', tags: ['Admin Customers'], security: authSec, parameters: [{ name: 'tenantId', in: 'path' }], requestSchema: PurchaseCustomerCreditsRequest, responseSchema: TenantSubscriptionSnapshot });
addPath('/admin/credits/requests', 'get', { summary: 'Listar solicitacoes de credito', operationId: 'listAdminCreditRequests', tags: ['Admin Credits'], security: authSec, parameters: [{ name: 'status', in: 'query' }, { name: 'productCode', in: 'query' }], responseSchema: CreditPurchaseRequest, responseArray: true });
addPath('/admin/credits/requests/page', 'get', { summary: 'Listar solicitacoes de credito (paginado)', operationId: 'listAdminCreditRequestsPage', tags: ['Admin Credits'], security: authSec, parameters: [{ name: 'status', in: 'query' }, { name: 'productCode', in: 'query' }, { name: 'limit', in: 'query' }, { name: 'cursor', in: 'query' }], responseSchema: CreditPurchaseRequestsPage });
addPath('/admin/credits/requests/{requestId}/approve', 'post', { summary: 'Aprovar solicitacao de credito', operationId: 'approveAdminCreditRequest', tags: ['Admin Credits'], security: authSec, parameters: [{ name: 'requestId', in: 'path' }], requestSchema: ApproveRejectCreditRequest, requestRequired: false, responseSchema: CreditPurchaseRequest });
addPath('/admin/credits/requests/{requestId}/reject', 'post', { summary: 'Rejeitar solicitacao de credito', operationId: 'rejectAdminCreditRequest', tags: ['Admin Credits'], security: authSec, parameters: [{ name: 'requestId', in: 'path' }], requestSchema: ApproveRejectCreditRequest, requestRequired: false, responseSchema: CreditPurchaseRequest });

addPath('/admin/payments/config', 'get', { summary: 'Obter configuracao de gateway', operationId: 'getAdminPaymentConfig', tags: ['Admin Payments'], security: authSec, parameters: [{ name: 'productCode', in: 'query' }], responseSchema: PaymentGatewayConfig });
addPath('/admin/payments/config', 'put', { summary: 'Salvar configuracao de gateway', operationId: 'upsertAdminPaymentConfig', tags: ['Admin Payments'], security: authSec, requestSchema: UpsertPaymentConfigRequest, responseSchema: PaymentGatewayConfig });
addPath('/admin/billing/credit-sales', 'get', { summary: 'Relatorio de vendas de credito', operationId: 'getAdminBillingCreditSales', tags: ['Admin Billing'], security: authSec, parameters: [{ name: 'tenantId', in: 'query' }, { name: 'productCode', in: 'query' }, { name: 'status', in: 'query' }, { name: 'dateFrom', in: 'query' }, { name: 'dateTo', in: 'query' }], responseSchema: BillingCreditSalesReport });

addPath('/admin/plans', 'get', { summary: 'Listar planos', operationId: 'listPlanDefinitions', tags: ['Admin Plans'], security: authSec, parameters: [{ name: 'productCode', in: 'query' }], responseSchema: PlanDefinition, responseArray: true });
addPath('/admin/plans', 'post', { summary: 'Criar plano', operationId: 'createPlanDefinition', tags: ['Admin Plans'], security: authSec, requestSchema: CreatePlanRequest, responseCode: 201, responseSchema: PlanDefinition });
addPath('/admin/plans/{planId}', 'put', { summary: 'Atualizar plano', operationId: 'updatePlanDefinition', tags: ['Admin Plans'], security: authSec, parameters: [{ name: 'planId', in: 'path' }], requestSchema: UpdatePlanRequest, responseSchema: PlanDefinition });
addPath('/admin/plans/{planId}', 'delete', { summary: 'Excluir plano (logico)', operationId: 'deletePlanDefinition', tags: ['Admin Plans'], security: authSec, parameters: [{ name: 'planId', in: 'path' }], responseSchema: PlanDefinition });
addPath('/admin/plans/{planId}/audits', 'get', { summary: 'Listar auditoria de plano', operationId: 'listPlanAudits', tags: ['Admin Plans'], security: authSec, parameters: [{ name: 'planId', in: 'path' }], responseSchema: PlanAuditEntry, responseArray: true });

addPath('/admin/users', 'get', { summary: 'Listar usuarios admin', operationId: 'listAdminUsers', tags: ['Admin Users'], security: authSec, responseSchema: OwnerAdminUser, responseArray: true });
addPath('/admin/users', 'post', { summary: 'Criar usuario admin', operationId: 'createAdminUser', tags: ['Admin Users'], security: authSec, requestSchema: CreateAdminUserRequest, responseCode: 201, responseSchema: OwnerAdminUser });
addPath('/admin/users/{userId}', 'put', { summary: 'Atualizar usuario admin', operationId: 'updateAdminUser', tags: ['Admin Users'], security: authSec, parameters: [{ name: 'userId', in: 'path' }], requestSchema: UpdateAdminUserRequest, responseSchema: OwnerAdminUser });

addPath('/admin/finance/suppliers', 'get', { summary: 'Listar fornecedores', operationId: 'listFinanceSuppliers', tags: ['Admin Finance'], security: authSec, responseSchema: FinancialSupplier, responseArray: true });
addPath('/admin/finance/suppliers', 'post', { summary: 'Criar fornecedor', operationId: 'createFinanceSupplier', tags: ['Admin Finance'], security: authSec, requestSchema: CreateSupplierRequest, responseCode: 201, responseSchema: FinancialSupplier });
addPath('/admin/finance/suppliers/{supplierId}', 'put', { summary: 'Atualizar fornecedor', operationId: 'updateFinanceSupplier', tags: ['Admin Finance'], security: authSec, parameters: [{ name: 'supplierId', in: 'path' }], requestSchema: UpdateSupplierRequest, responseSchema: FinancialSupplier });

addPath('/admin/finance/expenses', 'get', { summary: 'Listar despesas', operationId: 'listFinanceExpenses', tags: ['Admin Finance'], security: authSec, parameters: [{ name: 'status', in: 'query' }, { name: 'type', in: 'query' }, { name: 'dateFrom', in: 'query' }, { name: 'dateTo', in: 'query' }, { name: 'supplierId', in: 'query' }, { name: 'month', in: 'query' }, { name: 'isForecast', in: 'query' }], responseSchema: FinancialExpense, responseArray: true });
addPath('/admin/finance/expenses', 'post', { summary: 'Criar despesa', operationId: 'createFinanceExpense', tags: ['Admin Finance'], security: authSec, requestSchema: CreateExpenseRequest, responseCode: 201, responseSchema: FinancialExpense });
addPath('/admin/finance/expenses/{expenseId}', 'put', { summary: 'Atualizar despesa', operationId: 'updateFinanceExpense', tags: ['Admin Finance'], security: authSec, parameters: [{ name: 'expenseId', in: 'path' }], requestSchema: UpdateExpenseRequest, responseSchema: FinancialExpense });
addPath('/admin/finance/forecast/{month}', 'get', { summary: 'Obter forecast', operationId: 'getFinanceForecast', tags: ['Admin Finance'], security: authSec, parameters: [{ name: 'month', in: 'path' }], responseSchema: FinancialForecastMonth });
addPath('/admin/finance/forecast/{month}', 'put', { summary: 'Salvar forecast', operationId: 'upsertFinanceForecast', tags: ['Admin Finance'], security: authSec, parameters: [{ name: 'month', in: 'path' }], requestSchema: UpsertForecastRequest, responseSchema: FinancialForecastMonth });
addPath('/admin/finance/overview', 'get', { summary: 'Resumo financeiro', operationId: 'getFinanceOverview', tags: ['Admin Finance'], security: authSec, parameters: [{ name: 'dateFrom', in: 'query' }, { name: 'dateTo', in: 'query' }, { name: 'month', in: 'query' }], responseSchema: FinancialOverview });
addPath('/admin/finance/recurring/templates', 'get', { summary: 'Listar templates recorrentes', operationId: 'listFinanceRecurringTemplates', tags: ['Admin Finance'], security: authSec, responseSchema: FinancialRecurringTemplate, responseArray: true });
addPath('/admin/finance/recurring/templates', 'post', { summary: 'Criar template recorrente', operationId: 'createFinanceRecurringTemplate', tags: ['Admin Finance'], security: authSec, requestSchema: CreateRecurringTemplateRequest, responseCode: 201, responseSchema: FinancialRecurringTemplate });
addPath('/admin/finance/recurring/templates/{templateId}', 'put', { summary: 'Atualizar template recorrente', operationId: 'updateFinanceRecurringTemplate', tags: ['Admin Finance'], security: authSec, parameters: [{ name: 'templateId', in: 'path' }], requestSchema: UpdateRecurringTemplateRequest, responseSchema: FinancialRecurringTemplate });
addPath('/admin/finance/recurring/generate', 'post', { summary: 'Gerar despesas recorrentes do mes', operationId: 'generateFinanceRecurringMonth', tags: ['Admin Finance'], security: authSec, requestSchema: GenerateRecurringMonthRequest, responseSchema: GenerateRecurringMonthResponse });
addPath('/admin/finance/recurring/pending-updates', 'get', { summary: 'Listar pendencias de valor', operationId: 'listFinancePendingUpdates', tags: ['Admin Finance'], security: authSec, parameters: [{ name: 'month', in: 'query' }], responseSchema: FinancialExpense, responseArray: true });
addPath('/admin/finance/installments/generate', 'post', { summary: 'Gerar parcelamento', operationId: 'generateFinanceInstallments', tags: ['Admin Finance'], security: authSec, requestSchema: GenerateInstallmentsRequest, responseCode: 201, responseSchema: GenerateInstallmentsResponse });

addPath('/admin/frontend/settings', 'get', { summary: 'Obter configuracoes do frontend', operationId: 'getAdminFrontendSettings', tags: ['Admin Frontend'], security: authSec, parameters: [{ name: 'productCode', in: 'query' }], responseSchema: FrontendSettings });
addPath('/admin/frontend/settings', 'put', { summary: 'Salvar configuracoes do frontend', operationId: 'upsertAdminFrontendSettings', tags: ['Admin Frontend'], security: authSec, requestSchema: UpsertFrontendSettingsRequest, responseSchema: FrontendSettings });

addPath('/plans/catalog', 'get', { summary: 'Catalogo publico de planos', operationId: 'listPublicPlanCatalog', tags: ['Public'], security: appTokenSec, parameters: [{ name: 'productCode', in: 'query' }], responseSchema: PlanDefinition, responseArray: true });
addPath('/frontend/settings', 'get', { summary: 'Configuracoes publicas de frontend', operationId: 'getPublicFrontendSettings', tags: ['Public'], security: [], parameters: [{ name: 'productCode', in: 'query' }], responseSchema: FrontendSettings });

addPath('/integrations/brasilapi/cep/{cep}', 'get', { summary: 'Consultar CEP', operationId: 'getCep', tags: ['Integrations'], security: appTokenSec, parameters: [{ name: 'cep', in: 'path' }], responseSchema: GenericObject });
addPath('/integrations/brasilapi/cnpj/{cnpj}', 'get', { summary: 'Consultar CNPJ', operationId: 'getCnpj', tags: ['Integrations'], security: appTokenSec, parameters: [{ name: 'cnpj', in: 'path' }], responseSchema: GenericObject });
addPath('/integrations/brasilapi/cpf/{cpf}', 'get', { summary: 'Validar CPF', operationId: 'validateCpf', tags: ['Integrations'], security: appTokenSec, parameters: [{ name: 'cpf', in: 'path' }], responseSchema: GenericObject });

addPath('/webhooks/payments/{provider}', 'post', {
  summary: 'Receber webhook de pagamento',
  operationId: 'receivePaymentWebhook',
  tags: ['Webhooks'],
  security: [],
  parameters: [{ name: 'provider', in: 'path' }, { name: 'productCode', in: 'query' }],
  requestSchema: GenericObject,
  responseSchema: WebhookResponse,
  extraResponses: {
    202: {
      description: 'Aceito',
      content: { 'application/json': { schema: WebhookResponse } }
    }
  }
});

export const buildOpenApiSpec = (serverUrl: string): Record<string, unknown> => {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const document = generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Insights BFF API',
      version: '1.0.0',
      description: 'Documentacao OpenAPI da API Insights BFF (Serverless).'
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'Auth' },
      { name: 'Health' },
      { name: 'Me' },
      { name: 'Interviewers' },
      { name: 'Surveys' },
      { name: 'Interviewer' },
      { name: 'Admin Customers' },
      { name: 'Admin Credits' },
      { name: 'Admin Payments' },
      { name: 'Admin Billing' },
      { name: 'Admin Plans' },
      { name: 'Admin Users' },
      { name: 'Admin Finance' },
      { name: 'Admin Frontend' },
      { name: 'Public' },
      { name: 'Integrations' },
      { name: 'Webhooks' },
      { name: 'Docs' }
    ],
    security: [{ BearerAuth: [], AppToken: [] }]
  } as any);

  const withSecuritySchemes = document as any;
  withSecuritySchemes.components = withSecuritySchemes.components ?? {};
  withSecuritySchemes.components.securitySchemes = {
    BearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT'
    },
    AppToken: {
      type: 'apiKey',
      in: 'header',
      name: 'X-App-Token'
    }
  };

  return withSecuritySchemes as Record<string, unknown>;
};
