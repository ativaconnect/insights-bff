import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { timingSafeEqual } from 'crypto';
import { fail } from '../response';
import { assertConfiguredSecret, isLocalStage, isPlaceholderValue } from '../../../infrastructure/security/security-config';

const APP_TOKEN_HEADER_NAMES = ['x-app-token', 'X-App-Token'] as const;

const getHeaderValue = (event: APIGatewayProxyEventV2): string | null => {
  for (const headerName of APP_TOKEN_HEADER_NAMES) {
    const value = event.headers[headerName];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const safeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const authorizeAppToken = (event: APIGatewayProxyEventV2) => {
  const expectedToken = assertConfiguredSecret('APP_CLIENT_TOKEN', process.env.APP_CLIENT_TOKEN, process.env.APP_STAGE);
  const previousToken = (process.env.APP_CLIENT_TOKEN_PREVIOUS ?? '').trim();
  if (previousToken && !isLocalStage(process.env.APP_STAGE) && isPlaceholderValue(previousToken)) {
    return fail(500, 'APP_CLIENT_TOKEN_PREVIOUS must be non-placeholder when configured.');
  }
  const validTokens = previousToken ? [expectedToken, previousToken] : [expectedToken];

  const incomingToken = getHeaderValue(event);
  if (!incomingToken) {
    return fail(401, 'App token required.');
  }

  const isValid = validTokens.some((token) => safeEquals(incomingToken, token));
  if (!isValid) {
    return fail(401, 'Invalid app token.');
  }

  return null;
};
