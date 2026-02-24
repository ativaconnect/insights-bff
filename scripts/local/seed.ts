import { randomBytes, randomInt, randomUUID, scryptSync } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { SurveyQuestion } from '../../src/infrastructure/persistence/dynamodb/customer-survey.repository';

const OWNER_PERMISSIONS = [
  'CUSTOMERS_READ',
  'CUSTOMERS_WRITE',
  'PLANS_READ',
  'PLANS_WRITE',
  'BILLING_READ',
  'BILLING_REVIEW',
  'FINANCE_READ',
  'FINANCE_WRITE',
  'PAYMENTS_CONFIG_READ',
  'PAYMENTS_CONFIG_WRITE',
  'USERS_READ',
  'USERS_WRITE'
] as const;

const seedPlans = [
  {
    code: 'START',
    name: 'Start',
    description: 'Plano inicial automatico para novos clientes.',
    tier: 0,
    pricePerForm: 0,
    minForms: 0,
    maxSurveys: 5,
    maxQuestionsPerSurvey: 5,
    maxResponsesPerSurvey: 15,
    maxInterviewers: 1,
    active: true
  },
  {
    code: 'PERSONAL',
    name: 'Personal',
    description: 'Ideal para pequenos projetos e testes de campo.',
    tier: 1,
    pricePerForm: 1.5,
    minForms: 100,
    maxSurveys: 12,
    maxQuestionsPerSurvey: 15,
    maxResponsesPerSurvey: 500,
    maxInterviewers: 3,
    active: true
  },
  {
    code: 'PROFESSIONAL',
    name: 'Professional',
    description: 'Plano recomendado para operacoes recorrentes em crescimento.',
    tier: 2,
    pricePerForm: 1.2,
    minForms: 500,
    maxSurveys: 40,
    maxQuestionsPerSurvey: 25,
    maxResponsesPerSurvey: 2500,
    maxInterviewers: 15,
    active: true
  },
  {
    code: 'PREMIUM',
    name: 'Premium',
    description: 'Melhor custo por formulario para alto volume.',
    tier: 3,
    pricePerForm: 0.99,
    minForms: 1200,
    maxSurveys: 200,
    maxQuestionsPerSurvey: 40,
    maxResponsesPerSurvey: 20000,
    maxInterviewers: 100,
    active: true
  }
] as const;

const TEST_EMAIL = 'teste@ativaconnect.com.br';
const TEST_PASSWORD = 'admin123';
const TARGET_CREDITS = 10000;
const SURVEY_MARKER = 'SEED_PRESIDENCIAL_2026';
const INTERVIEWERS_PER_ROUND = 10;
const FORMS_PER_ROUND = 1200;

const rounds = [
  { id: 'r1', name: 'Rodada 1 - Julho/2026', periodStart: '2026-07-01', periodEnd: '2026-07-10' },
  { id: 'r2', name: 'Rodada 2 - Agosto/2026', periodStart: '2026-08-01', periodEnd: '2026-08-10' },
  { id: 'r3', name: 'Rodada 3 - Setembro/2026', periodStart: '2026-09-01', periodEnd: '2026-09-10' }
] as const;

const hashPassword = (password: string): { hash: string; salt: string } => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const pick = <T>(list: readonly T[]): T => list[randomInt(0, list.length)];

const randomDateInRound = (periodStart: string, periodEnd: string): string => {
  const from = new Date(`${periodStart}T08:00:00.000Z`).getTime();
  const to = new Date(`${periodEnd}T21:00:00.000Z`).getTime();
  const sampled = randomInt(from, to + 1);
  return new Date(sampled).toISOString();
};

const indexedDateInRound = (periodStart: string, periodEnd: string, index: number, total: number): string => {
  const from = new Date(`${periodStart}T08:00:00.000Z`).getTime();
  const to = new Date(`${periodEnd}T21:00:00.000Z`).getTime();
  const span = Math.max(1, to - from);
  const ratio = total <= 1 ? 0 : index / (total - 1);
  const raw = from + Math.floor(span * ratio);
  const offsetSeconds = (index % 53) * 37;
  return new Date(raw + offsetSeconds * 1000).toISOString();
};

