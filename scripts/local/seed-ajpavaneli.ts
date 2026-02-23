import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand
} from '@aws-sdk/lib-dynamodb';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException
} from '@aws-sdk/client-dynamodb';
import { normalizeDigits, normalizeEmail } from '../../src/infrastructure/persistence/dynamodb/keys';
import { hashPassword } from '../../src/infrastructure/security/password-hasher';

type RawItem = Record<string, unknown>;
type BatchWriteEntry = {
  PutRequest?: { Item: RawItem };
  DeleteRequest?: { Key: { PK: string; SK: string } };
};

const customersTableName = process.env.DYNAMODB_CUSTOMERS_TABLE_NAME ?? 'insights-customers-local';
const plansTableName = process.env.DYNAMODB_PLANS_TABLE_NAME ?? 'insights-plans-local';
const billingTableName = process.env.DYNAMODB_BILLING_TABLE_NAME ?? 'insights-billing-local';
const financeTableName = process.env.DYNAMODB_FINANCE_TABLE_NAME ?? 'insights-finance-local';
const surveysTableName = process.env.DYNAMODB_SURVEYS_TABLE_NAME ?? 'insights-surveys-local';

const target = {
  tenantId: 'tenant-ajpavaneli-local',
  userId: 'user-ajpavaneli-local',
  email: normalizeEmail('ajpavaneli@gmail.com'),
  password: '123456',
  legalName: 'AJ Pavaneli Pesquisas LTDA',
  tradeName: 'AJ Pavaneli',
  document: normalizeDigits('11222333000181')
} as const;

const creditsPurchased = 10000;
const roundsCount = 4;
const formsPerRound = 1500;
const interviewersCount = 10;
const formsExecuted = roundsCount * formsPerRound;
const advancedFormsExecuted = 500;
const finalCreditsBalance = creditsPurchased - formsExecuted - advancedFormsExecuted;

const infraClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT?.trim() || 'http://localhost:8000',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local'
  }
});

const docClient = DynamoDBDocumentClient.from(infraClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true
  }
});

const random = (seedValue: number): (() => number) => {
  let seed = seedValue >>> 0;
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
};

const pick = <T>(rand: () => number, values: readonly T[]): T => values[Math.floor(rand() * values.length)];

const createTableIfMissing = async (tableName: string): Promise<void> => {
  try {
    await infraClient.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
          { AttributeName: 'GSI2PK', AttributeType: 'S' },
          { AttributeName: 'GSI2SK', AttributeType: 'S' }
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' }
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' }
            ],
            Projection: { ProjectionType: 'ALL' }
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' }
            ],
            Projection: { ProjectionType: 'ALL' }
          }
        ]
      })
    );
    console.log(`Table created: ${tableName}`);
  } catch (error) {
    if (error instanceof ResourceInUseException) {
      return;
    }
    throw error;
  }
};

