import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { hashPassword } from '../../src/infrastructure/security/password-hasher';
import { normalizeDigits, normalizeEmail } from '../../src/infrastructure/persistence/dynamodb/keys';

export interface LocalBootstrapOptions {
  seedCustomer?: boolean;
}

const region = process.env.AWS_REGION ?? 'us-east-1';
const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
export const tableName = process.env.DYNAMODB_TABLE_NAME ?? 'insights-local';

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local'
  }
});

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true
  }
});

const createTable = async (): Promise<void> => {
  try {
    await client.send(
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
      console.log(`Table already exists: ${tableName}`);
      return;
    }

    throw error;
  }
};

const waitUntilActive = async (): Promise<void> => {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const output = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const status = output.Table?.TableStatus;

    if (status === 'ACTIVE') {
      console.log(`Table status: ACTIVE (${tableName})`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Table did not become ACTIVE in time: ${tableName}`);
};

const seededRandom = (seedValue: number): (() => number) => {
  let seed = seedValue >>> 0;
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
};

const weightedPick = (rand: () => number, weighted: Array<[string, number]>): string => {
  const roll = rand();
  let current = 0;
  for (const [value, weight] of weighted) {
    current += weight;
    if (roll <= current) {
      return value;
    }
  }
  return weighted[weighted.length - 1][0];
};

const seedDefaultCustomer = async (): Promise<void> => {
  const tenantId = process.env.DEFAULT_SEED_TENANT_ID ?? 'tenant-ativaconnect-demo';
  const userId = process.env.DEFAULT_SEED_USER_ID ?? 'user-ativaconnect-demo';
  const legalName = process.env.DEFAULT_SEED_LEGAL_NAME ?? 'Ativa Connect Pesquisa de Mercado LTDA';
  const tradeName = process.env.DEFAULT_SEED_TRADE_NAME ?? 'Ativa Connect';
  const personType = (process.env.DEFAULT_SEED_PERSON_TYPE as 'PF' | 'PJ' | undefined) ?? 'PJ';
  const rawDocument = process.env.DEFAULT_SEED_DOCUMENT ?? '11222333000181';
  const rawEmail = process.env.DEFAULT_SEED_EMAIL ?? 'usuario@ativaconnect.com.br';
  const rawPassword = process.env.DEFAULT_SEED_PASSWORD ?? 'admin123';
  const now = new Date().toISOString();

  const document = normalizeDigits(rawDocument);
  const email = normalizeEmail(rawEmail);

  const tenantKey = {
    PK: `TENANT#${tenantId}`,
    SK: 'PROFILE'
  };

  const existing = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: tenantKey
    })
  );

  if (existing.Item) {
    console.log(`Seed customer already exists: ${tenantId}`);
    return;
  }

  const password = hashPassword(rawPassword);

  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: `TENANTDOC#${document}`,
                SK: 'LOCK',
                entityType: 'TENANT_DOC_LOCK',
                tenantId,
                document
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: `USEREMAIL#${email}`,
                SK: 'LOCK',
                entityType: 'USER_EMAIL_LOCK',
                userId,
                tenantId,
                email
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                ...tenantKey,
                GSI2PK: 'ENTITY#TENANT',
                GSI2SK: `${now}#${tenantId}`,
                entityType: 'TENANT',
                id: tenantId,
                personType,
                document,
                legalName,
                tradeName,
                email,
                phone: process.env.DEFAULT_SEED_PHONE ?? '11999999999',
                planCode: 'START',
                address: {
                  cep: process.env.DEFAULT_SEED_CEP ?? '01001000',
                  state: process.env.DEFAULT_SEED_STATE ?? 'SP',
                  city: process.env.DEFAULT_SEED_CITY ?? 'Sao Paulo',
                  neighborhood: process.env.DEFAULT_SEED_NEIGHBORHOOD ?? 'Centro',
                  street: process.env.DEFAULT_SEED_STREET ?? 'Praca da Se',
                  number: process.env.DEFAULT_SEED_NUMBER ?? '100',
                  complement: process.env.DEFAULT_SEED_COMPLEMENT ?? ''
                },
                createdAt: now,
                updatedAt: now
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: `USER#${userId}`,
                SK: 'PROFILE',
                GSI2PK: `TENANT#${tenantId}#USER`,
                GSI2SK: `${now}#${userId}`,
                entityType: 'USER',
                id: userId,
                tenantId,
                name: legalName,
                email,
                role: 'ROLE_CUSTOMER',
                passwordHash: password.hash,
                passwordSalt: password.salt,
                createdAt: now,
                updatedAt: now
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          }
        ]
      })
    );
  } catch (error: any) {
    if (error?.name !== 'TransactionCanceledException') {
      throw error;
    }

    console.log(`Seed customer already locked/exists: ${email}`);
    return;
  }

  console.log(`Seed customer created: ${email} / ${rawPassword}`);
};