const randomLocation = (): { lat: number; lng: number; accuracyMeters: number } => {
  const hotspots = [
    { lat: -23.5505, lng: -46.6333 },
    { lat: -22.9068, lng: -43.1729 },
    { lat: -15.7939, lng: -47.8828 },
    { lat: -12.9777, lng: -38.5016 },
    { lat: -3.7319, lng: -38.5267 },
    { lat: -30.0346, lng: -51.2177 },
    { lat: -8.0476, lng: -34.877 },
    { lat: -19.9167, lng: -43.9345 }
  ] as const;
  const base = pick(hotspots);
  const lat = base.lat + (Math.random() - 0.5) * 0.4;
  const lng = base.lng + (Math.random() - 0.5) * 0.4;
  const accuracyMeters = randomInt(5, 65);
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    accuracyMeters
  };
};

const buildQuestions = (): SurveyQuestion[] => [
  {
    id: 'q1-intencao-voto',
    order: 1,
    title: 'Se a eleicao presidencial fosse hoje, em quem voce votaria no primeiro turno?',
    type: 'SINGLE_CHOICE',
    required: true,
    options: [
      { id: 'cand-silva', label: 'Maria Silva (Partido A)' },
      { id: 'cand-costa', label: 'Joao Costa (Partido B)' },
      { id: 'cand-almeida', label: 'Ana Almeida (Partido C)' },
      { id: 'cand-pereira', label: 'Carlos Pereira (Partido D)' },
      { id: 'branco-nulo', label: 'Branco/Nulo' },
      { id: 'indeciso', label: 'Nao sabe/Indeciso' }
    ]
  },
  {
    id: 'q2-firmeza',
    order: 2,
    title: 'Quao firme esta sua decisao de voto?',
    type: 'SINGLE_CHOICE',
    required: true,
    conditions: {
      mode: 'ANY',
      rules: [
        { sourceQuestionId: 'q1-intencao-voto', operator: 'includes', value: 'cand-silva' },
        { sourceQuestionId: 'q1-intencao-voto', operator: 'includes', value: 'cand-costa' },
        { sourceQuestionId: 'q1-intencao-voto', operator: 'includes', value: 'cand-almeida' },
        { sourceQuestionId: 'q1-intencao-voto', operator: 'includes', value: 'cand-pereira' }
      ]
    },
    options: [
      { id: 'muito-firme', label: 'Muito firme' },
      { id: 'pouco-firme', label: 'Pode mudar' }
    ]
  },
  {
    id: 'q3-segundo-turno',
    order: 3,
    title: 'Num eventual segundo turno entre Maria Silva e Joao Costa, em quem voce votaria?',
    type: 'SINGLE_CHOICE',
    required: true,
    options: [
      { id: '2t-silva', label: 'Maria Silva' },
      { id: '2t-costa', label: 'Joao Costa' },
      { id: '2t-branco', label: 'Branco/Nulo' },
      { id: '2t-indeciso', label: 'Nao sabe/Indeciso' }
    ]
  },
  {
    id: 'q4-principal-tema',
    order: 4,
    title: 'Qual principal tema pesa no seu voto?',
    type: 'SINGLE_CHOICE',
    required: true,
    options: [
      { id: 'tema-economia', label: 'Economia e emprego' },
      { id: 'tema-seguranca', label: 'Seguranca publica' },
      { id: 'tema-saude', label: 'Saude' },
      { id: 'tema-educacao', label: 'Educacao' },
      { id: 'tema-corrupcao', label: 'Corrupcao e etica' },
      { id: 'tema-social', label: 'Programas sociais' }
    ]
  },
  {
    id: 'q5-avaliacao-governo',
    order: 5,
    title: 'Como voce avalia o governo federal atual?',
    type: 'SINGLE_CHOICE',
    required: true,
    options: [
      { id: 'otimo-bom', label: 'Otimo/Bom' },
      { id: 'regular', label: 'Regular' },
      { id: 'ruim-pessimo', label: 'Ruim/Pessimo' }
    ]
  },
  {
    id: 'q6-rejeicao',
    order: 6,
    title: 'Em qual candidato voce nao votaria de jeito nenhum?',
    type: 'SINGLE_CHOICE',
    required: true,
    options: [
      { id: 'rej-silva', label: 'Maria Silva' },
      { id: 'rej-costa', label: 'Joao Costa' },
      { id: 'rej-almeida', label: 'Ana Almeida' },
      { id: 'rej-pereira', label: 'Carlos Pereira' },
      { id: 'rej-nenhum', label: 'Nao rejeita nenhum' }
    ]
  },
  {
    id: 'q7-fontes',
    order: 7,
    title: 'Quais fontes voce mais usa para se informar sobre politica? (ate 2)',
    type: 'MULTI_CHOICE_MIN',
    required: true,
    minSelections: 1,
    options: [
      { id: 'fonte-tv', label: 'TV aberta/fechada' },
      { id: 'fonte-whatsapp', label: 'WhatsApp/Telegram' },
      { id: 'fonte-instagram', label: 'Instagram/TikTok' },
      { id: 'fonte-jornal', label: 'Portais/Jornais' },
      { id: 'fonte-radio', label: 'Radio' },
      { id: 'fonte-familia', label: 'Familia/Amigos' }
    ]
  },
  {
    id: 'q8-faixa-etaria',
    order: 8,
    title: 'Qual sua faixa etaria?',
    type: 'SINGLE_CHOICE',
    required: true,
    options: [
      { id: '16-24', label: '16 a 24' },
      { id: '25-34', label: '25 a 34' },
      { id: '35-44', label: '35 a 44' },
      { id: '45-59', label: '45 a 59' },
      { id: '60+', label: '60 ou mais' }
    ]
  },
  {
    id: 'q9-renda',
    order: 9,
    title: 'Faixa de renda familiar mensal?',
    type: 'SINGLE_CHOICE',
    required: true,
    options: [
      { id: 'ate-2sm', label: 'Ate 2 salarios minimos' },
      { id: '2a5sm', label: 'De 2 a 5 salarios minimos' },
      { id: '5a10sm', label: 'De 5 a 10 salarios minimos' },
      { id: '10sm+', label: 'Acima de 10 salarios minimos' }
    ]
  },
  {
    id: 'q10-mudanca-voto',
    order: 10,
    title: 'O que faria voce mudar seu voto?',
    type: 'OPEN_TEXT',
    required: false,
    condition: { sourceQuestionId: 'q2-firmeza', operator: 'equals', value: 'pouco-firme' }
  }
];

