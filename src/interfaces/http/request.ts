import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export const parseBody = <T>(event: APIGatewayProxyEventV2): T => {
  if (!event.body) {
    throw new Error('Request body is required.');
  }

  return JSON.parse(event.body) as T;
};
