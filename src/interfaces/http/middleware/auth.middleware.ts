import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { container } from '../../../infrastructure/di/container';
import type { UserRole } from '../../../core/domain/value-objects/user-role';
import { fail } from '../response';

export interface AuthenticatedRequest {
  subject: string;
  role: UserRole;
  tenantId: string | null;
  interviewerId?: string | null;
}

export type AuthorizationResult = AuthenticatedRequest | APIGatewayProxyStructuredResultV2;

export const isAuthorizationError = (
  value: AuthorizationResult
): value is APIGatewayProxyStructuredResultV2 => 'statusCode' in value;

export const authorize = (event: APIGatewayProxyEventV2, expectedRole: UserRole | UserRole[]): AuthorizationResult => {
  const authContext = container.security.authenticator.authenticate(event);

  if (!authContext) {
    return fail(401, 'Unauthorized');
  }

  const allowed = Array.isArray(expectedRole) ? expectedRole : [expectedRole];
  if (!allowed.includes(authContext.role)) {
    return fail(403, 'Forbidden');
  }

  return {
    subject: authContext.sub,
    role: authContext.role,
    tenantId: authContext.tenantId,
    interviewerId: authContext.interviewerId ?? null
  };
};