const buildAnswers = (): Record<string, unknown> => {
  const firstTurn = pick(['cand-silva', 'cand-costa', 'cand-almeida', 'cand-pereira', 'branco-nulo', 'indeciso'] as const);
  const firmness =
    firstTurn === 'branco-nulo' || firstTurn === 'indeciso'
      ? undefined
      : pick(['muito-firme', 'pouco-firme'] as const);
  const infoSources = ['fonte-tv', 'fonte-whatsapp', 'fonte-instagram', 'fonte-jornal', 'fonte-radio', 'fonte-familia'];
  const shuffled = [...infoSources].sort(() => Math.random() - 0.5);
  const selectedCount = Math.random() < 0.65 ? 1 : 2;

  const answers: Record<string, unknown> = {
    'q1-intencao-voto': firstTurn,
    'q3-segundo-turno': pick(['2t-silva', '2t-costa', '2t-branco', '2t-indeciso'] as const),
    'q4-principal-tema': pick(
      ['tema-economia', 'tema-seguranca', 'tema-saude', 'tema-educacao', 'tema-corrupcao', 'tema-social'] as const
    ),
    'q5-avaliacao-governo': pick(['otimo-bom', 'regular', 'ruim-pessimo'] as const),
    'q6-rejeicao': pick(['rej-silva', 'rej-costa', 'rej-almeida', 'rej-pereira', 'rej-nenhum'] as const),
    'q7-fontes': shuffled.slice(0, selectedCount),
    'q8-faixa-etaria': pick(['16-24', '25-34', '35-44', '45-59', '60+'] as const),
    'q9-renda': pick(['ate-2sm', '2a5sm', '5a10sm', '10sm+'] as const)
  };

  if (firmness) {
    answers['q2-firmeza'] = firmness;
    if (firmness === 'pouco-firme') {
      answers['q10-mudanca-voto'] = pick([
        'Debate televisivo',
        'Escandalo de corrupcao',
        'Propostas para economia',
        'Melhor plano para saude'
      ] as const);
    }
  }

  return answers;
};

