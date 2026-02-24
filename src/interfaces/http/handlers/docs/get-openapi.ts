import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { buildOpenApiSpec } from '../../docs/openapi-spec';
import { ok } from '../../response';

const resolveServerUrl = (event: Parameters<APIGatewayProxyHandlerV2>[0]): string => {
  const headerHost = event.headers?.host ?? event.headers?.Host;
  const host = headerHost ?? event.requestContext.domainName ?? 'localhost:3001';
  const protocol = event.headers?.['x-forwarded-proto'] ?? event.headers?.['X-Forwarded-Proto'] ?? 'http';
  const stage = event.requestContext.stage;
  const stagePath = stage && stage !== '$default' && stage !== 'local' ? `/${stage}` : '';
  return `${protocol}://${host}${stagePath}`;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const serverUrl = resolveServerUrl(event);
  return ok(buildOpenApiSpec(serverUrl));
};
