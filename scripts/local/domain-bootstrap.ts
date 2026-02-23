import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { hashPassword } from '../../src/infrastructure/security/password-hasher';
import { normalizeDigits, normalizeEmail } from '../../src/infrastructure/persistence/dynamodb/keys';

type Domain = 'customers' | 'plans' | 'billing' | 'finance' | 'surveys';

interface DomainConfig {
  legacy: string;
  customers: string;
  plans: string;
  billing: string;
  finance: string;
  surveys: string;
}

const region = process.env.AWS_REGION ?? 'us-east-1';
const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const config: DomainConfig = {
  legacy: process.env.DYNAMODB_TABLE_NAME ?? 'insights-local',
  customers: process.env.DYNAMODB_CUSTOMERS_TABLE_NAME ?? 'insights-customers-local',
  plans: process.env.DYNAMODB_PLANS_TABLE_NAME ?? 'insights-plans-local',
  billing: process.env.DYNAMODB_BILLING_TABLE_NAME ?? 'insights-billing-local',
  finance: process.env.DYNAMODB_FINANCE_TABLE_NAME ?? 'insights-finance-local',
  surveys: process.env.DYNAMODB_SURVEYS_TABLE_NAME ?? 'insights-surveys-local'
};

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

const domains: Array<{ key: Domain; tableName: string }> = [
  { key: 'customers', tableName: config.customers },
  { key: 'plans', tableName: config.plans },
  { key: 'billing', tableName: config.billing },
  { key: 'finance', tableName: config.finance },
  { key: 'surveys', tableName: config.surveys }
];

const createTableIfMissing = async (tableName: string): Promise<void> => {
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
      return;
    }
    throw error;
  }
};

