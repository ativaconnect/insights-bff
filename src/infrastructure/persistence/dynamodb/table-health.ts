import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

export interface DynamoHealth {
  ok: boolean;
  tableName: string;
  tableStatus?: string;
  error?: string;
}

export const checkDynamoHealth = async (): Promise<DynamoHealth> => {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const endpoint = process.env.DYNAMODB_ENDPOINT?.trim() || undefined;
  const tableName = process.env.DYNAMODB_TABLE_NAME ?? 'insights-local';

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
    const output = await client.send(new DescribeTableCommand({ TableName: tableName }));
    return {
      ok: output.Table?.TableStatus === 'ACTIVE',
      tableName,
      tableStatus: output.Table?.TableStatus
    };
  } catch (error) {
    return {
      ok: false,
      tableName,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};
