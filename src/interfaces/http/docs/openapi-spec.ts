type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface OperationConfig {
  summary: string;
  tags: string[];
  operationId: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses?: Record<string, unknown>;
}

const schemaRef = (name: string): Record<string, string> => ({ $ref: `#/components/schemas/${name}` });
const requestJson = (name: string, required = true): Record<string, unknown> => ({
  required,
  content: { 'application/json': { schema: schemaRef(name) } }
});
const responseJson = (name: string, description = 'Sucesso'): Record<string, unknown> => ({
  description,
  content: { 'application/json': { schema: schemaRef(name) } }
});
const responseArray = (name: string, description = 'Sucesso'): Record<string, unknown> => ({
  description,
  content: { 'application/json': { schema: { type: 'array', items: schemaRef(name) } } }
});
const pathParam = (name: string, description: string): Record<string, unknown> => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' }
});
const queryParam = (name: string, description: string, schema: Record<string, unknown> = { type: 'string' }): Record<string, unknown> => ({
  name,
  in: 'query',
  required: false,
  description,
  schema
});
const errRef = (name: string): Record<string, string> => ({ $ref: `#/components/responses/${name}` });
const errs = {
  '400': errRef('BadRequest'),
  '401': errRef('Unauthorized'),
  '403': errRef('Forbidden'),
  '404': errRef('NotFound'),
  '409': errRef('Conflict'),
  '422': errRef('UnprocessableEntity')
};

const op = (c: OperationConfig): Record<string, unknown> => ({
  summary: c.summary,
  operationId: c.operationId,
  tags: c.tags,
  ...(c.security ? { security: c.security } : {}),
  ...(c.parameters ? { parameters: c.parameters } : {}),
  ...(c.requestBody ? { requestBody: c.requestBody } : {}),
  responses: c.responses ?? { '200': responseJson('GenericObject'), ...errs }
});
const method = (name: HttpMethod, c: OperationConfig): Record<string, unknown> => ({ [name]: op(c) });