const waitActive = async (tableName: string): Promise<void> => {
  for (let i = 0; i < 25; i += 1) {
    const output = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (output.Table?.TableStatus === 'ACTIVE') return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Table not active: ${tableName}`);
};

const resolveDomain = (item: Record<string, unknown>): Domain => {
  const pk = String(item.PK ?? '');
  const sk = String(item.SK ?? '');
  const entityType = String(item.entityType ?? '');

  if (pk.startsWith('FINANCE#') || entityType.startsWith('FIN_') || entityType.startsWith('FINANCE_')) {
    return 'finance';
  }
  if (pk.startsWith('PLANDEF#') || pk.startsWith('PLANDEF_CODE#') || entityType.startsWith('PLAN_DEFINITION')) {
    return 'plans';
  }
  if (
    pk.startsWith('CREDIT_REQUEST#') ||
    sk.startsWith('CREDIT_REQUEST#') ||
    entityType.startsWith('CREDIT_PURCHASE_REQUEST')
  ) {
    return 'billing';
  }
  if (
    pk.startsWith('SURVEY#') ||
    pk.startsWith('INTERVIEWERLOGIN#') ||
    sk.startsWith('SURVEY#') ||
    sk.startsWith('INTERVIEWER#') ||
    entityType.startsWith('SURVEY') ||
    entityType.startsWith('INTERVIEWER')
  ) {
    return 'surveys';
  }
  if (
    pk.startsWith('TENANT#') &&
    (sk.startsWith('SURVEY#') || sk.startsWith('INTERVIEWER#'))
  ) {
    return 'surveys';
  }
  if (pk.startsWith('TENANT#') && sk.startsWith('CREDIT_REQUEST#')) {
    return 'billing';
  }
  return 'customers';
};

const scanAll = async (tableName: string): Promise<Array<Record<string, unknown>>> => {
  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const output = await doc.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey
      })
    );
    items.push(...((output.Items ?? []) as Array<Record<string, unknown>>));
    lastKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
};

const migrateLegacyData = async (): Promise<void> => {
  if (
    config.legacy === config.customers &&
    config.legacy === config.plans &&
    config.legacy === config.billing &&
    config.legacy === config.finance &&
    config.legacy === config.surveys
  ) {
    console.log('Legacy and domain tables are the same. Migration skipped.');
    return;
  }

  let items: Array<Record<string, unknown>> = [];
  try {
    items = await scanAll(config.legacy);
  } catch (error: any) {
    if (error?.name === 'ResourceNotFoundException') {
      console.log(`Legacy table not found (${config.legacy}). Migration skipped.`);
      return;
    }
    throw error;
  }
  let moved = 0;
  for (const item of items) {
    const domain = resolveDomain(item);
    const target = config[domain];
    await doc.send(
      new PutCommand({
        TableName: target,
        Item: item
      })
    );
    moved += 1;
  }
  console.log(`Migration completed. Records copied: ${moved}`);
};

const seededRandom = (seedValue: number): (() => number) => {
  let seed = seedValue >>> 0;
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
};

const pick = <T>(rand: () => number, values: readonly T[]): T => values[Math.floor(rand() * values.length)];

const monthKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const ensurePlans = async (): Promise<void> => {
  const now = new Date().toISOString();
  const plans = [
    { code: 'START', name: 'Start', tier: 0, pricePerForm: 0, minForms: 0, maxSurveys: 5, maxQuestionsPerSurvey: 5, maxResponsesPerSurvey: 15, maxInterviewers: 1, active: true },
    { code: 'PERSONAL', name: 'Personal', tier: 1, pricePerForm: 1.5, minForms: 100, maxSurveys: 12, maxQuestionsPerSurvey: 15, maxResponsesPerSurvey: 500, maxInterviewers: 3, active: true },
    { code: 'PROFESSIONAL', name: 'Professional', tier: 2, pricePerForm: 1.2, minForms: 500, maxSurveys: 40, maxQuestionsPerSurvey: 25, maxResponsesPerSurvey: 2500, maxInterviewers: 15, active: true },
    { code: 'PREMIUM', name: 'Premium', tier: 3, pricePerForm: 0.99, minForms: 1200, maxSurveys: 200, maxQuestionsPerSurvey: 40, maxResponsesPerSurvey: 20000, maxInterviewers: 100, active: true }
  ] as const;

  for (const plan of plans) {
    const code = plan.code.toUpperCase();
    const productCode = 'INSIGHTS';
    const lockKey = { PK: `PLANDEF_CODE#${productCode}#${code}`, SK: 'LOCK' };
    const planId = `plan-${code.toLowerCase()}`;

    const exists = await doc.send(new GetCommand({ TableName: config.plans, Key: { PK: `PLANDEF#${planId}`, SK: 'PROFILE' } }));
    if (!exists.Item) {
      await doc.send(
        new PutCommand({
          TableName: config.plans,
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
            description: `${plan.name} plan`,
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
          }
        })
      );
    }
    await doc.send(
      new PutCommand({
        TableName: config.plans,
        Item: {
          ...lockKey,
          entityType: 'PLAN_DEFINITION_CODE_LOCK',
          planId,
          productCode,
          code
        }
      })
    );
  }
};

