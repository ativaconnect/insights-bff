type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface OperationConfig {
  summary: string;
  tags: string[];
  secured?: boolean;
  operationId: string;
}

const op = (config: OperationConfig) => ({
  summary: config.summary,
  operationId: config.operationId,
  tags: config.tags,
  ...(config.secured === false ? { security: [] } : {})
});

const method = (methodName: HttpMethod, config: OperationConfig) => ({
  [methodName]: op(config)
});

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
    }
  },
  paths: {
    '/docs': method('get', {
      summary: 'Swagger UI',
      tags: ['Docs'],
      secured: false,
      operationId: 'getSwaggerUi'
    }),
    '/docs/openapi.json': method('get', {
      summary: 'OpenAPI JSON',
      tags: ['Docs'],
      secured: false,
      operationId: 'getOpenApiJson'
    }),
    '/health': method('get', {
      summary: 'Health check',
      tags: ['Health'],
      secured: false,
      operationId: 'getHealth'
    }),
    '/auth/register': method('post', {
      summary: 'Registrar conta',
      tags: ['Auth'],
      secured: false,
      operationId: 'register'
    }),
    '/auth/login': method('post', {
      summary: 'Login',
      tags: ['Auth'],
      secured: false,
      operationId: 'login'
    }),
    '/me': {
      ...method('get', { summary: 'Obter perfil autenticado', tags: ['Me'], operationId: 'getMe' }),
      ...method('put', { summary: 'Atualizar perfil autenticado', tags: ['Me'], operationId: 'updateMe' })
    },
    '/me/credits/purchase': method('post', {
      summary: 'Comprar creditos diretamente',
      tags: ['Me'],
      operationId: 'purchaseMyCredits'
    }),
    '/me/credits/requests': {
      ...method('post', {
        summary: 'Solicitar compra de creditos',
        tags: ['Me'],
        operationId: 'requestMyCreditsPurchase'
      }),
      ...method('get', {
        summary: 'Listar solicitacoes de compra de creditos',
        tags: ['Me'],
        operationId: 'listMyCreditsPurchaseRequests'
      })
    },
    '/interviewers': {
      ...method('get', { summary: 'Listar entrevistadores', tags: ['Interviewers'], operationId: 'listInterviewers' }),
      ...method('post', {
        summary: 'Criar entrevistador',
        tags: ['Interviewers'],
        operationId: 'createInterviewer'
      })
    },
    '/interviewers/{interviewerId}': {
      ...method('put', {
        summary: 'Atualizar entrevistador',
        tags: ['Interviewers'],
        operationId: 'updateInterviewer'
      }),
      ...method('delete', {
        summary: 'Remover entrevistador',
        tags: ['Interviewers'],
        operationId: 'deleteInterviewer'
      })
    },
    '/interviewers/{interviewerId}/status': method('put', {
      summary: 'Atualizar status do entrevistador',
      tags: ['Interviewers'],
      operationId: 'setInterviewerStatus'
    }),
    '/surveys': {
      ...method('get', { summary: 'Listar pesquisas', tags: ['Surveys'], operationId: 'listSurveys' }),
      ...method('post', { summary: 'Criar pesquisa', tags: ['Surveys'], operationId: 'createSurvey' })
    },
    '/surveys/{surveyId}': {
      ...method('get', { summary: 'Obter pesquisa', tags: ['Surveys'], operationId: 'getSurvey' }),
      ...method('put', { summary: 'Atualizar pesquisa', tags: ['Surveys'], operationId: 'updateSurvey' })
    },
    '/surveys/{surveyId}/responses': {
      ...method('get', {
        summary: 'Listar respostas da pesquisa',
        tags: ['Surveys'],
        operationId: 'listSurveyResponses'
      }),
      ...method('post', {
        summary: 'Enviar resposta da pesquisa',
        tags: ['Surveys'],
        operationId: 'submitSurveyResponse'
      })
    },
    '/surveys/{surveyId}/responses/page': method('get', {
      summary: 'Listar respostas paginadas',
      tags: ['Surveys'],
      operationId: 'listSurveyResponsesPage'
    }),
    '/surveys/{surveyId}/responses/summary': method('get', {
      summary: 'Resumo de respostas',
      tags: ['Surveys'],
      operationId: 'getSurveyResponsesSummary'
    }),
    '/surveys/{surveyId}/heatmap': method('get', {
      summary: 'Heatmap de respostas',
      tags: ['Surveys'],
      operationId: 'getSurveyHeatmap'
    }),
    '/surveys/{surveyId}/responses/batch': method('post', {
      summary: 'Enviar lote de respostas',
      tags: ['Surveys'],
      operationId: 'submitSurveyResponsesBatch'
    }),
    '/interviewer/surveys': method('get', {
      summary: 'Listar pesquisas disponiveis para entrevistador',
      tags: ['Interviewer'],
      operationId: 'listAvailableInterviewerSurveys'
    }),
    '/admin/customers': method('get', {
      summary: 'Listar clientes',
      tags: ['Admin Customers'],
      operationId: 'listAdminCustomers'
    }),
    '/admin/customers/{tenantId}/credits/purchase': method('post', {
      summary: 'Comprar creditos para cliente',
      tags: ['Admin Customers'],
      operationId: 'purchaseCustomerCredits'
    }),
    '/admin/credits/requests': method('get', {
      summary: 'Listar solicitacoes de credito',
      tags: ['Admin Credits'],
      operationId: 'listAdminCreditRequests'
    }),
    '/admin/credits/requests/page': method('get', {
      summary: 'Listar solicitacoes de credito (paginado)',
      tags: ['Admin Credits'],
      operationId: 'listAdminCreditRequestsPage'
    }),
    '/admin/credits/requests/{requestId}/approve': method('post', {
      summary: 'Aprovar solicitacao de credito',
      tags: ['Admin Credits'],
      operationId: 'approveAdminCreditRequest'
    }),
    '/admin/credits/requests/{requestId}/reject': method('post', {
      summary: 'Rejeitar solicitacao de credito',
      tags: ['Admin Credits'],
      operationId: 'rejectAdminCreditRequest'
    }),
    '/admin/payments/config': {
      ...method('get', {
        summary: 'Obter configuracao de gateway',
        tags: ['Admin Payments'],
        operationId: 'getAdminPaymentConfig'
      }),
      ...method('put', {
        summary: 'Salvar configuracao de gateway',
        tags: ['Admin Payments'],
        operationId: 'upsertAdminPaymentConfig'
      })
    },
    '/admin/billing/credit-sales': method('get', {
      summary: 'Relatorio de vendas de credito',
      tags: ['Admin Billing'],
      operationId: 'getAdminBillingCreditSales'
    }),
    '/admin/plans': {
      ...method('get', { summary: 'Listar planos', tags: ['Admin Plans'], operationId: 'listPlanDefinitions' }),
      ...method('post', {
        summary: 'Criar plano',
        tags: ['Admin Plans'],
        operationId: 'createPlanDefinition'
      })
    },
    '/admin/plans/{planId}': {
      ...method('put', {
        summary: 'Atualizar plano',
        tags: ['Admin Plans'],
        operationId: 'updatePlanDefinition'
      }),
      ...method('delete', {
        summary: 'Excluir plano (logico)',
        tags: ['Admin Plans'],
        operationId: 'deletePlanDefinition'
      })
    },
    '/admin/plans/{planId}/audits': method('get', {
      summary: 'Listar auditoria de plano',
      tags: ['Admin Plans'],
      operationId: 'listPlanAudits'
    }),
    '/admin/users': {
      ...method('get', { summary: 'Listar usuarios admin', tags: ['Admin Users'], operationId: 'listAdminUsers' }),
      ...method('post', { summary: 'Criar usuario admin', tags: ['Admin Users'], operationId: 'createAdminUser' })
    },
    '/admin/users/{userId}': method('put', {
      summary: 'Atualizar usuario admin',
      tags: ['Admin Users'],
      operationId: 'updateAdminUser'
    }),
    '/admin/finance/suppliers': {
      ...method('get', {
        summary: 'Listar fornecedores',
        tags: ['Admin Finance'],
        operationId: 'listFinanceSuppliers'
      }),
      ...method('post', {
        summary: 'Criar fornecedor',
        tags: ['Admin Finance'],
        operationId: 'createFinanceSupplier'
      })
    },
    '/admin/finance/suppliers/{supplierId}': method('put', {
      summary: 'Atualizar fornecedor',
      tags: ['Admin Finance'],
      operationId: 'updateFinanceSupplier'
    }),
    '/admin/finance/expenses': {
      ...method('get', { summary: 'Listar despesas', tags: ['Admin Finance'], operationId: 'listFinanceExpenses' }),
      ...method('post', { summary: 'Criar despesa', tags: ['Admin Finance'], operationId: 'createFinanceExpense' })
    },
    '/admin/finance/expenses/{expenseId}': method('put', {
      summary: 'Atualizar despesa',
      tags: ['Admin Finance'],
      operationId: 'updateFinanceExpense'
    }),
    '/admin/finance/forecast/{month}': {
      ...method('get', { summary: 'Obter forecast', tags: ['Admin Finance'], operationId: 'getFinanceForecast' }),
      ...method('put', { summary: 'Salvar forecast', tags: ['Admin Finance'], operationId: 'upsertFinanceForecast' })
    },
    '/admin/finance/overview': method('get', {
      summary: 'Resumo financeiro',
      tags: ['Admin Finance'],
      operationId: 'getFinanceOverview'
    }),
    '/admin/finance/recurring/templates': {
      ...method('get', {
        summary: 'Listar templates recorrentes',
        tags: ['Admin Finance'],
        operationId: 'listFinanceRecurringTemplates'
      }),
      ...method('post', {
        summary: 'Criar template recorrente',
        tags: ['Admin Finance'],
        operationId: 'createFinanceRecurringTemplate'
      })
    },
    '/admin/finance/recurring/templates/{templateId}': method('put', {
      summary: 'Atualizar template recorrente',
      tags: ['Admin Finance'],
      operationId: 'updateFinanceRecurringTemplate'
    }),
    '/admin/finance/recurring/generate': method('post', {
      summary: 'Gerar despesas recorrentes do mes',
      tags: ['Admin Finance'],
      operationId: 'generateFinanceRecurringMonth'
    }),
    '/admin/finance/recurring/pending-updates': method('get', {
      summary: 'Listar pendencias de valor',
      tags: ['Admin Finance'],
      operationId: 'listFinancePendingUpdates'
    }),
    '/admin/finance/installments/generate': method('post', {
      summary: 'Gerar parcelamento',
      tags: ['Admin Finance'],
      operationId: 'generateFinanceInstallments'
    }),
    '/admin/frontend/settings': {
      ...method('get', {
        summary: 'Obter configuracoes do frontend',
        tags: ['Admin Frontend'],
        operationId: 'getAdminFrontendSettings'
      }),
      ...method('put', {
        summary: 'Salvar configuracoes do frontend',
        tags: ['Admin Frontend'],
        operationId: 'upsertAdminFrontendSettings'
      })
    },
    '/plans/catalog': method('get', {
      summary: 'Catalogo publico de planos',
      tags: ['Public'],
      secured: false,
      operationId: 'listPublicPlanCatalog'
    }),
    '/frontend/settings': method('get', {
      summary: 'Configuracoes publicas de frontend',
      tags: ['Public'],
      secured: false,
      operationId: 'getPublicFrontendSettings'
    }),
    '/integrations/brasilapi/cep/{cep}': method('get', {
      summary: 'Consultar CEP',
      tags: ['Integrations'],
      operationId: 'getCep'
    }),
    '/integrations/brasilapi/cnpj/{cnpj}': method('get', {
      summary: 'Consultar CNPJ',
      tags: ['Integrations'],
      operationId: 'getCnpj'
    }),
    '/integrations/brasilapi/cpf/{cpf}': method('get', {
      summary: 'Validar CPF',
      tags: ['Integrations'],
      operationId: 'validateCpf'
    }),
    '/webhooks/payments/{provider}': method('post', {
      summary: 'Receber webhook de pagamento',
      tags: ['Webhooks'],
      secured: false,
      operationId: 'receivePaymentWebhook'
    })
  }
});