const ensureBaseEnv = (): void => {
  process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
  process.env.DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
  process.env.DYNAMODB_CUSTOMERS_TABLE_NAME = process.env.DYNAMODB_CUSTOMERS_TABLE_NAME ?? 'insights-customers-local';
  process.env.DYNAMODB_PLANS_TABLE_NAME = process.env.DYNAMODB_PLANS_TABLE_NAME ?? 'insights-plans-local';
  process.env.DYNAMODB_BILLING_TABLE_NAME = process.env.DYNAMODB_BILLING_TABLE_NAME ?? 'insights-billing-local';
  process.env.DYNAMODB_FINANCE_TABLE_NAME = process.env.DYNAMODB_FINANCE_TABLE_NAME ?? 'insights-finance-local';
  process.env.DYNAMODB_SURVEYS_TABLE_NAME = process.env.DYNAMODB_SURVEYS_TABLE_NAME ?? 'insights-surveys-local';
};

const loadCustomerAccountRepository = async () => {
  return require('../../src/infrastructure/persistence/dynamodb/customer-account.repository').CustomerAccountRepository as {
    new (): {
      register: (...args: unknown[]) => Promise<{ tenantId: string }>;
    };
  };
};

const loadCustomerSurveyRepository = async () => {
  return require('../../src/infrastructure/persistence/dynamodb/customer-survey.repository').CustomerSurveyRepository as {
    new (): {
      list: (...args: unknown[]) => Promise<Array<{ id: string; description: string; responsesCount?: number }>>;
      create: (...args: unknown[]) => Promise<{ id: string; responsesCount?: number }>;
      update: (...args: unknown[]) => Promise<{ responsesCount?: number } | null>;
      addResponsesBatch: (...args: unknown[]) => Promise<unknown>;
    };
  };
};

const loadInterviewerRepository = async () => {
  return require('../../src/infrastructure/persistence/dynamodb/interviewer.repository').InterviewerRepository as {
    new (): {
      list: (...args: unknown[]) => Promise<Array<{ id: string; login: string; status: 'active' | 'inactive' }>>;
      create: (...args: unknown[]) => Promise<{ id: string; login: string; status: 'active' | 'inactive' }>;
    };
  };
};

const loadTenantSubscriptionRepository = async () => {
  return require('../../src/infrastructure/persistence/dynamodb/tenant-subscription.repository').TenantSubscriptionRepository as {
    new (): {
      getSnapshot: (...args: unknown[]) => Promise<{
        planCode: string;
        questionnaireCreditsBalance: number;
        limits: { maxResponsesPerSurvey: number };
      } | null>;
      purchaseCredits: (...args: unknown[]) => Promise<unknown>;
    };
  };
};

