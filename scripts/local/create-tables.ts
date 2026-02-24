import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException
} from '@aws-sdk/client-dynamodb';

const region = process.env.AWS_REGION ?? 'us-east-1';
const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';

const resolveTableNames = (): string[] => {
  const names = [
    process.env.DYNAMODB_CUSTOMERS_TABLE_NAME ?? 'insights-customers-local',
    process.env.DYNAMODB_PLANS_TABLE_NAME ?? 'insights-plans-local',
    process.env.DYNAMODB_BILLING_TABLE_NAME ?? 'insights-billing-local',
    process.env.DYNAMODB_FINANCE_TABLE_NAME ?? 'insights-finance-local',
    process.env.DYNAMODB_SURVEYS_TABLE_NAME ?? 'insights-surveys-local'
  ];
  return Array.from(new Set(names.map((item) => item.trim()).filter(Boolean)));
};

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local'
  }
});

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
          { AttributeName: 'GSI2SK', AttributeType: 'S' },
          { AttributeName: 'GSI3PK', AttributeType: 'S' },
          { AttributeName: 'GSI3SK', AttributeType: 'S' }
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
            Projection: { ProjectionType: 'KEYS_ONLY' }
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' }
            ],
            Projection: { ProjectionType: 'ALL' }
          },
          {
            IndexName: 'GSI3',
            KeySchema: [
              { AttributeName: 'GSI3PK', KeyType: 'HASH' },
              { AttributeName: 'GSI3SK', KeyType: 'RANGE' }
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

const waitActive = async (tableName: string): Promise<void> => {
  for (let i = 0; i < 30; i += 1) {
    const output = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (output.Table?.TableStatus === 'ACTIVE') {
      console.log(`Table ACTIVE: ${tableName}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Table not ACTIVE in time: ${tableName}`);
};

const run = async (): Promise<void> => {
  const tableNames = resolveTableNames();
  for (const tableName of tableNames) {
    await createTableIfMissing(tableName);
  }
  for (const tableName of tableNames) {
    await waitActive(tableName);
  }
  console.log(`Local create finished. Tables: ${tableNames.join(', ')}`);
};

run().catch((error: unknown) => {
  console.error('Failed to create local tables', error);
  process.exitCode = 1;
});
