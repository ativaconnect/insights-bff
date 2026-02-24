import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

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

const hashPassword = (password: string): { hash: string; salt: string } => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
};

const run = async (): Promise<void> => {
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
  console.log('Seed local finished (admin + plans).');
};

run().catch((error: unknown) => {
  console.error('Failed to execute local seed', error);
  process.exitCode = 1;
});
