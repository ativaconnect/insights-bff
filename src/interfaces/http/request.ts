import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ZodType } from 'zod';
import { ZodError } from 'zod';

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export const parseBody = <T>(event: APIGatewayProxyEventV2): T => {
  if (!event.body) {
    throw new Error('Request body is required.');
  }

  return JSON.parse(event.body) as T;
};

export const parseBodyWithSchema = <T>(event: APIGatewayProxyEventV2, schema: ZodType<T>): T => {
  const parsed = parseBody<unknown>(event);
  try {
    return schema.parse(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => {
          const path = issue.path.join('.');
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
      throw new RequestValidationError(message || 'Corpo da requisicao invalido.');
    }
    throw error;
  }
};
