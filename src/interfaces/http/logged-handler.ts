import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { logger } from '../../infrastructure/observability/logger';

const MAX_BODY_LOG_LENGTH = 2048;
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-app-token',
  'x-webhook-token',
  'x-api-key'
]);

const truncate = (value: string, max: number = MAX_BODY_LOG_LENGTH): string =>
  value.length <= max ? value : `${value.slice(0, max)}...[truncated:${value.length - max}]`;

const maskHeaders = (headers: Record<string, string | undefined> | undefined): Record<string, string> => {
  const output: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(headers ?? {})) {
    const key = String(rawKey ?? '').trim();
    if (!key) {
      continue;
    }
    if (rawValue === undefined) {
      continue;
    }
    const normalized = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(normalized)) {
      output[key] = '[redacted]';
      continue;
    }
    output[key] = truncate(String(rawValue));
  }
  return output;
};

const serializeBody = (
  body: string | undefined | null,
  isBase64Encoded: boolean | undefined
): Record<string, unknown> => {
  if (!body) {
    return { hasBody: false };
  }
  if (isBase64Encoded) {
    return {
      hasBody: true,
      isBase64Encoded: true,
      bodyLength: body.length
    };
  }
  const bodyTrimmed = body.trim();
  if (!bodyTrimmed) {
    return { hasBody: false };
  }
  if (bodyTrimmed.length > MAX_BODY_LOG_LENGTH) {
    return {
      hasBody: true,
      bodyLength: bodyTrimmed.length,
      bodyPreview: truncate(bodyTrimmed)
    };
  }
  try {
    return {
      hasBody: true,
      bodyJson: JSON.parse(bodyTrimmed)
    };
  } catch {
    return {
      hasBody: true,
      bodyPreview: bodyTrimmed
    };
  }
};

const serializeResponseBody = (body: string | undefined): Record<string, unknown> => {
  if (!body) {
    return { hasBody: false };
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return { hasBody: false };
  }
  if (trimmed.length > MAX_BODY_LOG_LENGTH) {
    return {
      hasBody: true,
      bodyLength: trimmed.length,
      bodyPreview: truncate(trimmed)
    };
  }
  try {
    return {
      hasBody: true,
      bodyJson: JSON.parse(trimmed)
    };
  } catch {
    return {
      hasBody: true,
      bodyPreview: trimmed
    };
  }
};

const serializeError = (error: unknown): Record<string, unknown> => {
  if (!error || typeof error !== 'object') {
    return { value: String(error) };
  }
  const current = error as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    code?: unknown;
    statusCode?: unknown;
    '$metadata'?: { requestId?: unknown; httpStatusCode?: unknown };
  };
  return {
    name: String(current.name ?? 'Error'),
    message: String(current.message ?? 'unknown_error'),
    code: current.code ? String(current.code) : undefined,
    statusCode: current.statusCode ? Number(current.statusCode) : undefined,
    awsRequestId: current.$metadata?.requestId ? String(current.$metadata.requestId) : undefined,
    awsHttpStatusCode: current.$metadata?.httpStatusCode ? Number(current.$metadata.httpStatusCode) : undefined,
    stack: typeof current.stack === 'string' ? current.stack : undefined
  };
};

const statusOf = (response: APIGatewayProxyStructuredResultV2 | void): number => {
  if (!response) {
    return 200;
  }
  const value = Number(response.statusCode);
  return Number.isFinite(value) ? value : 200;
};

export const withLoggedHandler = (
  operation: string,
  handler: APIGatewayProxyHandlerV2
): APIGatewayProxyHandlerV2 => {
  return async (event, context, callback) => {
    const startedAt = Date.now();
    const requestContext = {
      operation,
      requestId: event.requestContext.requestId,
      awsRequestId: context.awsRequestId,
      stage: event.requestContext.stage,
      method: event.requestContext.http.method,
      path: event.rawPath,
      sourceIp: event.requestContext.http.sourceIp,
      userAgent: event.requestContext.http.userAgent
    };

    logger.info('http.request.in', {
      ...requestContext,
      headers: maskHeaders(event.headers),
      query: event.queryStringParameters ?? {},
      pathParameters: event.pathParameters ?? {},
      ...serializeBody(event.body, event.isBase64Encoded)
    });

    try {
      const response = (await handler(event, context, callback)) as APIGatewayProxyStructuredResultV2;
      const durationMs = Date.now() - startedAt;
      const statusCode = statusOf(response);
      const data = {
        ...requestContext,
        durationMs,
        statusCode,
        responseHeaders: maskHeaders(response?.headers as Record<string, string | undefined> | undefined),
        ...serializeResponseBody(response?.body)
      };
      if (statusCode >= 500) {
        logger.error('http.request.out', data);
      } else if (statusCode >= 400) {
        logger.warn('http.request.out', data);
      } else {
        logger.info('http.request.out', data);
      }
      return response;
    } catch (error: unknown) {
      logger.error('http.request.error', {
        ...requestContext,
        durationMs: Date.now() - startedAt,
        error: serializeError(error)
      });
      throw error;
    }
  };
};

