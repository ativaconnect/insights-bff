import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

export interface DynamoHealth {
  ok: boolean;
  tables: Array<{ tableName: string; tableStatus?: string; ok: boolean; error?: string }>;
  error?: string;
}

export const checkDynamoHealth = async (): Promise<DynamoHealth> => {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const endpoint = process.env.DYNAMODB_ENDPOINT?.trim() || undefined;
  const tableNames = Array.from(
    new Set([
      process.env.DYNAMODB_CUSTOMERS_TABLE_NAME ?? 'insights-customers-local',
      process.env.DYNAMODB_PLANS_TABLE_NAME ?? 'insights-plans-local',
      process.env.DYNAMODB_BILLING_TABLE_NAME ?? 'insights-billing-local',
      process.env.DYNAMODB_FINANCE_TABLE_NAME ?? 'insights-finance-local',
      process.env.DYNAMODB_SURVEYS_TABLE_NAME ?? 'insights-surveys-local'
    ])
  );

  const client = new DynamoDBClient({
    region,
    endpoint,
    ...(endpoint
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local'
          }
        }
      : {})
  });

  try {
    const details: Array<{ tableName: string; tableStatus?: string; ok: boolean; error?: string }> = [];
    for (const tableName of tableNames) {
      try {
        const output = await client.send(new DescribeTableCommand({ TableName: tableName }));
        details.push({
          tableName,
          tableStatus: output.Table?.TableStatus,
          ok: output.Table?.TableStatus === 'ACTIVE'
        });
      } catch (error) {
        details.push({
          tableName,
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const ok = details.every((item) => item.ok);
    return {
      ok,
      tables: details
    };
  } catch (error) {
    return {
      ok: false,
      tables: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};