const waitTableActive = async (tableName: string): Promise<void> => {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const output = await infraClient.send(new DescribeTableCommand({ TableName: tableName }));
    if (output.Table?.TableStatus === 'ACTIVE') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Table not active: ${tableName}`);
};

const listAllItems = async (tableName: string): Promise<RawItem[]> => {
  const output: RawItem[] = [];
  let lastEvaluatedKey: RawItem | undefined;

  do {
    const response = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey
      })
    );
    output.push(...((response.Items ?? []) as RawItem[]));
    lastEvaluatedKey = response.LastEvaluatedKey as RawItem | undefined;
  } while (lastEvaluatedKey);

  return output;
};

const chunk = <T>(values: T[], size: number): T[][] => {
  const output: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    output.push(values.slice(i, i + size));
  }
  return output;
};

const deleteItems = async (tableName: string, keys: Array<{ PK: string; SK: string }>): Promise<void> => {
  for (const batch of chunk(keys, 25)) {
    const requestItems: Record<string, BatchWriteEntry[]> = {
      [tableName]: batch.map((key) => ({
        DeleteRequest: {
          Key: key
        }
      }))
    };
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: requestItems
      })
    );
  }
};

const isCustomerItem = (item: RawItem): boolean => {
  const pk = String(item.PK ?? '');
  return (
    pk.startsWith('TENANT#') ||
    pk.startsWith('USER#') ||
    pk.startsWith('USEREMAIL#') ||
    pk.startsWith('TENANTDOC#')
  );
};

const isSurveyItem = (item: RawItem): boolean => {
  const pk = String(item.PK ?? '');
  const sk = String(item.SK ?? '');
  return (
    pk.startsWith('SURVEY#') ||
    pk.startsWith('INTERVIEWERLOGIN#') ||
    (pk.startsWith('TENANT#') && (sk.startsWith('SURVEY#') || sk.startsWith('INTERVIEWER#')))
  );
};

const isCreditRequestItem = (item: RawItem): boolean => {
  const pk = String(item.PK ?? '');
  const sk = String(item.SK ?? '');
  return pk.startsWith('CREDIT_REQUEST#') || (pk.startsWith('TENANT#') && sk.startsWith('CREDIT_REQUEST#'));
};

const isFinanceItem = (item: RawItem): boolean => {
  const pk = String(item.PK ?? '');
  return pk.startsWith('FINANCE#');
};

const ensurePlanDefinitions = async (): Promise<void> => {
  const now = new Date().toISOString();
  const plans = [
    {
      code: 'START',
      name: 'Start',
      tier: 0,
      pricePerForm: 0,
      minForms: 0,
      maxSurveys: 5,
      maxQuestionsPerSurvey: 5,
      maxResponsesPerSurvey: 15,
      maxInterviewers: 1
    },
    {
      code: 'PERSONAL',
      name: 'Personal',
      tier: 1,
      pricePerForm: 1.5,
      minForms: 100,
      maxSurveys: 12,
      maxQuestionsPerSurvey: 15,
      maxResponsesPerSurvey: 500,
      maxInterviewers: 3
    },
    {
      code: 'PROFESSIONAL',
      name: 'Professional',
      tier: 2,
      pricePerForm: 1.2,
      minForms: 500,
      maxSurveys: 40,
      maxQuestionsPerSurvey: 25,
      maxResponsesPerSurvey: 2500,
      maxInterviewers: 15
    },
    {
      code: 'PREMIUM',
      name: 'Premium',
      tier: 3,
      pricePerForm: 0.99,
      minForms: 1200,
      maxSurveys: 200,
      maxQuestionsPerSurvey: 40,
      maxResponsesPerSurvey: 20000,
      maxInterviewers: 100
    }
  ] as const;

  for (const plan of plans) {
    const planId = `plan-${plan.code.toLowerCase()}`;
    const lockKey = {
      PK: `PLANDEF_CODE#INSIGHTS#${plan.code}`,
      SK: 'LOCK'
    };
    const lockOutput = await docClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: lockKey
      })
    );

    if (!lockOutput.Item) {
      await docClient.send(
        new PutCommand({
          TableName: plansTableName,
          Item: {
            ...lockKey,
            entityType: 'PLAN_DEFINITION_CODE_LOCK',
            planId,
            productCode: 'INSIGHTS',
            code: plan.code
          }
        })
      );
    }

    const existingPlan = await docClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: {
          PK: `PLANDEF#${planId}`,
          SK: 'PROFILE'
        }
      })
    );
    const createdAt = String(existingPlan.Item?.createdAt ?? now);

    await docClient.send(
      new PutCommand({
        TableName: plansTableName,
        Item: {
          PK: `PLANDEF#${planId}`,
          SK: 'PROFILE',
          GSI2PK: 'ENTITY#PLAN_DEFINITION',
          GSI2SK: `${createdAt}#${planId}`,
          entityType: 'PLAN_DEFINITION',
          id: planId,
          productCode: 'INSIGHTS',
          code: plan.code,
          name: plan.name,
          description: `${plan.name} plan`,
          tier: plan.tier,
          pricePerForm: plan.pricePerForm,
          minForms: plan.minForms,
          maxSurveys: plan.maxSurveys,
          maxQuestionsPerSurvey: plan.maxQuestionsPerSurvey,
          maxResponsesPerSurvey: plan.maxResponsesPerSurvey,
          maxInterviewers: plan.maxInterviewers,
          active: true,
          createdAt,
          updatedAt: now
        }
      })
    );
  }
};

const seedCustomer = async (): Promise<void> => {
  const now = new Date().toISOString();
  const password = hashPassword(target.password);

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: customersTableName,
            Item: {
              PK: `TENANTDOC#${target.document}`,
              SK: 'LOCK',
              entityType: 'TENANT_DOC_LOCK',
              tenantId: target.tenantId,
              document: target.document
            }
          }
        },
        {
          Put: {
            TableName: customersTableName,
            Item: {
              PK: `USEREMAIL#${target.email}`,
              SK: 'LOCK',
              entityType: 'USER_EMAIL_LOCK',
              userId: target.userId,
              tenantId: target.tenantId,
              email: target.email
            }
          }
        },
        {
          Put: {
            TableName: customersTableName,
            Item: {
              PK: `TENANT#${target.tenantId}`,
              SK: 'PROFILE',
              GSI2PK: 'ENTITY#TENANT',
              GSI2SK: `${now}#${target.tenantId}`,
              entityType: 'TENANT',
              id: target.tenantId,
              personType: 'PJ',
              document: target.document,
              legalName: target.legalName,
              tradeName: target.tradeName,
              email: target.email,
              phone: '11999990000',
              planCode: 'PREMIUM',
              questionnaireCreditsBalance: finalCreditsBalance,
              address: {
                cep: '01001000',
                state: 'SP',
                city: 'Sao Paulo',
                neighborhood: 'Centro',
                street: 'Praca da Se',
                number: '100',
                complement: ''
              },
              createdAt: now,
              updatedAt: now
            }
          }
        },
        {
          Put: {
            TableName: customersTableName,
            Item: {
              PK: `USER#${target.userId}`,
              SK: 'PROFILE',
              GSI2PK: `TENANT#${target.tenantId}#USER`,
              GSI2SK: `${now}#${target.userId}`,
              entityType: 'USER',
              id: target.userId,
              tenantId: target.tenantId,
              name: target.legalName,
              email: target.email,
              role: 'ROLE_CUSTOMER',
              passwordHash: password.hash,
              passwordSalt: password.salt,
              createdAt: now,
              updatedAt: now
            }
          }
        }
      ]
    })
  );
};

