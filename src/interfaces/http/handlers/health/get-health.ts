import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../logged-handler';
import { checkDynamoHealth } from '../../../../infrastructure/persistence/dynamodb/table-health';
import { ok } from '../../response';

const rawHandler: APIGatewayProxyHandlerV2 = async () => {
  const dynamo = await checkDynamoHealth();
  const healthy = dynamo.ok;

  return ok(
    {
      service: 'insights-backend',
      status: healthy ? 'UP' : 'DEGRADED',
      timestamp: new Date().toISOString()
    },
    healthy ? 200 : 503
  );
};

export const handler = withLoggedHandler('health/get-health', rawHandler);