const buildElectoralSurvey = (tenantId: string, surveyId: string, now: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `SURVEY#${surveyId}`,
  GSI2PK: `TENANT#${tenantId}#SURVEY`,
  GSI2SK: `${now}#${surveyId}`,
  entityType: 'SURVEY',
  id: surveyId,
  tenantId,
  ownerTenantId: tenantId,
  name: 'Pleito Eleitoral 2026 - Completa',
  description:
    'Instrumento de intencao de voto com bloco espontaneo, estimulado, rejeicao, segundo turno e perfil.',
  status: 'active',
  questions: [
    { id: 'q1', order: 1, title: 'Voto espontaneo presidente', type: 'OPEN_TEXT', required: false },
    {
      id: 'q2',
      order: 2,
      title: 'Voto estimulado presidente (1 turno)',
      type: 'SINGLE_CHOICE',
      required: true,
      randomizeOptions: true,
      options: [
        { id: 'q2_lula', label: 'Lula' },
        { id: 'q2_tarcisio', label: 'Tarcisio de Freitas' },
        { id: 'q2_ratinho', label: 'Ratinho Junior' },
        { id: 'q2_zema', label: 'Romeu Zema' },
        { id: 'q2_outro', label: 'Outro' },
        { id: 'q2_branco', label: 'Branco/Nulo' },
        { id: 'q2_ns', label: 'Nao sabe' }
      ]
    },
    {
      id: 'q3',
      order: 3,
      title: 'Segundo turno presidente (Lula x Tarcisio)',
      type: 'SINGLE_CHOICE',
      required: true,
      options: [
        { id: 'q3_lula', label: 'Lula' },
        { id: 'q3_tarcisio', label: 'Tarcisio' },
        { id: 'q3_branco', label: 'Branco/Nulo' },
        { id: 'q3_ns', label: 'Nao sabe' }
      ]
    },
    { id: 'q4', order: 4, title: 'Voto espontaneo governador SP', type: 'OPEN_TEXT', required: false },
    {
      id: 'q5',
      order: 5,
      title: 'Voto estimulado governador SP (1 turno)',
      type: 'SINGLE_CHOICE',
      required: true,
      randomizeOptions: true,
      options: [
        { id: 'q5_tarcisio', label: 'Tarcisio de Freitas' },
        { id: 'q5_haddad', label: 'Fernando Haddad' },
        { id: 'q5_nunes', label: 'Ricardo Nunes' },
        { id: 'q5_tabata', label: 'Tabata Amaral' },
        { id: 'q5_branco', label: 'Branco/Nulo' },
        { id: 'q5_ns', label: 'Nao sabe' }
      ]
    },
    {
      id: 'q6',
      order: 6,
      title: 'Rejeicao presidente (multipla)',
      type: 'MULTI_CHOICE',
      required: false,
      randomizeOptions: true,
      options: [
        { id: 'q6_lula', label: 'Lula' },
        { id: 'q6_tarcisio', label: 'Tarcisio' },
        { id: 'q6_ratinho', label: 'Ratinho Junior' },
        { id: 'q6_zema', label: 'Zema' },
        { id: 'q6_nenhum', label: 'Nao rejeita nenhum' }
      ]
    },
    {
      id: 'q7',
      order: 7,
      title: 'Tema prioritario para o voto',
      type: 'SINGLE_CHOICE',
      required: true,
      randomizeOptions: true,
      options: [
        { id: 'q7_economia', label: 'Economia e emprego' },
        { id: 'q7_saude', label: 'Saude' },
        { id: 'q7_seguranca', label: 'Seguranca publica' },
        { id: 'q7_corrupcao', label: 'Combate a corrupcao' },
        { id: 'q7_educacao', label: 'Educacao' }
      ]
    },
    {
      id: 'q8',
      order: 8,
      title: 'Seu voto para presidente esta definido?',
      type: 'SINGLE_CHOICE',
      required: true,
      options: [
        { id: 'q8_firme', label: 'Sim, totalmente definido' },
        { id: 'q8_pode', label: 'Pode mudar' },
        { id: 'q8_nao', label: 'Ainda nao defini' }
      ]
    }
  ],
  locationCapture: {
    captureEnabled: false
  },
  createdAt: now,
  updatedAt: now
});