const seedCreditPurchase = async (): Promise<void> => {
  const requestedAt = new Date().toISOString();
  const requestId = 'req-ajpavaneli-premium-10k';
  const requestSk = `CREDIT_REQUEST#${requestedAt}#${requestId}`;
  const reviewedAt = new Date(Date.now() + 1000).toISOString();

  await docClient.send(
    new PutCommand({
      TableName: billingTableName,
      Item: {
        PK: `TENANT#${target.tenantId}`,
        SK: requestSk,
        GSI2PK: 'ENTITY#CREDIT_PURCHASE_REQUEST',
        GSI2SK: `APPROVED#${requestedAt}#${target.tenantId}#${requestId}`,
        entityType: 'CREDIT_PURCHASE_REQUEST',
        id: requestId,
        tenantId: target.tenantId,
        requesterUserId: target.userId,
        productCode: 'INSIGHTS',
        requestedPlanCode: 'PREMIUM',
        requestedCredits: creditsPurchased,
        requestedPricePerForm: 0.99,
        estimatedAmount: Number((creditsPurchased * 0.99).toFixed(2)),
        status: 'APPROVED',
        note: 'Seed local AJ Pavaneli',
        requestedAt,
        reviewedAt,
        reviewedBy: 'admin-root',
        reviewNote: 'Aprovado para mock local',
        appliedPlanCode: 'PREMIUM',
        appliedPlanName: 'Premium',
        appliedPlanTier: 3,
        resultingCreditsBalance: creditsPurchased,
        updatedAt: reviewedAt
      }
    })
  );

  await docClient.send(
    new PutCommand({
      TableName: billingTableName,
      Item: {
        PK: `CREDIT_REQUEST#${requestId}`,
        SK: 'LOCK',
        entityType: 'CREDIT_PURCHASE_REQUEST_LOCK',
        requestId,
        tenantId: target.tenantId,
        requestSk
      }
    })
  );
};

const seedFinanceData = async (): Promise<void> => {
  const now = new Date().toISOString();
  const month = now.slice(0, 7);

  await docClient.send(
    new PutCommand({
      TableName: financeTableName,
      Item: {
        PK: 'FINANCE#SUPPLIER#sup-ajp-cloud',
        SK: 'PROFILE',
        GSI2PK: 'ENTITY#FIN_SUPPLIER',
        GSI2SK: `${now}#sup-ajp-cloud`,
        entityType: 'FIN_SUPPLIER',
        id: 'sup-ajp-cloud',
        name: 'Infra Cloud AJP',
        category: 'Infraestrutura',
        email: 'financeiro@ajp.local',
        phone: '1130000000',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      }
    })
  );

  await docClient.send(
    new PutCommand({
      TableName: financeTableName,
      Item: {
        PK: `FINANCE#EXPENSE#exp-ajp-${month}`,
        SK: 'PROFILE',
        GSI2PK: 'ENTITY#FIN_EXPENSE',
        GSI2SK: `${month}-10#exp-ajp-${month}`,
        entityType: 'FIN_EXPENSE',
        id: `exp-ajp-${month}`,
        occurredOn: `${month}-10`,
        dueOn: `${month}-10`,
        description: 'Infraestrutura cloud mensal',
        type: 'FIXED',
        category: 'Infraestrutura',
        amount: 1990,
        status: 'OPEN',
        supplierId: 'sup-ajp-cloud',
        supplierName: 'Infra Cloud AJP',
        paymentMethod: 'PIX',
        notes: 'Seed local AJ Pavaneli',
        isForecast: false,
        competenceMonth: month,
        createdBy: 'seed-ajpavaneli',
        createdAt: now,
        updatedAt: now
      }
    })
  );
};

const buildInterviewers = (): Array<{ id: string; name: string; login: string; email: string }> => {
  const output: Array<{ id: string; name: string; login: string; email: string }> = [];
  for (let i = 1; i <= interviewersCount; i += 1) {
    const suffix = String(i).padStart(2, '0');
    output.push({
      id: `int-ajp-${suffix}`,
      name: `Entrevistador ${suffix}`,
      login: `entrevistador${suffix}@ajp.local`,
      email: `entrevistador${suffix}@ajp.local`
    });
  }
  return output;
};