const ensureOwnerAdminAndPlans = async (): Promise<void> => {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
  const plansTable = process.env.DYNAMODB_PLANS_TABLE_NAME ?? 'insights-plans-local';

  const adminEmail = (process.env.DEFAULT_ADMIN_USER ?? 'admin@ativaconnect.com.br').trim().toLowerCase();
  const adminPassword = (process.env.DEFAULT_ADMIN_PASSWORD ?? 'admin123').trim();
  const adminName = (process.env.DEFAULT_ADMIN_NAME ?? 'Administrador Principal').trim();
  const adminTenantId = (process.env.DEFAULT_ADMIN_TENANT_ID ?? 'tenant-owner-admin').trim();

  const client = new DynamoDBClient({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local'
    }
  });
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: true
    }
  });

  const emailLockKey = { PK: `OWNER_USER_EMAIL#${adminEmail}`, SK: 'LOCK' };
  const existingOwnerLock = await doc.send(
    new GetCommand({
      TableName: plansTable,
      Key: emailLockKey
    })
  );

  let adminUserId = String(existingOwnerLock.Item?.userId ?? '');
  if (!adminUserId) {
    const now = new Date().toISOString();
    const password = hashPassword(adminPassword);
    adminUserId = `owner-${randomUUID()}`;

    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: plansTable,
              Item: {
                ...emailLockKey,
                entityType: 'OWNER_ADMIN_USER_EMAIL_LOCK',
                userId: adminUserId,
                createdAt: now
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          },
          {
            Put: {
              TableName: plansTable,
              Item: {
                PK: `OWNER_USER#${adminUserId}`,
                SK: 'PROFILE',
                GSI2PK: 'ENTITY#OWNER_ADMIN_USER',
                GSI2SK: `${now}#${adminUserId}`,
                entityType: 'OWNER_ADMIN_USER',
                id: adminUserId,
                tenantId: adminTenantId,
                name: adminName,
                email: adminEmail,
                accessLevel: 'OWNER',
                permissions: [...OWNER_PERMISSIONS],
                active: true,
                createdAt: now,
                updatedAt: now,
                createdBy: 'system-bootstrap',
                passwordHash: password.hash,
                passwordSalt: password.salt
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          }
        ]
      })
    );
    console.log(`Seed owner admin created: ${adminEmail}`);
  } else {
    console.log(`Seed owner admin already exists: ${adminEmail}`);
  }

  let createdPlans = 0;
  for (const plan of seedPlans) {
    const now = new Date().toISOString();
    const code = plan.code.toUpperCase();
    const productCode = 'INSIGHTS';
    const lockKey = { PK: `PLANDEF_CODE#${productCode}#${code}`, SK: 'LOCK' };

    const existingLock = await doc.send(
      new GetCommand({
        TableName: plansTable,
        Key: lockKey
      })
    );
    if (existingLock.Item?.planId) {
      continue;
    }

    const planId = `plan-${code.toLowerCase()}`;
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: plansTable,
              Item: {
                ...lockKey,
                entityType: 'PLAN_DEFINITION_CODE_LOCK',
                planId,
                productCode,
                code
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          },
          {
            Put: {
              TableName: plansTable,
              Item: {
                PK: `PLANDEF#${planId}`,
                SK: 'PROFILE',
                GSI2PK: 'ENTITY#PLAN_DEFINITION',
                GSI2SK: `${now}#${planId}`,
                entityType: 'PLAN_DEFINITION',
                id: planId,
                productCode,
                code,
                name: plan.name,
                description: plan.description,
                tier: plan.tier,
                pricePerForm: plan.pricePerForm,
                minForms: plan.minForms,
                maxSurveys: plan.maxSurveys,
                maxQuestionsPerSurvey: plan.maxQuestionsPerSurvey,
                maxResponsesPerSurvey: plan.maxResponsesPerSurvey,
                maxInterviewers: plan.maxInterviewers,
                active: plan.active,
                createdAt: now,
                updatedAt: now
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          }
        ]
      })
    );
    createdPlans += 1;
  }
  console.log(`Seed plans created: ${createdPlans}`);
};

const ensureTestCustomer = async (): Promise<{ tenantId: string }> => {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
  const customersTable = process.env.DYNAMODB_CUSTOMERS_TABLE_NAME ?? 'insights-customers-local';
  const email = normalizeEmail(TEST_EMAIL);

  const client = new DynamoDBClient({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local'
    }
  });
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: true
    }
  });

  const lock = await doc.send(
    new GetCommand({
      TableName: customersTable,
      Key: { PK: `USEREMAIL#${email}`, SK: 'LOCK' }
    })
  );

  if (!lock.Item?.tenantId) {
    const CustomerAccountRepository = await loadCustomerAccountRepository();
    const repository = new CustomerAccountRepository();
    const created = await repository.register({
      personType: 'PJ',
      document: '12345678000195',
      legalName: 'Ativa Connect Pesquisa LTDA',
      tradeName: 'Ativa Connect Teste',
      email,
      phone: '11999990000',
      password: TEST_PASSWORD,
      address: {
        cep: '01001000',
        state: 'SP',
        city: 'Sao Paulo',
        neighborhood: 'Centro',
        street: 'Praca da Se',
        number: '100',
        complement: 'Conj 12'
      }
    });
    console.log(`Seed customer created: ${email}`);
    return { tenantId: created.tenantId };
  }

  const tenantId = String(lock.Item.tenantId);
  const userId = String(lock.Item.userId);
  const tenantOutput = await doc.send(
    new GetCommand({
      TableName: customersTable,
      Key: { PK: `TENANT#${tenantId}`, SK: 'PROFILE' }
    })
  );
  const userOutput = await doc.send(
    new GetCommand({
      TableName: customersTable,
      Key: { PK: `USER#${userId}`, SK: 'PROFILE' }
    })
  );

  const tenant = tenantOutput.Item as Record<string, unknown> | undefined;
  const user = userOutput.Item as Record<string, unknown> | undefined;
  if (!tenant || !user) {
    throw new Error('Tenant/user lock encontrado sem profile correspondente.');
  }

  const password = hashPassword(TEST_PASSWORD);
  const now = new Date().toISOString();
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: customersTable,
            Item: {
              ...tenant,
              email,
              legalName: 'Ativa Connect Pesquisa LTDA',
              tradeName: 'Ativa Connect Teste',
              updatedAt: now
            },
            ConditionExpression: 'attribute_exists(PK)'
          }
        },
        {
          Put: {
            TableName: customersTable,
            Item: {
              ...user,
              email,
              name: 'Ativa Connect Pesquisa LTDA',
              passwordHash: password.hash,
              passwordSalt: password.salt,
              updatedAt: now
            },
            ConditionExpression: 'attribute_exists(PK)'
          }
        },
        {
          Put: {
            TableName: customersTable,
            Item: {
              PK: `USEREMAIL#${email}`,
              SK: 'LOCK',
              entityType: 'USER_EMAIL_LOCK',
              userId,
              tenantId,
              email
            }
          }
        }
      ]
    })
  );

  console.log(`Seed customer already exists, password reset: ${email}`);
  return { tenantId };
};