const buildGovernorSaoPauloSurvey = (tenantId: string, surveyId: string, now: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `SURVEY#${surveyId}`,
  GSI2PK: `TENANT#${tenantId}#SURVEY`,
  GSI2SK: `${now}#${surveyId}`,
  entityType: 'SURVEY',
  id: surveyId,
  tenantId,
  ownerTenantId: tenantId,
  name: 'Eleicao Governador SP 2026 - Cidade de Sao Paulo',
  description: 'Pesquisa configurada para cidade de Sao Paulo com geolocalizacao habilitada e 2000 formularios.',
  status: 'active',
  audience: 'B2C',
  questions: [
    {
      id: 'q1',
      order: 1,
      title: 'Se a eleicao para governador de SP fosse hoje, em quem voce votaria?',
      type: 'SINGLE_CHOICE',
      required: true,
      randomizeOptions: true,
      options: [
        { id: 'q1_cand_a', label: 'Candidato A' },
        { id: 'q1_cand_b', label: 'Candidato B' },
        { id: 'q1_cand_c', label: 'Candidato C' },
        { id: 'q1_branco', label: 'Branco/Nulo' },
        { id: 'q1_ns', label: 'Nao sabe' }
      ]
    },
    {
      id: 'q2',
      order: 2,
      title: 'Seu voto ja esta totalmente decidido?',
      type: 'SINGLE_CHOICE',
      required: true,
      options: [
        { id: 'q2_sim', label: 'Sim' },
        { id: 'q2_pode_mudar', label: 'Pode mudar' },
        { id: 'q2_nao', label: 'Nao decidiu' }
      ]
    }
  ],
  locationCapture: {
    captureEnabled: true,
    required: true,
    precision: 'approx',
    city: 'Sao Paulo',
    state: 'SP'
  },
  createdAt: now,
  updatedAt: now
});