const seedCustomersAndMovements = async (count: number): Promise<void> => {
  const rand = seededRandom(20260222);
  const now = new Date();
  const planCodes = ['START', 'PERSONAL', 'PROFESSIONAL', 'PREMIUM'] as const;
  const planPrices: Record<string, number> = { START: 0, PERSONAL: 1.5, PROFESSIONAL: 1.2, PREMIUM: 0.99 };

  for (let i = 1; i <= count; i += 1) {
    const suffix = String(i).padStart(3, '0');
    const tenantId = `tenant-demo-${suffix}`;
    const userId = `user-demo-${suffix}`;
    const planCode = i <= 8 ? 'START' : pick(rand, planCodes.slice(1));
    const balance = Math.floor(50 + rand() * 4000);
    const createdAt = new Date(now.getTime() - Math.floor(rand() * 1000 * 60 * 60 * 24 * 120)).toISOString();
    const legalName = `Cliente Demo ${suffix} LTDA`;
    const tradeName = `Cliente ${suffix}`;
    const email = normalizeEmail(`cliente${suffix}@demo.ativaconnect.com`);
    const document = normalizeDigits(`11122233000${suffix}`);
    const password = hashPassword('admin123');

    const tenantExists = await doc.send(
      new GetCommand({
        TableName: config.customers,
        Key: { PK: `TENANT#${tenantId}`, SK: 'PROFILE' }
      })
    );

    if (!tenantExists.Item) {
      await doc.send(
        new PutCommand({
          TableName: config.customers,
          Item: {
            PK: `TENANT#${tenantId}`,
            SK: 'PROFILE',
            GSI2PK: 'ENTITY#TENANT',
            GSI2SK: `${createdAt}#${tenantId}`,
            entityType: 'TENANT',
            id: tenantId,
            personType: 'PJ',
            document,
            legalName,
            tradeName,
            email,
            phone: `1199${suffix}0000`,
            planCode,
            questionnaireCreditsBalance: balance,
            address: {
              cep: '01001000',
              state: 'SP',
              city: 'Sao Paulo',
              neighborhood: 'Centro',
              street: 'Rua Demo',
              number: String(100 + i),
              complement: ''
            },
            createdAt,
            updatedAt: createdAt
          }
        })
      );

      await doc.send(
        new PutCommand({
          TableName: config.customers,
          Item: {
            PK: `USER#${userId}`,
            SK: 'PROFILE',
            GSI2PK: `TENANT#${tenantId}#USER`,
            GSI2SK: `${createdAt}#${userId}`,
            entityType: 'USER',
            id: userId,
            tenantId,
            name: legalName,
            email,
            role: 'ROLE_CUSTOMER',
            passwordHash: password.hash,
            passwordSalt: password.salt,
            createdAt,
            updatedAt: createdAt
          }
        })
      );

      await doc.send(
        new PutCommand({
          TableName: config.customers,
          Item: { PK: `USEREMAIL#${email}`, SK: 'LOCK', entityType: 'USER_EMAIL_LOCK', userId, tenantId, email }
        })
      );
      await doc.send(
        new PutCommand({
          TableName: config.customers,
          Item: { PK: `TENANTDOC#${document}`, SK: 'LOCK', entityType: 'TENANT_DOC_LOCK', tenantId, document }
        })
      );
    }

    const requestsPerTenant = 4 + Math.floor(rand() * 6);
    for (let n = 0; n < requestsPerTenant; n += 1) {
      const ageDays = Math.floor(rand() * 90);
      const requestedAtDate = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
      const requestedAt = requestedAtDate.toISOString();
      const requestId = `req-${suffix}-${String(n + 1).padStart(2, '0')}`;
      const statusRoll = rand();
      const status: 'APPROVED' | 'PENDING' | 'REJECTED' = statusRoll < 0.58 ? 'APPROVED' : statusRoll < 0.83 ? 'PENDING' : 'REJECTED';
      const requestedPlanCode = pick(rand, ['PERSONAL', 'PROFESSIONAL', 'PREMIUM']);
      const requestedCredits = Math.floor(100 + rand() * 2000);
      const requestedPricePerForm = planPrices[requestedPlanCode];
      const estimatedAmount = Number((requestedCredits * requestedPricePerForm).toFixed(2));
      const requestSk = `CREDIT_REQUEST#${requestedAt}#${requestId}`;
      const reviewedAt =
        status === 'PENDING'
          ? undefined
          : new Date(requestedAtDate.getTime() + (2 + Math.floor(rand() * 6)) * 60 * 60 * 1000).toISOString();

      await doc.send(
        new PutCommand({
          TableName: config.billing,
          Item: {
            PK: `TENANT#${tenantId}`,
            SK: requestSk,
            GSI2PK: 'ENTITY#CREDIT_PURCHASE_REQUEST',
            GSI2SK: `${status}#${requestedAt}#${tenantId}#${requestId}`,
            entityType: 'CREDIT_PURCHASE_REQUEST',
            id: requestId,
            tenantId,
            requesterUserId: userId,
            productCode: 'INSIGHTS',
            requestedPlanCode,
            requestedCredits,
            requestedPricePerForm,
            estimatedAmount,
            status,
            note: 'Seed de movimentacao local',
            requestedAt,
            reviewedAt,
            reviewedBy: status === 'PENDING' ? undefined : 'admin-root',
            reviewNote: status === 'REJECTED' ? 'Reprovado por criterio interno' : undefined,
            appliedPlanCode: status === 'APPROVED' ? requestedPlanCode : undefined,
            appliedPlanName: status === 'APPROVED' ? requestedPlanCode : undefined,
            appliedPlanTier: status === 'APPROVED' ? (requestedPlanCode === 'PREMIUM' ? 3 : requestedPlanCode === 'PROFESSIONAL' ? 2 : 1) : undefined,
            resultingCreditsBalance: status === 'APPROVED' ? balance + requestedCredits : undefined,
            updatedAt: reviewedAt ?? requestedAt
          }
        })
      );

      await doc.send(
        new PutCommand({
          TableName: config.billing,
          Item: {
            PK: `CREDIT_REQUEST#${requestId}`,
            SK: 'LOCK',
            entityType: 'CREDIT_PURCHASE_REQUEST_LOCK',
            requestId,
            tenantId,
            requestSk
          }
        })
      );
    }
  }

  const suppliers = [
    { id: 'sup-cloud', name: 'Cloud Core SA', category: 'Infraestrutura' },
    { id: 'sup-mkt', name: 'Growth Ads Midia', category: 'Marketing' },
    { id: 'sup-ops', name: 'Ops Office Servicos', category: 'Operacional' },
    { id: 'sup-legal', name: 'Legal Prime', category: 'Juridico' }
  ] as const;

  for (const supplier of suppliers) {
    const nowIso = new Date().toISOString();
    await doc.send(
      new PutCommand({
        TableName: config.finance,
        Item: {
          PK: `FINANCE#SUPPLIER#${supplier.id}`,
          SK: 'PROFILE',
          GSI2PK: 'ENTITY#FIN_SUPPLIER',
          GSI2SK: `${nowIso}#${supplier.id}`,
          entityType: 'FIN_SUPPLIER',
          id: supplier.id,
          name: supplier.name,
          category: supplier.category,
          status: 'ACTIVE',
          createdAt: nowIso,
          updatedAt: nowIso
        }
      })
    );
  }

  const categories = ['Infraestrutura', 'Marketing', 'Operacional', 'Comercial', 'Juridico'];
  const methods = ['PIX', 'CARD', 'BANK_SLIP', 'TRANSFER'];
  const statuses = ['PAID', 'OPEN', 'PLANNED'];
  let expenseCount = 0;

  for (let day = 0; day < 90; day += 1) {
    const date = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
    const perDay = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < perDay; k += 1) {
      expenseCount += 1;
      const id = `exp-mass-${String(expenseCount).padStart(4, '0')}`;
      const occurredOn = date.toISOString().slice(0, 10);
      const status = pick(rand, statuses);
      const type = rand() > 0.6 ? 'VARIABLE' : rand() > 0.2 ? 'FIXED' : 'FIXED_VARIABLE';
      const amount = type === 'FIXED_VARIABLE' && rand() > 0.85 ? 0 : Number((500 + rand() * 9500).toFixed(2));
      const finalStatus = amount === 0 ? 'PENDING_VALUE' : status;
      const supplier = pick(rand, suppliers);
      const createdAt = new Date(date.getTime() + k * 60 * 60 * 1000).toISOString();

      await doc.send(
        new PutCommand({
          TableName: config.finance,
          Item: {
            PK: `FINANCE#EXPENSE#${id}`,
            SK: 'PROFILE',
            GSI2PK: 'ENTITY#FIN_EXPENSE',
            GSI2SK: `${occurredOn}#${id}`,
            entityType: 'FIN_EXPENSE',
            id,
            occurredOn,
            dueOn: occurredOn,
            description: `Despesa operacional ${id}`,
            type,
            category: pick(rand, categories),
            amount,
            status: finalStatus,
            supplierId: supplier.id,
            supplierName: supplier.name,
            paymentMethod: pick(rand, methods),
            notes: 'Seed massivo local',
            isForecast: finalStatus === 'PLANNED',
            competenceMonth: monthKey(date),
            createdBy: 'seed-domain-bootstrap',
            createdAt,
            updatedAt: createdAt
          }
        })
      );
    }
  }

  console.log(`Seed completed: ${count} tenants and ${expenseCount} finance expenses over the last 3 months.`);
};

const run = async (): Promise<void> => {
  const customerCount = Number(process.env.SEED_CUSTOMERS_COUNT ?? '30');
  for (const domain of domains) {
    await createTableIfMissing(domain.tableName);
    await waitActive(domain.tableName);
  }
  await migrateLegacyData();
  await ensurePlans();
  await seedCustomersAndMovements(Number.isFinite(customerCount) && customerCount > 0 ? customerCount : 30);
  console.log('Domain bootstrap finished.');
};

void run().catch((error) => {
  console.error('Domain bootstrap failed', error);
  process.exitCode = 1;
});
