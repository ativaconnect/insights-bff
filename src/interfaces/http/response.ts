import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export const ok = (body: unknown, statusCode = 200): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

export const fail = (statusCode: number, message: string): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message })
});