const seedSurveyResponses = async (tenantId: string): Promise<void> => {
  const surveyId = process.env.DEFAULT_SEED_SURVEY_ID ?? 'sv-eleitoral-2026-completo';
  const surveyNow = new Date().toISOString();

  const surveyKey = {
    PK: `TENANT#${tenantId}`,
    SK: `SURVEY#${surveyId}`
  };

  const existingSurvey = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: surveyKey
    })
  );

  if (!existingSurvey.Item) {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: buildElectoralSurvey(tenantId, surveyId, surveyNow),
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      })
    );
    console.log(`Seed survey created: ${surveyId}`);
  }

  const hasResponses = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SURVEY#${surveyId}`,
        ':sk': 'RESPONSE#'
      },
      Limit: 1
    })
  );

  if ((hasResponses.Items ?? []).length > 0) {
    console.log(`Seed responses already exist for survey: ${surveyId}`);
    return;
  }

  const totalPerWave = 1000;
  const states = ['SP', 'RJ', 'MG', 'PR', 'BA'];
  const cities: Record<string, string[]> = {
    SP: ['Sao Paulo', 'Campinas', 'Santos'],
    RJ: ['Rio de Janeiro', 'Niteroi'],
    MG: ['Belo Horizonte', 'Uberlandia'],
    PR: ['Curitiba', 'Londrina'],
    BA: ['Salvador', 'Feira de Santana']
  };

  const createWave = async (wave: 'R1' | 'R2', seedBase: number): Promise<void> => {
    const rand = seededRandom(seedBase);
    for (let i = 0; i < totalPerWave; i += 1) {
      const state = states[Math.floor(rand() * states.length)];
      const cityPool = cities[state];
      const city = cityPool[Math.floor(rand() * cityPool.length)];
      const responseId = `${wave}-${String(i + 1).padStart(4, '0')}`;
      const submittedAt = new Date(
        Date.now() - Math.floor(rand() * 1000 * 60 * 60 * 24 * 45)
      ).toISOString();

      const president = weightedPick(rand, wave === 'R1'
        ? [
            ['q2_lula', 0.34],
            ['q2_tarcisio', 0.24],
            ['q2_ratinho', 0.11],
            ['q2_zema', 0.08],
            ['q2_outro', 0.05],
            ['q2_branco', 0.07],
            ['q2_ns', 0.11]
          ]
        : [
            ['q2_lula', 0.32],
            ['q2_tarcisio', 0.27],
            ['q2_ratinho', 0.1],
            ['q2_zema', 0.09],
            ['q2_outro', 0.05],
            ['q2_branco', 0.07],
            ['q2_ns', 0.1]
          ]);

      const governor = weightedPick(rand, wave === 'R1'
        ? [
            ['q5_tarcisio', 0.39],
            ['q5_haddad', 0.29],
            ['q5_nunes', 0.12],
            ['q5_tabata', 0.08],
            ['q5_branco', 0.05],
            ['q5_ns', 0.07]
          ]
        : [
            ['q5_tarcisio', 0.36],
            ['q5_haddad', 0.32],
            ['q5_nunes', 0.11],
            ['q5_tabata', 0.08],
            ['q5_branco', 0.05],
            ['q5_ns', 0.08]
          ]);

      const responseItem = {
        PK: `SURVEY#${surveyId}`,
        SK: `RESPONSE#${submittedAt}#${responseId}`,
        GSI2PK: `TENANT#${tenantId}#SURVEY#RESPONSES`,
        GSI2SK: `${submittedAt}#${surveyId}#${responseId}`,
        entityType: 'SURVEY_RESPONSE',
        id: responseId,
        clientResponseId: responseId,
        surveyId,
        tenantId,
        answers: {
          q1: president === 'q2_lula' ? 'Lula' : president === 'q2_tarcisio' ? 'Tarcisio' : 'Outro',
          q2: president,
          q3: weightedPick(rand, [
            ['q3_lula', wave === 'R1' ? 0.46 : 0.43],
            ['q3_tarcisio', wave === 'R1' ? 0.37 : 0.4],
            ['q3_branco', 0.08],
            ['q3_ns', 0.09]
          ]),
          q4: governor === 'q5_haddad' ? 'Haddad' : governor === 'q5_tarcisio' ? 'Tarcisio' : 'Outro',
          q5: governor,
          q6: rand() > 0.5 ? ['q6_lula'] : ['q6_tarcisio'],
          q7: weightedPick(rand, [
            ['q7_economia', 0.31],
            ['q7_saude', 0.16],
            ['q7_seguranca', 0.22],
            ['q7_corrupcao', 0.19],
            ['q7_educacao', 0.12]
          ]),
          q8: weightedPick(rand, [
            ['q8_firme', wave === 'R1' ? 0.53 : 0.57],
            ['q8_pode', wave === 'R1' ? 0.3 : 0.28],
            ['q8_nao', wave === 'R1' ? 0.17 : 0.15]
          ])
        },
        metadata: {
          wave,
          interviewerId: `int-${Math.floor(rand() * 25) + 1}`,
          deviceId: `device-${Math.floor(rand() * 80) + 1}`,
          state,
          city
        },
        submittedAt
      };

      const lockItem = {
        PK: `SURVEY#${surveyId}`,
        SK: `RESPONSE_LOCK#${responseId}`,
        entityType: 'SURVEY_RESPONSE_LOCK',
        tenantId,
        surveyId,
        clientResponseId: responseId,
        responsePk: `SURVEY#${surveyId}`,
        responseSk: `RESPONSE#${submittedAt}#${responseId}`,
        createdAt: submittedAt
      };

      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: lockItem,
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
              }
            },
            {
              Put: {
                TableName: tableName,
                Item: responseItem,
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
              }
            }
          ]
        })
      );
    }
  };

  await createWave('R1', 20260601);
  await createWave('R2', 20260701);
  console.log(`Seed responses created: ${surveyId} (2000 respostas em 2 ondas)`);
};