const seedInterviewers = async (
  interviewers: Array<{ id: string; name: string; login: string; email: string }>
): Promise<void> => {
  for (const interviewer of interviewers) {
    const createdAt = new Date().toISOString();
    const password = hashPassword(target.password);

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: surveysTableName,
              Item: {
                PK: `INTERVIEWERLOGIN#${interviewer.login}`,
                SK: 'LOCK',
                entityType: 'INTERVIEWER_LOGIN_LOCK',
                tenantId: target.tenantId,
                interviewerId: interviewer.id,
                login: interviewer.login
              }
            }
          },
          {
            Put: {
              TableName: surveysTableName,
              Item: {
                PK: `TENANT#${target.tenantId}`,
                SK: `INTERVIEWER#${interviewer.id}`,
                GSI2PK: `TENANT#${target.tenantId}#INTERVIEWER`,
                GSI2SK: `${createdAt}#${interviewer.id}`,
                entityType: 'INTERVIEWER',
                id: interviewer.id,
                tenantId: target.tenantId,
                name: interviewer.name,
                login: interviewer.login,
                email: interviewer.email,
                status: 'active',
                passwordHash: password.hash,
                passwordSalt: password.salt,
                createdAt,
                updatedAt: createdAt
              }
            }
          }
        ]
      })
    );
  }
};

const buildWaves = (interviewers: Array<{ id: string }>): Array<{
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  interviewerAssignments: Array<{ interviewerId: string; maxForms: number }>;
}> => {
  const assignmentsPerWave = formsPerRound / interviewersCount;
  return [
    { id: 'rodada-1', name: 'Rodada 1', periodStart: '2026-03-01', periodEnd: '2026-03-15' },
    { id: 'rodada-2', name: 'Rodada 2', periodStart: '2026-04-01', periodEnd: '2026-04-15' },
    { id: 'rodada-3', name: 'Rodada 3', periodStart: '2026-05-01', periodEnd: '2026-05-15' },
    { id: 'rodada-4', name: 'Rodada 4', periodStart: '2026-06-01', periodEnd: '2026-06-15' }
  ].map((wave) => ({
    ...wave,
    interviewerAssignments: interviewers.map((interviewer) => ({
      interviewerId: interviewer.id,
      maxForms: assignmentsPerWave
    }))
  }));
};

const seedSurvey = async (
  surveyId: string,
  waves: Array<{
    id: string;
    name: string;
    periodStart: string;
    periodEnd: string;
    interviewerAssignments: Array<{ interviewerId: string; maxForms: number }>;
  }>
): Promise<void> => {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: surveysTableName,
      Item: {
        PK: `TENANT#${target.tenantId}`,
        SK: `SURVEY#${surveyId}`,
        GSI2PK: `TENANT#${target.tenantId}#SURVEY`,
        GSI2SK: `${now}#${surveyId}`,
        entityType: 'SURVEY',
        id: surveyId,
        tenantId: target.tenantId,
        ownerTenantId: target.tenantId,
        name: 'Pesquisa Eleitoral Presidente 2026 - Brasil',
        description: 'Pesquisa nacional com geolocalizacao simulada e candidatos atuais.',
        status: 'active',
        audience: 'B2C',
        questions: [
          {
            id: 'q1',
            order: 1,
            title: 'Se a eleicao para presidente fosse hoje, em quem voce votaria?',
            type: 'SINGLE_CHOICE',
            required: true,
            randomizeOptions: true,
            options: [
              { id: 'q1_lula', label: 'Lula' },
              { id: 'q1_tarcisio', label: 'Tarcisio de Freitas' },
              { id: 'q1_ratinho', label: 'Ratinho Junior' },
              { id: 'q1_zema', label: 'Romeu Zema' },
              { id: 'q1_caiado', label: 'Ronaldo Caiado' },
              { id: 'q1_branco', label: 'Branco/Nulo' },
              { id: 'q1_ns', label: 'Nao sabe' }
            ]
          },
          {
            id: 'q2',
            order: 2,
            title: 'Seu voto esta definido?',
            type: 'SINGLE_CHOICE',
            required: true,
            options: [
              { id: 'q2_sim', label: 'Sim' },
              { id: 'q2_pode_mudar', label: 'Pode mudar' },
              { id: 'q2_nao', label: 'Nao defini' }
            ]
          },
          {
            id: 'q3',
            order: 3,
            title: 'Qual tema pesa mais no seu voto?',
            type: 'SINGLE_CHOICE',
            required: true,
            conditions: {
              mode: 'ANY',
              rules: [
                { sourceQuestionId: 'q2', operator: 'equals', value: 'q2_sim' },
                { sourceQuestionId: 'q2', operator: 'equals', value: 'q2_pode_mudar' }
              ]
            },
            randomizeOptions: true,
            options: [
              { id: 'q3_economia', label: 'Economia e emprego' },
              { id: 'q3_saude', label: 'Saude' },
              { id: 'q3_seguranca', label: 'Seguranca publica' },
              { id: 'q3_educacao', label: 'Educacao' },
              { id: 'q3_corrupcao', label: 'Combate a corrupcao' }
            ]
          },
          {
            id: 'q4',
            order: 4,
            title: 'Faixa etaria',
            type: 'SINGLE_CHOICE',
            required: true,
            options: [
              { id: 'q4_16_24', label: '16 a 24' },
              { id: 'q4_25_34', label: '25 a 34' },
              { id: 'q4_35_44', label: '35 a 44' },
              { id: 'q4_45_59', label: '45 a 59' },
              { id: 'q4_60', label: '60+' }
            ]
          }
        ],
        quotaRules: [
          { id: 'quota_q4_16_24', name: 'Faixa 16-24', questionId: 'q4', optionId: 'q4_16_24', maxResponses: 2500 },
          { id: 'quota_q4_25_34', name: 'Faixa 25-34', questionId: 'q4', optionId: 'q4_25_34', maxResponses: 2500 },
          { id: 'quota_q4_35_44', name: 'Faixa 35-44', questionId: 'q4', optionId: 'q4_35_44', maxResponses: 2500 },
          { id: 'quota_q4_45_59', name: 'Faixa 45-59', questionId: 'q4', optionId: 'q4_45_59', maxResponses: 2500 },
          { id: 'quota_q4_60', name: 'Faixa 60+', questionId: 'q4', optionId: 'q4_60', maxResponses: 2500 }
        ],
        waves,
        locationCapture: {
          captureEnabled: true,
          required: true,
          precision: 'approx',
          city: 'Nacional',
          state: 'BR'
        },
        kioskSettings: {
          enabled: false
        },
        createdAt: now,
        updatedAt: now
      }
    })
  );
};

