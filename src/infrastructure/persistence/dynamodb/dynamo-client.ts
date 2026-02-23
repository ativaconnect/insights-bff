import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION ?? 'us-east-1';
const endpoint = process.env.DYNAMODB_ENDPOINT?.trim() || undefined;

const baseClient = new DynamoDBClient({
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

export const dynamoDbDocumentClient = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true
  }
});

export const tableName = process.env.DYNAMODB_TABLE_NAME ?? 'insights-local';
export const customersTableName = process.env.DYNAMODB_CUSTOMERS_TABLE_NAME ?? tableName;
export const plansTableName = process.env.DYNAMODB_PLANS_TABLE_NAME ?? tableName;
export const billingTableName = process.env.DYNAMODB_BILLING_TABLE_NAME ?? tableName;
export const financeTableName = process.env.DYNAMODB_FINANCE_TABLE_NAME ?? tableName;
export const surveysTableName = process.env.DYNAMODB_SURVEYS_TABLE_NAME ?? tableName;