const seedPlanDefinitions = async (): Promise<void> => {
  const plans = [
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

  let createdCount = 0;
  let updatedCount = 0;
  for (const plan of plans) {
    const productCode = 'INSIGHTS';
    const code = plan.code.toUpperCase();
    const lockKey = { PK: `PLANDEF_CODE#${productCode}#${code}`, SK: 'LOCK' };
    const planId = `plan-${code.toLowerCase()}`;

    const existing = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: lockKey
      })
    );
    const legacyExisting = !existing.Item
      ? await docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: `PLANDEF_CODE#${code}`, SK: 'LOCK' }
          })
        )
      : undefined;

    const now = new Date().toISOString();

    if (!existing.Item && !legacyExisting?.Item) {
      try {
        await docClient.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tableName,
                  Item: {
                    ...lockKey,
                    entityType: 'PLAN_DEFINITION_CODE_LOCK',
                    planId,
                    productCode,
                    code
                  },
                  ConditionExpression: 'attribute_not_exists(PK)'
                }
              },
              {
                Put: {
                  TableName: tableName,
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
                  ConditionExpression: 'attribute_not_exists(PK)'
                }
              }
            ]
          })
        );
        createdCount += 1;
      } catch (error: any) {
        if (error?.name !== 'TransactionCanceledException') {
          throw error;
        }
      }
      continue;
    }

    const existingPlanId = String((existing.Item ?? legacyExisting?.Item)?.planId ?? planId);
    const planOutput = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `PLANDEF#${existingPlanId}`,
          SK: 'PROFILE'
        }
      })
    );
    const current = planOutput.Item as { createdAt?: string } | undefined;
    if (!current) {
      continue;
    }

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `PLANDEF#${existingPlanId}`,
          SK: 'PROFILE',
          GSI2PK: 'ENTITY#PLAN_DEFINITION',
          GSI2SK: `${current.createdAt ?? now}#${existingPlanId}`,
          entityType: 'PLAN_DEFINITION',
          id: existingPlanId,
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
          createdAt: current.createdAt ?? now,
          updatedAt: now
        }
      })
    );
    updatedCount += 1;
  }

  if (createdCount > 0 || updatedCount > 0) {
    console.log(`Seed plan definitions created: ${createdCount}, updated: ${updatedCount}`);
  } else {
    console.log('Seed plan definitions already exist.');
  }
};