const seedResponses = async (
  surveyId: string,
  waves: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
  }>,
  interviewers: Array<{ id: string }>
): Promise<void> => {
  const rand = random(20260223);
  const formsPerInterviewerPerRound = formsPerRound / interviewersCount;

  const geos = [
    { state: 'SP', city: 'Sao Paulo', lat: -23.5505, lng: -46.6333 },
    { state: 'RJ', city: 'Rio de Janeiro', lat: -22.9068, lng: -43.1729 },
    { state: 'MG', city: 'Belo Horizonte', lat: -19.9167, lng: -43.9345 },
    { state: 'DF', city: 'Brasilia', lat: -15.7939, lng: -47.8828 },
    { state: 'BA', city: 'Salvador', lat: -12.9714, lng: -38.5014 },
    { state: 'PR', city: 'Curitiba', lat: -25.4284, lng: -49.2733 },
    { state: 'RS', city: 'Porto Alegre', lat: -30.0346, lng: -51.2177 },
    { state: 'PE', city: 'Recife', lat: -8.0476, lng: -34.877 },
    { state: 'CE', city: 'Fortaleza', lat: -3.7319, lng: -38.5267 },
    { state: 'PA', city: 'Belem', lat: -1.4558, lng: -48.5044 },
    { state: 'AM', city: 'Manaus', lat: -3.119, lng: -60.0217 },
    { state: 'GO', city: 'Goiania', lat: -16.6864, lng: -49.2643 },
    { state: 'SC', city: 'Florianopolis', lat: -27.5954, lng: -48.548 },
    { state: 'PB', city: 'Joao Pessoa', lat: -7.1195, lng: -34.845 },
    { state: 'MA', city: 'Sao Luis', lat: -2.53, lng: -44.3028 }
  ] as const;

  const answersQ1 = ['q1_lula', 'q1_tarcisio', 'q1_ratinho', 'q1_zema', 'q1_caiado', 'q1_branco', 'q1_ns'] as const;
  const answersQ2 = ['q2_sim', 'q2_pode_mudar', 'q2_nao'] as const;
  const answersQ3 = ['q3_economia', 'q3_saude', 'q3_seguranca', 'q3_educacao', 'q3_corrupcao'] as const;
  const answersQ4 = ['q4_16_24', 'q4_25_34', 'q4_35_44', 'q4_45_59', 'q4_60'] as const;

  const requests: BatchWriteEntry[] = [];

  for (const wave of waves) {
    const start = new Date(`${wave.periodStart}T00:00:00.000Z`).getTime();
    const end = new Date(`${wave.periodEnd}T23:59:59.000Z`).getTime();
    const windowMs = Math.max(end - start, 1);

    for (const interviewer of interviewers) {
      for (let i = 1; i <= formsPerInterviewerPerRound; i += 1) {
        const geo = pick(rand, geos);
        const offsetLat = (rand() - 0.5) * 0.5;
        const offsetLng = (rand() - 0.5) * 0.5;
        const submittedAt = new Date(start + Math.floor(rand() * windowMs)).toISOString();
        const responseId = `${wave.id}-${interviewer.id}-${String(i).padStart(3, '0')}`;
        const clientResponseId = responseId;

        const responseItem: RawItem = {
          PK: `SURVEY#${surveyId}`,
          SK: `RESPONSE#${submittedAt}#${responseId}`,
          GSI2PK: `TENANT#${target.tenantId}#SURVEY#RESPONSES`,
          GSI2SK: `${submittedAt}#${surveyId}#${responseId}`,
          entityType: 'SURVEY_RESPONSE',
          id: responseId,
          clientResponseId,
          surveyId,
          tenantId: target.tenantId,
          answers: {
            q1: pick(rand, answersQ1),
            q2: pick(rand, answersQ2),
            q3: pick(rand, answersQ3),
            q4: pick(rand, answersQ4)
          },
          metadata: {
            wave: wave.id,
            interviewerId: interviewer.id,
            deviceId: `device-${interviewer.id}`,
            state: geo.state,
            city: geo.city,
            location: {
              lat: Number((geo.lat + offsetLat).toFixed(6)),
              lng: Number((geo.lng + offsetLng).toFixed(6)),
              accuracyMeters: Math.floor(5 + rand() * 40)
            }
          },
          submittedAt
        };

        const lockItem: RawItem = {
          PK: `SURVEY#${surveyId}`,
          SK: `RESPONSE_LOCK#${clientResponseId}`,
          entityType: 'SURVEY_RESPONSE_LOCK',
          tenantId: target.tenantId,
          surveyId,
          clientResponseId,
          responsePk: `SURVEY#${surveyId}`,
          responseSk: `RESPONSE#${submittedAt}#${responseId}`,
          createdAt: submittedAt
        };

        requests.push({ PutRequest: { Item: responseItem } });
        requests.push({ PutRequest: { Item: lockItem } });
      }
    }
  }

  for (const batch of chunk(requests, 25)) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [surveysTableName]: batch
        }
      })
    );
  }
};