export const buildOpenApiSpec = (serverUrl: string): Record<string, unknown> => ({
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
  security: [{ BearerAuth: [], AppToken: [] }],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      AppToken: { type: 'apiKey', in: 'header', name: 'X-App-Token' }
    },
    responses: {
      BadRequest: { description: 'Requisicao invalida.', content: { 'application/json': { schema: schemaRef('ErrorResponse') } } },
      Unauthorized: { description: 'Nao autorizado.', content: { 'application/json': { schema: schemaRef('ErrorResponse') } } },
      Forbidden: { description: 'Sem permissao.', content: { 'application/json': { schema: schemaRef('ErrorResponse') } } },
      NotFound: { description: 'Nao encontrado.', content: { 'application/json': { schema: schemaRef('ErrorResponse') } } },
      Conflict: { description: 'Conflito.', content: { 'application/json': { schema: schemaRef('ErrorResponse') } } },
      UnprocessableEntity: { description: 'Nao processavel.', content: { 'application/json': { schema: schemaRef('ErrorResponse') } } }
    },
    schemas: {
      GenericObject: { type: 'object', additionalProperties: true },
      ErrorResponse: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string' } }
      },
      HealthResponse: {
        type: 'object',
        required: ['service', 'status', 'timestamp'],
        properties: {
          service: { type: 'string' },
          status: { type: 'string', enum: ['UP', 'DEGRADED'] },
          timestamp: { type: 'string', format: 'date-time' }
        }
      },
      RegisterRequest: {
        type: 'object',
        required: ['personType', 'document', 'legalName', 'email', 'phone', 'password', 'address'],
        properties: {
          personType: { type: 'string', enum: ['PF', 'PJ'] },
          document: { type: 'string' },
          legalName: { type: 'string' },
          tradeName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          password: { type: 'string', minLength: 6 },
          captchaToken: { type: 'string' },
          address: { type: 'object', required: ['cep', 'state', 'city', 'neighborhood', 'street', 'number'], properties: {
            cep: { type: 'string' }, state: { type: 'string' }, city: { type: 'string' }, neighborhood: { type: 'string' }, street: { type: 'string' }, number: { type: 'string' }, complement: { type: 'string' }
          } }
        }
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string' }, password: { type: 'string' }, captchaToken: { type: 'string' } }
      },
      AuthResponse: {
        type: 'object',
        required: ['token', 'expiresInSeconds', 'expiresAt', 'session'],
        properties: {
          token: { type: 'string' },
          expiresInSeconds: { type: 'integer' },
          expiresAt: { type: 'string', format: 'date-time' },
          session: { type: 'object', required: ['role', 'userName', 'tenantName', 'tenantId', 'email'], properties: {
            role: { type: 'string' }, userName: { type: 'string' }, tenantName: { type: 'string' }, tenantId: { type: 'string' }, email: { type: 'string' }, adminAccessLevel: { type: 'string' }, adminPermissions: { type: 'array', items: { type: 'string' } }
          } }
        }
      },
      CustomerProfile: { type: 'object', additionalProperties: true },
      CreditPurchaseRequestInput: {
        type: 'object',
        required: ['planCode', 'credits'],
        properties: {
          productCode: { type: 'string' },
          planCode: { type: 'string' },
          credits: { type: 'integer', minimum: 1 },
          paymentMethod: { type: 'string', enum: ['PIX', 'CREDIT_CARD'] },
          note: { type: 'string' }
        }
      },
      CreditPurchaseRequest: { type: 'object', additionalProperties: true },
      CreditPurchaseRequestsPage: {
        type: 'object',
        required: ['items'],
        properties: { items: { type: 'array', items: schemaRef('CreditPurchaseRequest') }, nextCursor: { type: 'string' } }
      },
      InterviewerProfile: {
        type: 'object',
        required: ['id', 'tenantId', 'name', 'login', 'status', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string' }, tenantId: { type: 'string' }, name: { type: 'string' }, login: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive'] }, createdAt: { type: 'string' }, updatedAt: { type: 'string' }
        }
      },
      CreateInterviewerRequest: { type: 'object', required: ['name', 'login', 'password'], properties: { name: { type: 'string' }, login: { type: 'string' }, password: { type: 'string', minLength: 6 }, phone: { type: 'string' }, email: { type: 'string' } } },
      UpdateInterviewerRequest: { type: 'object', properties: { name: { type: 'string' }, login: { type: 'string' }, password: { type: 'string', minLength: 6 }, phone: { type: 'string' }, email: { type: 'string' } } },
      SetInterviewerStatusRequest: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'inactive'] } } },
      DeleteFlagResponse: { type: 'object', required: ['deleted'], properties: { deleted: { type: 'boolean' } } },
      CustomerSurvey: { type: 'object', additionalProperties: true },
      CreateSurveyRequest: { type: 'object', required: ['name'], additionalProperties: true, properties: { name: { type: 'string' } } },
      UpdateSurveyRequest: { type: 'object', additionalProperties: true },
      SurveyResponseRecord: { type: 'object', additionalProperties: true },
      SubmitSurveyResponseRequest: { type: 'object', required: ['answers'], properties: { answers: { type: 'object', additionalProperties: true }, metadata: { type: 'object', additionalProperties: true }, clientResponseId: { type: 'string' }, submittedAt: { type: 'string', format: 'date-time' }, interviewerId: { type: 'string' }, deviceId: { type: 'string' }, location: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, accuracyMeters: { type: 'number' } } } } },
      SubmitSurveyResponsesBatchRequest: { type: 'object', required: ['responses'], properties: { responses: { type: 'array', items: schemaRef('SubmitSurveyResponseRequest') } } },
      SubmitBatchResponse: { type: 'object', required: ['accepted', 'responses'], properties: { accepted: { type: 'integer' }, responses: { type: 'array', items: schemaRef('SurveyResponseRecord') } } },
      CursorSurveyResponsesPage: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: schemaRef('SurveyResponseRecord') }, nextCursor: { type: 'string' } } },
      SurveyResponsesSummary: { type: 'object', additionalProperties: true },
      HeatmapPoint: { type: 'object', required: ['lat', 'lng', 'count'], properties: { lat: { type: 'number' }, lng: { type: 'number' }, count: { type: 'integer' } } },
      PlanDefinition: { type: 'object', additionalProperties: true },
      PlanAuditEntry: { type: 'object', additionalProperties: true },
      CreatePlanRequest: { type: 'object', required: ['code', 'name', 'tier', 'pricePerForm', 'minForms', 'maxSurveys', 'maxQuestionsPerSurvey', 'maxResponsesPerSurvey', 'maxInterviewers'], additionalProperties: true },
      UpdatePlanRequest: { type: 'object', required: ['name', 'tier', 'pricePerForm', 'minForms', 'maxSurveys', 'maxQuestionsPerSurvey', 'maxResponsesPerSurvey', 'maxInterviewers', 'active'], additionalProperties: true },
      OwnerAdminUser: { type: 'object', additionalProperties: true },
      CreateAdminUserRequest: { type: 'object', required: ['name', 'email', 'password', 'accessLevel'], additionalProperties: true },
      UpdateAdminUserRequest: { type: 'object', additionalProperties: true },
      PaymentGatewayConfig: { type: 'object', additionalProperties: true },
      UpsertPaymentConfigRequest: { type: 'object', required: ['provider'], additionalProperties: true },
      AdminCustomerSummaryEnriched: { type: 'object', additionalProperties: true },
      TenantSubscriptionSnapshot: { type: 'object', additionalProperties: true },
      PurchaseCustomerCreditsRequest: { type: 'object', required: ['planCode'], properties: { productCode: { type: 'string' }, planCode: { type: 'string' }, credits: { type: 'integer', minimum: 1 } } },
      FinancialSupplier: { type: 'object', additionalProperties: true },
      CreateSupplierRequest: { type: 'object', required: ['name'], additionalProperties: true },
      UpdateSupplierRequest: { type: 'object', additionalProperties: true },
      FinancialExpense: { type: 'object', additionalProperties: true },
      CreateExpenseRequest: { type: 'object', required: ['occurredOn', 'description', 'type', 'category', 'amount'], additionalProperties: true },
      UpdateExpenseRequest: { type: 'object', additionalProperties: true },
      FinancialForecastMonth: { type: 'object', additionalProperties: true },
      UpsertForecastRequest: { type: 'object', required: ['expectedRevenue', 'expectedFixedCosts', 'expectedVariableCosts'], additionalProperties: true },
      FinancialRecurringTemplate: { type: 'object', additionalProperties: true },
      CreateRecurringTemplateRequest: { type: 'object', required: ['name', 'category', 'type', 'recurringFrequency', 'updateDay', 'requiresValueUpdate', 'startMonth'], additionalProperties: true },
      UpdateRecurringTemplateRequest: { type: 'object', additionalProperties: true },
      GenerateRecurringMonthRequest: { type: 'object', required: ['month'], properties: { month: { type: 'string', example: '2026-02' } } },
      GenerateRecurringMonthResponse: { type: 'object', additionalProperties: true },
      GenerateInstallmentsRequest: { type: 'object', required: ['description', 'category', 'type', 'totalAmount', 'installments', 'firstDueOn'], additionalProperties: true },
      GenerateInstallmentsResponse: { type: 'object', additionalProperties: true },
      FinancialOverview: { type: 'object', additionalProperties: true },
      BillingCreditSalesReport: { type: 'object', additionalProperties: true },
      FrontendSettings: { type: 'object', additionalProperties: true },
      UpsertFrontendSettingsRequest: { type: 'object', additionalProperties: true },
      ApproveRejectCreditRequest: { type: 'object', properties: { note: { type: 'string' } } },
      WebhookResponse: { type: 'object', required: ['accepted', 'updated'], properties: { accepted: { type: 'boolean' }, updated: { type: 'boolean' }, reason: { type: 'string' }, request: schemaRef('CreditPurchaseRequest') } },
      UpdateMeRequest: { type: 'object', additionalProperties: true }
    }
  },
  paths: {
    '/docs': method('get', { summary: 'Swagger UI', tags: ['Docs'], operationId: 'getSwaggerUi', security: [], responses: { '200': { description: 'HTML do Swagger UI', content: { 'text/html': { schema: { type: 'string' } } } } } }),
    '/docs/openapi.json': method('get', { summary: 'OpenAPI JSON', tags: ['Docs'], operationId: 'getOpenApiJson', security: [], responses: { '200': responseJson('GenericObject') } }),
    '/health': method('get', { summary: 'Health check', tags: ['Health'], operationId: 'getHealth', security: [], responses: { '200': responseJson('HealthResponse'), '503': responseJson('HealthResponse') } }),
    '/auth/register': method('post', { summary: 'Registrar conta', tags: ['Auth'], operationId: 'register', security: [{ AppToken: [] }], requestBody: requestJson('RegisterRequest'), responses: { '201': responseJson('AuthResponse'), ...errs } }),
    '/auth/login': method('post', { summary: 'Login', tags: ['Auth'], operationId: 'login', security: [{ AppToken: [] }], requestBody: requestJson('LoginRequest'), responses: { '200': responseJson('AuthResponse'), ...errs, '429': errRef('BadRequest') } }),
    '/me': {
      ...method('get', { summary: 'Obter perfil autenticado', tags: ['Me'], operationId: 'getMe', responses: { '200': responseJson('CustomerProfile'), ...errs } }),
      ...method('put', { summary: 'Atualizar perfil autenticado', tags: ['Me'], operationId: 'updateMe', requestBody: requestJson('UpdateMeRequest'), responses: { '200': responseJson('CustomerProfile'), ...errs } })
    },
    '/me/credits/purchase': method('post', { summary: 'Comprar creditos diretamente', tags: ['Me'], operationId: 'purchaseMyCredits', requestBody: requestJson('CreditPurchaseRequestInput'), responses: { '201': responseJson('CreditPurchaseRequest'), ...errs } }),
    '/me/credits/requests': {
      ...method('post', { summary: 'Solicitar compra de creditos', tags: ['Me'], operationId: 'requestMyCreditsPurchase', requestBody: requestJson('CreditPurchaseRequestInput'), responses: { '201': responseJson('CreditPurchaseRequest'), ...errs } }),
      ...method('get', { summary: 'Listar solicitacoes de compra de creditos', tags: ['Me'], operationId: 'listMyCreditsPurchaseRequests', parameters: [queryParam('productCode', 'Codigo do produto')], responses: { '200': responseArray('CreditPurchaseRequest'), ...errs } })
    },
    '/interviewers': {
      ...method('get', { summary: 'Listar entrevistadores', tags: ['Interviewers'], operationId: 'listInterviewers', responses: { '200': responseArray('InterviewerProfile'), ...errs } }),
      ...method('post', { summary: 'Criar entrevistador', tags: ['Interviewers'], operationId: 'createInterviewer', requestBody: requestJson('CreateInterviewerRequest'), responses: { '201': responseJson('InterviewerProfile'), ...errs } })
    },
    '/interviewers/{interviewerId}': {
      ...method('put', { summary: 'Atualizar entrevistador', tags: ['Interviewers'], operationId: 'updateInterviewer', parameters: [pathParam('interviewerId', 'ID do entrevistador')], requestBody: requestJson('UpdateInterviewerRequest'), responses: { '200': responseJson('InterviewerProfile'), ...errs } }),
      ...method('delete', { summary: 'Remover entrevistador', tags: ['Interviewers'], operationId: 'deleteInterviewer', parameters: [pathParam('interviewerId', 'ID do entrevistador')], responses: { '200': responseJson('DeleteFlagResponse'), ...errs } })
    },
    '/interviewers/{interviewerId}/status': method('put', { summary: 'Atualizar status do entrevistador', tags: ['Interviewers'], operationId: 'setInterviewerStatus', parameters: [pathParam('interviewerId', 'ID do entrevistador')], requestBody: requestJson('SetInterviewerStatusRequest'), responses: { '200': responseJson('InterviewerProfile'), ...errs } }),
    '/surveys': {
      ...method('get', { summary: 'Listar pesquisas', tags: ['Surveys'], operationId: 'listSurveys', responses: { '200': responseArray('CustomerSurvey'), ...errs } }),
      ...method('post', { summary: 'Criar pesquisa', tags: ['Surveys'], operationId: 'createSurvey', requestBody: requestJson('CreateSurveyRequest'), responses: { '201': responseJson('CustomerSurvey'), ...errs } })
    },
    '/surveys/{surveyId}': {
      ...method('get', { summary: 'Obter pesquisa', tags: ['Surveys'], operationId: 'getSurvey', parameters: [pathParam('surveyId', 'ID da pesquisa')], responses: { '200': responseJson('CustomerSurvey'), ...errs } }),
      ...method('put', { summary: 'Atualizar pesquisa', tags: ['Surveys'], operationId: 'updateSurvey', parameters: [pathParam('surveyId', 'ID da pesquisa')], requestBody: requestJson('UpdateSurveyRequest'), responses: { '200': responseJson('CustomerSurvey'), ...errs } })
    },
    '/surveys/{surveyId}/responses': {
      ...method('get', { summary: 'Listar respostas da pesquisa', tags: ['Surveys'], operationId: 'listSurveyResponses', parameters: [pathParam('surveyId', 'ID da pesquisa')], responses: { '200': responseArray('SurveyResponseRecord'), ...errs } }),
      ...method('post', { summary: 'Enviar resposta da pesquisa', tags: ['Surveys'], operationId: 'submitSurveyResponse', parameters: [pathParam('surveyId', 'ID da pesquisa')], requestBody: requestJson('SubmitSurveyResponseRequest'), responses: { '201': responseJson('SurveyResponseRecord'), ...errs } })
    },
    '/surveys/{surveyId}/responses/page': method('get', { summary: 'Listar respostas paginadas', tags: ['Surveys'], operationId: 'listSurveyResponsesPage', parameters: [pathParam('surveyId', 'ID da pesquisa'), queryParam('limit', 'Limite', { type: 'integer', minimum: 1, maximum: 200 }), queryParam('cursor', 'Cursor')], responses: { '200': responseJson('CursorSurveyResponsesPage'), ...errs } }),
    '/surveys/{surveyId}/responses/summary': method('get', { summary: 'Resumo de respostas', tags: ['Surveys'], operationId: 'getSurveyResponsesSummary', parameters: [pathParam('surveyId', 'ID da pesquisa')], responses: { '200': responseJson('SurveyResponsesSummary'), ...errs } }),
    '/surveys/{surveyId}/heatmap': method('get', { summary: 'Heatmap de respostas', tags: ['Surveys'], operationId: 'getSurveyHeatmap', parameters: [pathParam('surveyId', 'ID da pesquisa')], responses: { '200': responseArray('HeatmapPoint'), ...errs } }),
    '/surveys/{surveyId}/responses/batch': method('post', { summary: 'Enviar lote de respostas', tags: ['Surveys'], operationId: 'submitSurveyResponsesBatch', parameters: [pathParam('surveyId', 'ID da pesquisa')], requestBody: requestJson('SubmitSurveyResponsesBatchRequest'), responses: { '201': responseJson('SubmitBatchResponse'), ...errs } }),
    '/interviewer/surveys': method('get', { summary: 'Listar pesquisas disponiveis para entrevistador', tags: ['Interviewer'], operationId: 'listAvailableInterviewerSurveys', responses: { '200': responseArray('CustomerSurvey'), ...errs } }),
    '/admin/customers': method('get', { summary: 'Listar clientes', tags: ['Admin Customers'], operationId: 'listAdminCustomers', parameters: [queryParam('productCode', 'Codigo do produto')], responses: { '200': responseArray('AdminCustomerSummaryEnriched'), ...errs } }),
    '/admin/customers/{tenantId}/credits/purchase': method('post', { summary: 'Comprar creditos para cliente', tags: ['Admin Customers'], operationId: 'purchaseCustomerCredits', parameters: [pathParam('tenantId', 'ID do tenant')], requestBody: requestJson('PurchaseCustomerCreditsRequest'), responses: { '200': responseJson('TenantSubscriptionSnapshot'), ...errs } }),
    '/admin/credits/requests': method('get', { summary: 'Listar solicitacoes de credito', tags: ['Admin Credits'], operationId: 'listAdminCreditRequests', parameters: [queryParam('status', 'Status', { type: 'string', enum: ['PENDING', 'IN_ANALYSIS', 'APPROVED', 'REJECTED'] }), queryParam('productCode', 'Codigo do produto')], responses: { '200': responseArray('CreditPurchaseRequest'), ...errs } }),
    '/admin/credits/requests/page': method('get', { summary: 'Listar solicitacoes de credito (paginado)', tags: ['Admin Credits'], operationId: 'listAdminCreditRequestsPage', parameters: [queryParam('status', 'Status', { type: 'string', enum: ['PENDING', 'IN_ANALYSIS', 'APPROVED', 'REJECTED'] }), queryParam('productCode', 'Codigo do produto'), queryParam('limit', 'Limite', { type: 'integer', minimum: 1, maximum: 200 }), queryParam('cursor', 'Cursor')], responses: { '200': responseJson('CreditPurchaseRequestsPage'), ...errs } }),
    '/admin/credits/requests/{requestId}/approve': method('post', { summary: 'Aprovar solicitacao de credito', tags: ['Admin Credits'], operationId: 'approveAdminCreditRequest', parameters: [pathParam('requestId', 'ID da solicitacao')], requestBody: requestJson('ApproveRejectCreditRequest', false), responses: { '200': responseJson('CreditPurchaseRequest'), ...errs } }),
    '/admin/credits/requests/{requestId}/reject': method('post', { summary: 'Rejeitar solicitacao de credito', tags: ['Admin Credits'], operationId: 'rejectAdminCreditRequest', parameters: [pathParam('requestId', 'ID da solicitacao')], requestBody: requestJson('ApproveRejectCreditRequest', false), responses: { '200': responseJson('CreditPurchaseRequest'), ...errs } }),
    '/admin/payments/config': {
      ...method('get', { summary: 'Obter configuracao de gateway', tags: ['Admin Payments'], operationId: 'getAdminPaymentConfig', parameters: [queryParam('productCode', 'Codigo do produto')], responses: { '200': responseJson('PaymentGatewayConfig'), ...errs } }),
      ...method('put', { summary: 'Salvar configuracao de gateway', tags: ['Admin Payments'], operationId: 'upsertAdminPaymentConfig', requestBody: requestJson('UpsertPaymentConfigRequest'), responses: { '200': responseJson('PaymentGatewayConfig'), ...errs } })
    },
    '/admin/billing/credit-sales': method('get', { summary: 'Relatorio de vendas de credito', tags: ['Admin Billing'], operationId: 'getAdminBillingCreditSales', parameters: [queryParam('tenantId', 'Filtrar por tenant'), queryParam('productCode', 'Codigo do produto'), queryParam('status', 'Status', { type: 'string', enum: ['ALL', 'OPEN', 'PENDING', 'IN_ANALYSIS', 'APPROVED', 'REJECTED'] }), queryParam('dateFrom', 'Data inicial (YYYY-MM-DD)'), queryParam('dateTo', 'Data final (YYYY-MM-DD)')], responses: { '200': responseJson('BillingCreditSalesReport'), ...errs } }),
    '/admin/plans': {
      ...method('get', { summary: 'Listar planos', tags: ['Admin Plans'], operationId: 'listPlanDefinitions', parameters: [queryParam('productCode', 'Codigo do produto')], responses: { '200': responseArray('PlanDefinition'), ...errs } }),
      ...method('post', { summary: 'Criar plano', tags: ['Admin Plans'], operationId: 'createPlanDefinition', requestBody: requestJson('CreatePlanRequest'), responses: { '201': responseJson('PlanDefinition'), ...errs } })
    },
    '/admin/plans/{planId}': {
      ...method('put', { summary: 'Atualizar plano', tags: ['Admin Plans'], operationId: 'updatePlanDefinition', parameters: [pathParam('planId', 'ID do plano')], requestBody: requestJson('UpdatePlanRequest'), responses: { '200': responseJson('PlanDefinition'), ...errs } }),
      ...method('delete', { summary: 'Excluir plano (logico)', tags: ['Admin Plans'], operationId: 'deletePlanDefinition', parameters: [pathParam('planId', 'ID do plano')], responses: { '200': responseJson('PlanDefinition'), ...errs } })
    },
    '/admin/plans/{planId}/audits': method('get', { summary: 'Listar auditoria de plano', tags: ['Admin Plans'], operationId: 'listPlanAudits', parameters: [pathParam('planId', 'ID do plano')], responses: { '200': responseArray('PlanAuditEntry'), ...errs } }),
    '/admin/users': {
      ...method('get', { summary: 'Listar usuarios admin', tags: ['Admin Users'], operationId: 'listAdminUsers', responses: { '200': responseArray('OwnerAdminUser'), ...errs } }),
      ...method('post', { summary: 'Criar usuario admin', tags: ['Admin Users'], operationId: 'createAdminUser', requestBody: requestJson('CreateAdminUserRequest'), responses: { '201': responseJson('OwnerAdminUser'), ...errs } })
    },
    '/admin/users/{userId}': method('put', { summary: 'Atualizar usuario admin', tags: ['Admin Users'], operationId: 'updateAdminUser', parameters: [pathParam('userId', 'ID do usuario')], requestBody: requestJson('UpdateAdminUserRequest'), responses: { '200': responseJson('OwnerAdminUser'), ...errs } }),
    '/admin/finance/suppliers': {
      ...method('get', { summary: 'Listar fornecedores', tags: ['Admin Finance'], operationId: 'listFinanceSuppliers', responses: { '200': responseArray('FinancialSupplier'), ...errs } }),
      ...method('post', { summary: 'Criar fornecedor', tags: ['Admin Finance'], operationId: 'createFinanceSupplier', requestBody: requestJson('CreateSupplierRequest'), responses: { '201': responseJson('FinancialSupplier'), ...errs } })
    },
    '/admin/finance/suppliers/{supplierId}': method('put', { summary: 'Atualizar fornecedor', tags: ['Admin Finance'], operationId: 'updateFinanceSupplier', parameters: [pathParam('supplierId', 'ID do fornecedor')], requestBody: requestJson('UpdateSupplierRequest'), responses: { '200': responseJson('FinancialSupplier'), ...errs } }),
    '/admin/finance/expenses': {
      ...method('get', { summary: 'Listar despesas', tags: ['Admin Finance'], operationId: 'listFinanceExpenses', parameters: [queryParam('status', 'Status', { type: 'string', enum: ['PLANNED', 'OPEN', 'PAID', 'CANCELLED', 'PENDING_VALUE'] }), queryParam('type', 'Tipo', { type: 'string', enum: ['FIXED', 'VARIABLE', 'FIXED_VARIABLE'] }), queryParam('dateFrom', 'Data inicial'), queryParam('dateTo', 'Data final'), queryParam('supplierId', 'ID do fornecedor'), queryParam('month', 'Mes YYYY-MM'), queryParam('isForecast', 'Filtrar previsao', { type: 'boolean' })], responses: { '200': responseArray('FinancialExpense'), ...errs } }),
      ...method('post', { summary: 'Criar despesa', tags: ['Admin Finance'], operationId: 'createFinanceExpense', requestBody: requestJson('CreateExpenseRequest'), responses: { '201': responseJson('FinancialExpense'), ...errs } })
    },
    '/admin/finance/expenses/{expenseId}': method('put', { summary: 'Atualizar despesa', tags: ['Admin Finance'], operationId: 'updateFinanceExpense', parameters: [pathParam('expenseId', 'ID da despesa')], requestBody: requestJson('UpdateExpenseRequest'), responses: { '200': responseJson('FinancialExpense'), ...errs } }),
    '/admin/finance/forecast/{month}': {
      ...method('get', { summary: 'Obter forecast', tags: ['Admin Finance'], operationId: 'getFinanceForecast', parameters: [pathParam('month', 'Mes YYYY-MM')], responses: { '200': responseJson('FinancialForecastMonth'), ...errs } }),
      ...method('put', { summary: 'Salvar forecast', tags: ['Admin Finance'], operationId: 'upsertFinanceForecast', parameters: [pathParam('month', 'Mes YYYY-MM')], requestBody: requestJson('UpsertForecastRequest'), responses: { '200': responseJson('FinancialForecastMonth'), ...errs } })
    },
    '/admin/finance/overview': method('get', { summary: 'Resumo financeiro', tags: ['Admin Finance'], operationId: 'getFinanceOverview', parameters: [queryParam('dateFrom', 'Data inicial'), queryParam('dateTo', 'Data final'), queryParam('month', 'Mes YYYY-MM')], responses: { '200': responseJson('FinancialOverview'), ...errs } }),
    '/admin/finance/recurring/templates': {
      ...method('get', { summary: 'Listar templates recorrentes', tags: ['Admin Finance'], operationId: 'listFinanceRecurringTemplates', responses: { '200': responseArray('FinancialRecurringTemplate'), ...errs } }),
      ...method('post', { summary: 'Criar template recorrente', tags: ['Admin Finance'], operationId: 'createFinanceRecurringTemplate', requestBody: requestJson('CreateRecurringTemplateRequest'), responses: { '201': responseJson('FinancialRecurringTemplate'), ...errs } })
    },
    '/admin/finance/recurring/templates/{templateId}': method('put', { summary: 'Atualizar template recorrente', tags: ['Admin Finance'], operationId: 'updateFinanceRecurringTemplate', parameters: [pathParam('templateId', 'ID do template')], requestBody: requestJson('UpdateRecurringTemplateRequest'), responses: { '200': responseJson('FinancialRecurringTemplate'), ...errs } }),
    '/admin/finance/recurring/generate': method('post', { summary: 'Gerar despesas recorrentes do mes', tags: ['Admin Finance'], operationId: 'generateFinanceRecurringMonth', requestBody: requestJson('GenerateRecurringMonthRequest'), responses: { '200': responseJson('GenerateRecurringMonthResponse'), ...errs } }),
    '/admin/finance/recurring/pending-updates': method('get', { summary: 'Listar pendencias de valor', tags: ['Admin Finance'], operationId: 'listFinancePendingUpdates', parameters: [queryParam('month', 'Mes YYYY-MM')], responses: { '200': responseArray('FinancialExpense'), ...errs } }),
    '/admin/finance/installments/generate': method('post', { summary: 'Gerar parcelamento', tags: ['Admin Finance'], operationId: 'generateFinanceInstallments', requestBody: requestJson('GenerateInstallmentsRequest'), responses: { '201': responseJson('GenerateInstallmentsResponse'), ...errs } }),
    '/admin/frontend/settings': {
      ...method('get', { summary: 'Obter configuracoes do frontend', tags: ['Admin Frontend'], operationId: 'getAdminFrontendSettings', parameters: [queryParam('productCode', 'Codigo do produto')], responses: { '200': responseJson('FrontendSettings'), ...errs } }),
      ...method('put', { summary: 'Salvar configuracoes do frontend', tags: ['Admin Frontend'], operationId: 'upsertAdminFrontendSettings', requestBody: requestJson('UpsertFrontendSettingsRequest'), responses: { '200': responseJson('FrontendSettings'), ...errs } })
    },
    '/plans/catalog': method('get', { summary: 'Catalogo publico de planos', tags: ['Public'], operationId: 'listPublicPlanCatalog', security: [{ AppToken: [] }], parameters: [queryParam('productCode', 'Codigo do produto')], responses: { '200': responseArray('PlanDefinition'), ...errs } }),
    '/frontend/settings': method('get', { summary: 'Configuracoes publicas de frontend', tags: ['Public'], operationId: 'getPublicFrontendSettings', security: [], parameters: [queryParam('productCode', 'Codigo do produto')], responses: { '200': responseJson('FrontendSettings'), ...errs } }),
    '/integrations/brasilapi/cep/{cep}': method('get', { summary: 'Consultar CEP', tags: ['Integrations'], operationId: 'getCep', security: [{ AppToken: [] }], parameters: [pathParam('cep', 'CEP com 8 digitos')], responses: { '200': responseJson('GenericObject'), ...errs } }),
    '/integrations/brasilapi/cnpj/{cnpj}': method('get', { summary: 'Consultar CNPJ', tags: ['Integrations'], operationId: 'getCnpj', security: [{ AppToken: [] }], parameters: [pathParam('cnpj', 'CNPJ com 14 digitos')], responses: { '200': responseJson('GenericObject'), ...errs } }),
    '/integrations/brasilapi/cpf/{cpf}': method('get', { summary: 'Validar CPF', tags: ['Integrations'], operationId: 'validateCpf', security: [{ AppToken: [] }], parameters: [pathParam('cpf', 'CPF com 11 digitos')], responses: { '200': responseJson('GenericObject'), ...errs } }),
    '/webhooks/payments/{provider}': method('post', { summary: 'Receber webhook de pagamento', tags: ['Webhooks'], operationId: 'receivePaymentWebhook', security: [], parameters: [pathParam('provider', 'Provider de pagamento'), queryParam('productCode', 'Codigo do produto')], requestBody: requestJson('GenericObject'), responses: { '200': responseJson('WebhookResponse'), '202': responseJson('WebhookResponse'), ...errs } })
  }
});