const seedGovernorSurveyResponses = async (tenantId: string): Promise<void> => {
  const surveyId = process.env.DEFAULT_SEED_GOV_SURVEY_ID ?? 'sv-governador-sp-2026';
  const surveyNow = new Date().toISOString();

  const surveyKey = {
    PK: `TENANT#${tenantId}`,
    SK: `SURVEY#${surveyId}`
  };

  const existingSurvey = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: surveyKey
    })
  );

  if (!existingSurvey.Item) {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: buildGovernorSaoPauloSurvey(tenantId, surveyId, surveyNow),
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      })
    );
    console.log(`Seed governor survey created: ${surveyId}`);
  }

  const hasResponses = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SURVEY#${surveyId}`,
        ':sk': 'RESPONSE#'
      },
      Limit: 1
    })
  );

  if ((hasResponses.Items ?? []).length > 0) {
    console.log(`Seed governor responses already exist for survey: ${surveyId}`);
    return;
  }

  const neighborhoods = [
    { name: 'Centro', lat: -23.55052, lng: -46.633308 },
    { name: 'Paulista', lat: -23.561684, lng: -46.655981 },
    { name: 'Pinheiros', lat: -23.566228, lng: -46.701604 },
    { name: 'Vila Mariana', lat: -23.589156, lng: -46.634246 },
    { name: 'Santana', lat: -23.503338, lng: -46.625897 },
    { name: 'Itaquera', lat: -23.54091, lng: -46.472898 },
    { name: 'Santo Amaro', lat: -23.652144, lng: -46.710035 },
    { name: 'Lapa', lat: -23.527815, lng: -46.705284 }
  ];

  const rand = seededRandom(20261001);
  const total = 2000;

  for (let i = 0; i < total; i += 1) {
    const block = neighborhoods[Math.floor(rand() * neighborhoods.length)];
    const lat = block.lat + (rand() - 0.5) * 0.02;
    const lng = block.lng + (rand() - 0.5) * 0.02;
    const responseId = `GOVSP-${String(i + 1).padStart(4, '0')}`;
    const submittedAt = new Date(Date.now() - Math.floor(rand() * 1000 * 60 * 60 * 24 * 30)).toISOString();

    const vote = weightedPick(rand, [
      ['q1_cand_a', 0.34],
      ['q1_cand_b', 0.29],
      ['q1_cand_c', 0.16],
      ['q1_branco', 0.07],
      ['q1_ns', 0.14]
    ]);

    const responseItem = {
      PK: `SURVEY#${surveyId}`,
      SK: `RESPONSE#${submittedAt}#${responseId}`,
      GSI2PK: `TENANT#${tenantId}#SURVEY#RESPONSES`,
      GSI2SK: `${submittedAt}#${surveyId}#${responseId}`,
      entityType: 'SURVEY_RESPONSE',
      id: responseId,
      clientResponseId: responseId,
      surveyId,
      tenantId,
      answers: {
        q1: vote,
        q2: weightedPick(rand, [
          ['q2_sim', 0.53],
          ['q2_pode_mudar', 0.31],
          ['q2_nao', 0.16]
        ])
      },
      metadata: {
        wave: 'UNICA_2026',
        city: 'Sao Paulo',
        state: 'SP',
        neighborhood: block.name,
        interviewerId: `int-${Math.floor(rand() * 40) + 1}`,
        deviceId: `tablet-${Math.floor(rand() * 120) + 1}`,
        location: {
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          accuracyMeters: Math.floor(5 + rand() * 35)
        }
      },
      submittedAt
    };

    const lockItem = {
      PK: `SURVEY#${surveyId}`,
      SK: `RESPONSE_LOCK#${responseId}`,
      entityType: 'SURVEY_RESPONSE_LOCK',
      tenantId,
      surveyId,
      clientResponseId: responseId,
      responsePk: `SURVEY#${surveyId}`,
      responseSk: `RESPONSE#${submittedAt}#${responseId}`,
      createdAt: submittedAt
    };

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: lockItem,
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          },
          {
            Put: {
              TableName: tableName,
              Item: responseItem,
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          }
        ]
      })
    );
  }

  console.log(`Seed governor survey responses created: ${surveyId} (2000 respostas com localizacao)`);
};