const seedAdvancedSurvey = async (
  surveyId: string,
  interviewers: Array<{ id: string }>
): Promise<
  Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    interviewerAssignments: Array<{ interviewerId: string; maxForms: number }>;
  }>
> => {
  const now = new Date().toISOString();
  const perInterviewer = advancedFormsExecuted / 2 / interviewers.length;
  const waves = [
    {
      id: 'onda-a',
      name: 'Onda A',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-10',
      interviewerAssignments: interviewers.map((it) => ({ interviewerId: it.id, maxForms: perInterviewer }))
    },
    {
      id: 'onda-b',
      name: 'Onda B',
      periodStart: '2026-07-11',
      periodEnd: '2026-07-20',
      interviewerAssignments: interviewers.map((it) => ({ interviewerId: it.id, maxForms: perInterviewer }))
    }
  ];

  await docClient.send(
    new PutCommand({
      TableName: surveysTableName,
      Item: {
        PK: `TENANT#${target.tenantId}`,
        SK: `SURVEY#${surveyId}`,
        GSI2PK: `TENANT#${target.tenantId}#SURVEY`,
        GSI2SK: `${now}#${surveyId}`,
        entityType: 'SURVEY',
        id: surveyId,
        tenantId: target.tenantId,
        ownerTenantId: target.tenantId,
        name: 'Pesquisa Omnibus 2026 - Completa',
        description: 'Mock completo com todos os recursos de formulario habilitados.',
        status: 'active',
        audience: 'Mixed',
        questions: [
          {
            id: 'q1',
            order: 1,
            title: 'Em poucas palavras, qual o maior problema do Brasil hoje?',
            type: 'OPEN_TEXT',
            required: false
          },
          {
            id: 'q2',
            order: 2,
            title: 'Aprovacao geral do governo federal',
            type: 'SINGLE_CHOICE',
            required: true,
            randomizeOptions: true,
            options: [
              { id: 'q2_otimo', label: 'Otimo/Bom' },
              { id: 'q2_regular', label: 'Regular' },
              { id: 'q2_ruim', label: 'Ruim/Pessimo' },
              { id: 'q2_ns', label: 'Nao sabe', fixed: true }
            ]
          },
          {
            id: 'q3',
            order: 3,
            title: 'Quais temas mais impactam seu voto? (multipla)',
            type: 'MULTI_CHOICE',
            required: true,
            randomizeOptions: true,
            options: [
              { id: 'q3_economia', label: 'Economia e emprego' },
              { id: 'q3_saude', label: 'Saude' },
              { id: 'q3_seguranca', label: 'Seguranca publica' },
              { id: 'q3_educacao', label: 'Educacao' },
              { id: 'q3_corrupcao', label: 'Combate a corrupcao' }
            ]
          },
          {
            id: 'q4',
            order: 4,
            title: 'Quais regioes voce acompanha mais no noticiario? (minimo 2)',
            type: 'MULTI_CHOICE_MIN',
            required: true,
            minSelections: 2,
            options: [
              { id: 'q4_norte', label: 'Norte' },
              { id: 'q4_nordeste', label: 'Nordeste' },
              { id: 'q4_centro', label: 'Centro-Oeste' },
              { id: 'q4_sudeste', label: 'Sudeste' },
              { id: 'q4_sul', label: 'Sul' }
            ]
          },
          {
            id: 'q5',
            order: 5,
            title: 'Se houver segundo turno Lula x Tarcisio, em quem votaria?',
            type: 'SINGLE_CHOICE',
            required: true,
            condition: {
              sourceQuestionId: 'q2',
              operator: 'equals',
              value: 'q2_ruim'
            },
            options: [
              { id: 'q5_lula', label: 'Lula' },
              { id: 'q5_tarcisio', label: 'Tarcisio de Freitas' },
              { id: 'q5_nulo', label: 'Branco/Nulo' }
            ]
          },
          {
            id: 'q6',
            order: 6,
            title: 'Explique o motivo principal da sua escolha.',
            type: 'OPEN_TEXT',
            required: false,
            conditions: {
              mode: 'ANY',
              rules: [
                { sourceQuestionId: 'q3', operator: 'includes', value: 'q3_economia' },
                { sourceQuestionId: 'q2', operator: 'equals', value: 'q2_ruim' }
              ]
            }
          }
        ],
        quotaRules: [
          {
            id: 'quota-q2-otimo',
            name: 'Aprovacao positiva',
            questionId: 'q2',
            optionId: 'q2_otimo',
            maxResponses: 220
          },
          {
            id: 'quota-q2-ruim',
            name: 'Aprovacao negativa',
            questionId: 'q2',
            optionId: 'q2_ruim',
            maxResponses: 220
          }
        ],
        waves,
        locationCapture: {
          captureEnabled: true,
          required: true,
          precision: 'exact',
          city: 'Nacional',
          state: 'BR'
        },
        kioskSettings: {
          enabled: true,
          requireConsent: true,
          consentText: 'Aceito participar desta pesquisa em modo totem, de forma anonima.',
          autoResetSeconds: 8
        },
        createdAt: now,
        updatedAt: now
      }
    })
  );

  return waves;
};

