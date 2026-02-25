import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { buildOpenApiSpec } from '../../docs/openapi-spec';
import { ok } from '../../response';

const resolveServerUrl = (event: Parameters<APIGatewayProxyHandlerV2>[0]): string => {
  const headerHost = event.headers?.host ?? event.headers?.Host;
  const host = headerHost ?? event.requestContext.domainName ?? 'localhost:3001';
  const protocol = event.headers?.['x-forwarded-proto'] ?? event.headers?.['X-Forwarded-Proto'] ?? 'http';
  const forwardedPrefix = event.headers?.['x-forwarded-prefix'] ?? event.headers?.['X-Forwarded-Prefix'];
  if (forwardedPrefix) {
    const normalized = forwardedPrefix.endsWith('/') ? forwardedPrefix.slice(0, -1) : forwardedPrefix;
    return `${protocol}://${host}${normalized}`;
  }

  const mappedStage = event.requestContext.stage;
  const stageHeader = event.headers?.['x-stage'] ?? event.headers?.['X-Stage'];
  const stage = mappedStage ?? stageHeader;
  const isDefaultStage = stage === '$default' || stage === 'local' || !stage;
  const stagePath = isDefaultStage ? '' : `/${stage}`;
  return `${protocol}://${host}${stagePath}`;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const serverUrl = resolveServerUrl(event);
  return ok(buildOpenApiSpec(serverUrl));
};