const seedFinancialData = async (): Promise<void> => {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const suppliers = [
    {
      id: 'sup-hosting',
      name: 'CloudHost Infra LTDA',
      document: '19111222000140',
      category: 'Infraestrutura',
      email: 'financeiro@cloudhost.com',
      phone: '1130001000',
      status: 'ACTIVE'
    },
    {
      id: 'sup-marketing',
      name: 'Mkt Growth Midia Digital',
      document: '22333444000177',
      category: 'Marketing',
      email: 'contato@mktgrowth.com',
      phone: '1140002200',
      status: 'ACTIVE'
    },
    {
      id: 'sup-accounting',
      name: 'Contab Prime Assessoria',
      document: '30111222000189',
      category: 'Contabilidade',
      email: 'suporte@contabprime.com',
      phone: '1141003300',
      status: 'ACTIVE'
    },
    {
      id: 'sup-office',
      name: 'Office Center Coworking',
      document: '28999111000109',
      category: 'Operacional',
      email: 'faturas@officecenter.com',
      phone: '1132221100',
      status: 'ACTIVE'
    },
    {
      id: 'sup-legal',
      name: 'Jurix Consultoria Juridica',
      document: '15777888000143',
      category: 'Juridico',
      email: 'juridico@jurix.com',
      phone: '1138889900',
      status: 'INACTIVE'
    }
  ] as const;

  for (const supplier of suppliers) {
    const existing = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `FINANCE#SUPPLIER#${supplier.id}`,
          SK: 'PROFILE'
        }
      })
    );
    if (existing.Item) continue;
    const createdAt = new Date().toISOString();
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `FINANCE#SUPPLIER#${supplier.id}`,
          SK: 'PROFILE',
          GSI2PK: 'ENTITY#FIN_SUPPLIER',
          GSI2SK: `${createdAt}#${supplier.id}`,
          entityType: 'FIN_SUPPLIER',
          ...supplier,
          createdAt,
          updatedAt: createdAt
        }
      })
    );
  }

  const expenses = [
    {
      id: `exp-${prevMonth}-hosting`,
      occurredOn: `${prevMonth}-05`,
      dueOn: `${prevMonth}-05`,
      description: 'Infra cloud mensal',
      type: 'FIXED',
      category: 'Infraestrutura',
      amount: 3200,
      status: 'PAID',
      supplierId: 'sup-hosting',
      supplierName: 'CloudHost Infra LTDA',
      paymentMethod: 'TRANSFER',
      isForecast: false
    },
    {
      id: `exp-${prevMonth}-contab`,
      occurredOn: `${prevMonth}-10`,
      dueOn: `${prevMonth}-10`,
      description: 'Honorarios contabeis',
      type: 'FIXED',
      category: 'Contabilidade',
      amount: 1450,
      status: 'PAID',
      supplierId: 'sup-accounting',
      supplierName: 'Contab Prime Assessoria',
      paymentMethod: 'PIX',
      isForecast: false
    },
    {
      id: `exp-${thisMonth}-hosting`,
      occurredOn: `${thisMonth}-05`,
      dueOn: `${thisMonth}-05`,
      description: 'Infra cloud mensal',
      type: 'FIXED',
      category: 'Infraestrutura',
      amount: 3600,
      status: 'PAID',
      supplierId: 'sup-hosting',
      supplierName: 'CloudHost Infra LTDA',
      paymentMethod: 'TRANSFER',
      isForecast: false
    },
    {
      id: `exp-${thisMonth}-coworking`,
      occurredOn: `${thisMonth}-08`,
      dueOn: `${thisMonth}-10`,
      description: 'Espaco coworking e salas',
      type: 'FIXED',
      category: 'Operacional',
      amount: 2100,
      status: 'OPEN',
      supplierId: 'sup-office',
      supplierName: 'Office Center Coworking',
      paymentMethod: 'BANK_SLIP',
      isForecast: false
    },
    {
      id: `exp-${thisMonth}-ads`,
      occurredOn: `${thisMonth}-12`,
      dueOn: `${thisMonth}-14`,
      description: 'Midia performance campanha Q1',
      type: 'VARIABLE',
      category: 'Marketing',
      amount: 4800,
      status: 'OPEN',
      supplierId: 'sup-marketing',
      supplierName: 'Mkt Growth Midia Digital',
      paymentMethod: 'CARD',
      isForecast: false
    },
    {
      id: `exp-${thisMonth}-energia`,
      occurredOn: `${thisMonth}-06`,
      dueOn: `${thisMonth}-08`,
      description: 'Energia eletrica escritorio (valor variavel)',
      type: 'FIXED_VARIABLE',
      category: 'Operacional',
      amount: 0,
      status: 'PENDING_VALUE',
      supplierName: 'Concessionaria de Energia',
      paymentMethod: 'BANK_SLIP',
      isForecast: false
    },
    {
      id: `exp-${thisMonth}-travel`,
      occurredOn: `${thisMonth}-16`,
      description: 'Viagens comerciais',
      type: 'VARIABLE',
      category: 'Comercial',
      amount: 1750,
      status: 'PLANNED',
      supplierName: 'Sem fornecedor',
      paymentMethod: 'OTHER',
      isForecast: true
    },
    {
      id: `exp-${nextMonth}-hosting`,
      occurredOn: `${nextMonth}-05`,
      dueOn: `${nextMonth}-05`,
      description: 'Infra cloud mensal (previsto)',
      type: 'FIXED',
      category: 'Infraestrutura',
      amount: 3700,
      status: 'PLANNED',
      supplierId: 'sup-hosting',
      supplierName: 'CloudHost Infra LTDA',
      paymentMethod: 'TRANSFER',
      isForecast: true
    },
    {
      id: `exp-${nextMonth}-ads`,
      occurredOn: `${nextMonth}-15`,
      dueOn: `${nextMonth}-20`,
      description: 'Midia performance (previsto)',
      type: 'VARIABLE',
      category: 'Marketing',
      amount: 6200,
      status: 'PLANNED',
      supplierId: 'sup-marketing',
      supplierName: 'Mkt Growth Midia Digital',
      paymentMethod: 'CARD',
      isForecast: true
    }
  ] as const;

  for (const expense of expenses) {
    const existing = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `FINANCE#EXPENSE#${expense.id}`,
          SK: 'PROFILE'
        }
      })
    );
    if (existing.Item) continue;
    const createdAt = new Date().toISOString();
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `FINANCE#EXPENSE#${expense.id}`,
          SK: 'PROFILE',
          GSI2PK: 'ENTITY#FIN_EXPENSE',
          GSI2SK: `${expense.occurredOn}#${expense.id}`,
          entityType: 'FIN_EXPENSE',
          ...expense,
          notes: '',
          competenceMonth: expense.occurredOn.slice(0, 7),
          createdBy: 'seed-local',
          createdAt,
          updatedAt: createdAt
        }
      })
    );
  }

  const forecasts = [
    {
      month: thisMonth,
      expectedRevenue: 28900,
      expectedFixedCosts: 8700,
      expectedVariableCosts: 7600,
      notes: 'Cenario base do mes vigente.'
    },
    {
      month: nextMonth,
      expectedRevenue: 33500,
      expectedFixedCosts: 9200,
      expectedVariableCosts: 9800,
      notes: 'Cenario de crescimento com campanha ativa.'
    }
  ] as const;

  for (const forecast of forecasts) {
    const nowIso = new Date().toISOString();
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `FINANCE#FORECAST#${forecast.month}`,
          SK: 'PROFILE',
          GSI2PK: 'ENTITY#FIN_FORECAST',
          GSI2SK: `${forecast.month}#PROFILE`,
          entityType: 'FIN_FORECAST_MONTH',
          ...forecast,
          updatedBy: 'seed-local',
          createdAt: nowIso,
          updatedAt: nowIso
        }
      })
    );
  }

  const templates = [
    {
      id: 'tpl-energia',
      name: 'Energia escritorio',
      category: 'Operacional',
      type: 'FIXED_VARIABLE',
      recurringFrequency: 'MONTHLY',
      updateDay: 5,
      dueDay: 8,
      requiresValueUpdate: true,
      defaultAmount: 0,
      paymentMethod: 'BANK_SLIP',
      startMonth: thisMonth,
      active: true,
      notes: 'Atualizar valor conforme fatura mensal.'
    },
    {
      id: 'tpl-cloud',
      name: 'Infra cloud mensal',
      category: 'Infraestrutura',
      type: 'FIXED',
      recurringFrequency: 'MONTHLY',
      updateDay: 5,
      dueDay: 5,
      requiresValueUpdate: false,
      defaultAmount: 3600,
      supplierId: 'sup-hosting',
      supplierName: 'CloudHost Infra LTDA',
      paymentMethod: 'TRANSFER',
      startMonth: thisMonth,
      active: true,
      notes: 'Contrato mensal de infraestrutura.'
    }
  ] as const;

  for (const template of templates) {
    const existing = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `FINANCE#TEMPLATE#${template.id}`,
          SK: 'PROFILE'
        }
      })
    );
    if (existing.Item) continue;
    const nowIso = new Date().toISOString();
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `FINANCE#TEMPLATE#${template.id}`,
          SK: 'PROFILE',
          GSI2PK: 'ENTITY#FIN_TEMPLATE',
          GSI2SK: `${nowIso}#${template.id}`,
          entityType: 'FIN_RECURRING_TEMPLATE',
          ...template,
          endMonth: undefined,
          createdBy: 'seed-local',
          createdAt: nowIso,
          updatedAt: nowIso
        }
      })
    );
  }

  console.log('Seed financial data created/updated.');
};

export const bootstrapLocalTable = async (options: LocalBootstrapOptions = {}): Promise<void> => {
  await createTable();
  await waitUntilActive();

  if (options.seedCustomer) {
    await seedPlanDefinitions();
    await seedDefaultCustomer();
    await seedSurveyResponses(process.env.DEFAULT_SEED_TENANT_ID ?? 'tenant-ativaconnect-demo');
    await seedGovernorSurveyResponses(process.env.DEFAULT_SEED_TENANT_ID ?? 'tenant-ativaconnect-demo');
    await seedFinancialData();
  }
};