const seedAdvancedResponses = async (
  surveyId: string,
  waves: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    interviewerAssignments: Array<{ interviewerId: string; maxForms: number }>;
  }>,
  interviewers: Array<{ id: string }>
): Promise<void> => {
  const rand = random(20260801);
  const perInterviewerPerWave = advancedFormsExecuted / waves.length / interviewers.length;
  const requests: BatchWriteEntry[] = [];

  const geos = [
    { state: 'SP', city: 'Sao Paulo', lat: -23.5505, lng: -46.6333 },
    { state: 'RJ', city: 'Rio de Janeiro', lat: -22.9068, lng: -43.1729 },
    { state: 'BA', city: 'Salvador', lat: -12.9714, lng: -38.5014 },
    { state: 'RS', city: 'Porto Alegre', lat: -30.0346, lng: -51.2177 },
    { state: 'DF', city: 'Brasilia', lat: -15.7939, lng: -47.8828 }
  ] as const;

  const q2Values = ['q2_otimo', 'q2_regular', 'q2_ruim', 'q2_ns'] as const;
  const q3Values = ['q3_economia', 'q3_saude', 'q3_seguranca', 'q3_educacao', 'q3_corrupcao'] as const;
  const q4Values = ['q4_norte', 'q4_nordeste', 'q4_centro', 'q4_sudeste', 'q4_sul'] as const;

  for (const wave of waves) {
    const start = new Date(`${wave.periodStart}T00:00:00.000Z`).getTime();
    const end = new Date(`${wave.periodEnd}T23:59:59.000Z`).getTime();
    const windowMs = Math.max(end - start, 1);

    for (const interviewer of interviewers) {
      for (let i = 1; i <= perInterviewerPerWave; i += 1) {
        const geo = pick(rand, geos);
        const submittedAt = new Date(start + Math.floor(rand() * windowMs)).toISOString();
        const responseId = `${wave.id}-${interviewer.id}-${String(i).padStart(3, '0')}`;
        const q2 = pick(rand, q2Values);
        const q3a = pick(rand, q3Values);
        const q3b = pick(rand, q3Values);
        const q4a = pick(rand, q4Values);
        const q4b = pick(rand, q4Values);

        const answers: Record<string, unknown> = {
          q1: 'Custo de vida e renda',
          q2,
          q3: q3a === q3b ? [q3a] : [q3a, q3b],
          q4: q4a === q4b ? [q4a, 'q4_sudeste'] : [q4a, q4b]
        };
        if (q2 === 'q2_ruim') {
          answers.q5 = pick(rand, ['q5_lula', 'q5_tarcisio', 'q5_nulo'] as const);
        }
        if ((answers.q3 as string[]).includes('q3_economia') || q2 === 'q2_ruim') {
          answers.q6 = 'Busca por estabilidade economica e emprego';
        }

        const responseItem: RawItem = {
          PK: `SURVEY#${surveyId}`,
          SK: `RESPONSE#${submittedAt}#${responseId}`,
          GSI2PK: `TENANT#${target.tenantId}#SURVEY#RESPONSES`,
          GSI2SK: `${submittedAt}#${surveyId}#${responseId}`,
          entityType: 'SURVEY_RESPONSE',
          id: responseId,
          clientResponseId: responseId,
          surveyId,
          tenantId: target.tenantId,
          answers,
          metadata: {
            wave: wave.id,
            interviewerId: interviewer.id,
            deviceId: `device-adv-${interviewer.id}`,
            state: geo.state,
            city: geo.city,
            location: {
              lat: Number((geo.lat + (rand() - 0.5) * 0.1).toFixed(6)),
              lng: Number((geo.lng + (rand() - 0.5) * 0.1).toFixed(6)),
              accuracyMeters: Math.floor(3 + rand() * 20)
            }
          },
          submittedAt
        };

        const lockItem: RawItem = {
          PK: `SURVEY#${surveyId}`,
          SK: `RESPONSE_LOCK#${responseId}`,
          entityType: 'SURVEY_RESPONSE_LOCK',
          tenantId: target.tenantId,
          surveyId,
          clientResponseId: responseId,
          responsePk: `SURVEY#${surveyId}`,
          responseSk: `RESPONSE#${submittedAt}#${responseId}`,
          createdAt: submittedAt
        };

        requests.push({ PutRequest: { Item: responseItem } });
        requests.push({ PutRequest: { Item: lockItem } });
      }
    }
  }

  for (const batch of chunk(requests, 25)) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [surveysTableName]: batch
        }
      })
    );
  }
};