const ensurePremiumCredits = async (tenantId: string): Promise<void> => {
  const TenantSubscriptionRepository = await loadTenantSubscriptionRepository();
  const subscriptionRepository = new TenantSubscriptionRepository();
  const snapshot = await subscriptionRepository.getSnapshot(tenantId);
  if (!snapshot) {
    throw new Error('Nao foi possivel carregar assinatura do tenant de teste.');
  }

  const missing = Math.max(0, TARGET_CREDITS - Number(snapshot.questionnaireCreditsBalance ?? 0));
  if (snapshot.planCode.toUpperCase() !== 'PREMIUM' || missing > 0) {
    await subscriptionRepository.purchaseCredits(tenantId, 'PREMIUM', Math.max(missing, 1));
  }
  const refreshed = await subscriptionRepository.getSnapshot(tenantId);
  console.log(
    `Seed subscription set: tenant=${tenantId} plan=${refreshed?.planCode ?? 'n/a'} credits=${
      refreshed?.questionnaireCreditsBalance ?? 0
    }`
  );
};

const ensureInterviewers = async (tenantId: string): Promise<Array<{ id: string; login: string }>> => {
  const InterviewerRepository = await loadInterviewerRepository();
  const repository = new InterviewerRepository();
  const existing = await repository.list(tenantId);
  const map = new Map(existing.map((item) => [item.login.trim().toLowerCase(), item]));

  for (let i = 1; i <= INTERVIEWERS_PER_ROUND; i += 1) {
    const login = `entrevistador${String(i).padStart(2, '0')}@ativaconnect.com.br`;
    if (!map.has(login)) {
      const created = await repository.create(tenantId, {
        name: `Entrevistador ${String(i).padStart(2, '0')}`,
        login,
        password: TEST_PASSWORD,
        phone: `1199000${String(100 + i)}`,
        email: login
      });
      map.set(login, created);
    }
  }

  return Array.from(map.values())
    .slice(0, INTERVIEWERS_PER_ROUND)
    .map((item) => ({ id: item.id, login: item.login }));
};

const ensureSurvey = async (
  tenantId: string,
  interviewerIds: string[]
): Promise<{ id: string; responsesCount: number }> => {
  const CustomerSurveyRepository = await loadCustomerSurveyRepository();
  const repository = new CustomerSurveyRepository();
  const surveys = await repository.list(tenantId);
  const existing = surveys.find((item) => item.description.includes(SURVEY_MARKER));
  const waveAssignments = interviewerIds.map((id) => ({ interviewerId: id, maxForms: FORMS_PER_ROUND / INTERVIEWERS_PER_ROUND }));

  if (existing) {
    const updated = await repository.update(tenantId, existing.id, {
      status: 'active',
      questions: buildQuestions(),
      waves: rounds.map((round) => ({
        id: round.id,
        name: round.name,
        periodStart: round.periodStart,
        periodEnd: round.periodEnd,
        interviewerAssignments: waveAssignments
      })),
      locationCapture: {
        captureEnabled: true,
        required: true,
        precision: 'exact',
        city: 'Brasil',
        state: 'BR'
      }
    });
    return { id: existing.id, responsesCount: Number(updated?.responsesCount ?? existing.responsesCount ?? 0) };
  }

  const created = await repository.create(tenantId, {
    name: 'Tracking Presidencial Brasil 2026',
    description: `Pesquisa presidencial 2026 completa com tracking por rodada. ${SURVEY_MARKER}`,
    status: 'active',
    audience: 'B2C',
    questions: buildQuestions(),
    locationCapture: {
      captureEnabled: true,
      required: true,
      precision: 'exact',
      city: 'Brasil',
      state: 'BR'
    },
    waves: rounds.map((round) => ({
      id: round.id,
      name: round.name,
      periodStart: round.periodStart,
      periodEnd: round.periodEnd,
      interviewerAssignments: waveAssignments
    }))
  });
  return { id: created.id, responsesCount: Number(created.responsesCount ?? 0) };
};