const cleanupTable = async (
  tableName: string,
  predicate: (item: RawItem) => boolean,
  label: string
): Promise<void> => {
  const items = await listAllItems(tableName);
  const keys = items
    .filter(predicate)
    .map((item) => ({
      PK: String(item.PK ?? ''),
      SK: String(item.SK ?? '')
    }))
    .filter((key) => key.PK && key.SK);

  if (!keys.length) {
    console.log(`Cleanup ${label}: no records to delete.`);
    return;
  }

  await deleteItems(tableName, keys);
  console.log(`Cleanup ${label}: deleted ${keys.length} records.`);
};

const run = async (): Promise<void> => {
  const uniqueTables = new Set([customersTableName, surveysTableName, billingTableName, plansTableName, financeTableName]);

  if (uniqueTables.size === 0) {
    throw new Error('No DynamoDB tables configured.');
  }

  for (const tableName of uniqueTables) {
    await createTableIfMissing(tableName);
    await waitTableActive(tableName);
  }

  await cleanupTable(customersTableName, isCustomerItem, 'customers');
  await cleanupTable(surveysTableName, isSurveyItem, 'surveys');
  await cleanupTable(billingTableName, isCreditRequestItem, 'billing credit requests');
  await cleanupTable(financeTableName, isFinanceItem, 'finance');
  await ensurePlanDefinitions();
  await seedCustomer();
  await seedCreditPurchase();
  await seedFinanceData();

  const interviewers = buildInterviewers();
  await seedInterviewers(interviewers);

  const surveyId = 'sv-presidente-2026-brasil';
  const waves = buildWaves(interviewers);
  await seedSurvey(surveyId, waves);
  await seedResponses(
    surveyId,
    waves.map((wave) => ({
      id: wave.id,
      periodStart: wave.periodStart,
      periodEnd: wave.periodEnd
    })),
    interviewers.map((interviewer) => ({ id: interviewer.id }))
  );

  const advancedSurveyId = 'sv-omnibus-2026-completa';
  const advancedWaves = await seedAdvancedSurvey(advancedSurveyId, interviewers.map((interviewer) => ({ id: interviewer.id })));
  await seedAdvancedResponses(
    advancedSurveyId,
    advancedWaves,
    interviewers.map((interviewer) => ({ id: interviewer.id }))
  );

  console.log('Local mock created successfully.');
  console.log(`Customer login: ${target.email} / ${target.password}`);
  console.log(`Interviewer password: ${target.password} (${interviewers.length} interviewers)`);
  console.log(`Survey: ${surveyId}`);
  console.log(`Rounds: ${roundsCount} x ${formsPerRound} = ${formsExecuted} forms executed`);
  console.log(`Advanced survey: ${advancedSurveyId} (${advancedFormsExecuted} forms executed)`);
  console.log(`Credits purchased: ${creditsPurchased}, final balance: ${finalCreditsBalance}`);
};

void run().catch((error) => {
  console.error('Failed to seed AJ Pavaneli mock', error);
  process.exitCode = 1;
});