const seedResponses = async (tenantId: string, surveyId: string): Promise<void> => {
  const InterviewerRepository = await loadInterviewerRepository();
  const surveysTable = process.env.DYNAMODB_SURVEYS_TABLE_NAME ?? 'insights-surveys-local';
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
  const client = new DynamoDBClient({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local'
    }
  });
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: true
    }
  });
  const interviewerRepository = new InterviewerRepository();

  const interviewers = await interviewerRepository.list(tenantId);
  const chosen = interviewers
    .filter((item) => item.status === 'active')
    .sort((a, b) => a.login.localeCompare(b.login))
    .slice(0, INTERVIEWERS_PER_ROUND);
  if (chosen.length < INTERVIEWERS_PER_ROUND) {
    throw new Error('Entrevistadores insuficientes para gerar as 3 rodadas completas.');
  }

  const allRows: Array<Record<string, unknown>> = [];
  for (const round of rounds) {
    console.log(`Seeding round ${round.id}: ${FORMS_PER_ROUND} formularios...`);
    const payload = Array.from({ length: FORMS_PER_ROUND }).map((_, index) => {
      const interviewer = chosen[index % chosen.length];
      const submittedAt = indexedDateInRound(round.periodStart, round.periodEnd, index, FORMS_PER_ROUND);
      const responseId = `${SURVEY_MARKER}-${round.id}-${String(index + 1).padStart(4, '0')}`;
      const clientResponseId = `${SURVEY_MARKER}-${round.id}-${String(index + 1).padStart(4, '0')}`;
      return {
        PK: `SURVEY#${surveyId}`,
        SK: `RESPONSE#${submittedAt}#${responseId}`,
        GSI2PK: `TENANT#${tenantId}#SURVEY#RESPONSES`,
        GSI2SK: `${submittedAt}#${surveyId}#${responseId}`,
        entityType: 'SURVEY_RESPONSE',
        id: responseId,
        surveyId,
        tenantId,
        clientResponseId,
        submittedAt,
        answers: buildAnswers(),
        metadata: {
          interviewerId: interviewer.id,
          deviceId: `android-${interviewer.id.slice(0, 8)}`,
          location: randomLocation()
        }
      };
    });

    const chunkSize = 25;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      await doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [surveysTable]: chunk.map((item) => ({
              PutRequest: {
                Item: item
              }
            }))
          }
        })
      );
      console.log(`Round ${round.id}: ${Math.min(i + chunkSize, payload.length)}/${payload.length}`);
    }
    allRows.push(...payload);
  }

  const surveyOutput = await doc.send(
    new GetCommand({
      TableName: surveysTable,
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `SURVEY#${surveyId}`
      }
    })
  );
  const survey = surveyOutput.Item as Record<string, unknown> | undefined;
  if (!survey) {
    throw new Error('Pesquisa seed nao encontrada para atualizar responsesCount.');
  }

  await doc.send(
    new PutCommand({
      TableName: surveysTable,
      Item: {
        ...survey,
        responsesCount: rounds.length * FORMS_PER_ROUND,
        updatedAt: new Date().toISOString()
      }
    })
  );
};

const run = async (): Promise<void> => {
  ensureBaseEnv();
  await ensureOwnerAdminAndPlans();
  const { tenantId } = await ensureTestCustomer();
  await ensurePremiumCredits(tenantId);
  const interviewers = await ensureInterviewers(tenantId);
  const survey = await ensureSurvey(
    tenantId,
    interviewers.map((item) => item.id)
  );
  await seedResponses(tenantId, survey.id);
  console.log('Seed local finished (admin + plans + teste premium + pesquisa presidencial 2026).');
};

run().catch((error: unknown) => {
  console.error('Failed to execute local seed', error);
  process.exitCode = 1;
});
