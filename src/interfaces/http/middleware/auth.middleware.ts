import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { container } from '../../../infrastructure/di/container';
import type { OwnerAdminAccessLevel, OwnerAdminPermission } from '../../../core/domain/value-objects/admin-permissions';
import type { UserRole } from '../../../core/domain/value-objects/user-role';
import { fail } from '../response';
import { authorizeAppToken } from './app-token.middleware';

export interface AuthenticatedRequest {
  subject: string;
  role: UserRole;
  tenantId: string | null;
  interviewerId?: string | null;
  adminAccessLevel?: OwnerAdminAccessLevel | null;
  adminPermissions?: OwnerAdminPermission[];
}

export type AuthorizationResult = AuthenticatedRequest | APIGatewayProxyStructuredResultV2;

export const isAuthorizationError = (
  value: AuthorizationResult
): value is APIGatewayProxyStructuredResultV2 => 'statusCode' in value;

const hasAdminPermission = (permissions: OwnerAdminPermission[] | undefined, required: OwnerAdminPermission): boolean => {
  const values = Array.isArray(permissions) ? permissions : [];
  return values.includes(required);
};

const hasBearerToken = (event: APIGatewayProxyEventV2): boolean => {
  const header = event.headers.authorization ?? event.headers.Authorization;
  if (typeof header !== 'string') {
    return false;
  }
  return /^Bearer\s+\S+$/i.test(header.trim());
};

const normalizePath = (path: string | undefined): string => String(path ?? '').split('?')[0];

const resolveRequiredAdminPermission = (
  method: string | undefined,
  path: string | undefined
): OwnerAdminPermission | null => {
  const normalizedMethod = String(method ?? '').trim().toUpperCase();
  const normalizedPath = normalizePath(path);
  if (!normalizedPath.startsWith('/admin/')) {
    return null;
  }

  if (normalizedPath.startsWith('/admin/users')) {
    return normalizedMethod === 'GET' ? 'USERS_READ' : 'USERS_WRITE';
  }
  if (normalizedPath.startsWith('/admin/customers')) {
    return normalizedMethod === 'GET' ? 'CUSTOMERS_READ' : 'CUSTOMERS_WRITE';
  }
  if (normalizedPath.startsWith('/admin/plans')) {
    return normalizedMethod === 'GET' ? 'PLANS_READ' : 'PLANS_WRITE';
  }
  if (normalizedPath.startsWith('/admin/payments')) {
    return normalizedMethod === 'GET' ? 'PAYMENTS_CONFIG_READ' : 'PAYMENTS_CONFIG_WRITE';
  }
  if (normalizedPath.startsWith('/admin/frontend')) {
    return normalizedMethod === 'GET' ? 'PLANS_READ' : 'PLANS_WRITE';
  }
  if (normalizedPath.startsWith('/admin/billing')) {
    return 'BILLING_READ';
  }
  if (normalizedPath.startsWith('/admin/credits/requests')) {
    return normalizedMethod === 'GET' ? 'BILLING_READ' : 'BILLING_REVIEW';
  }
  if (normalizedPath.startsWith('/admin/finance')) {
    return normalizedMethod === 'GET' ? 'FINANCE_READ' : 'FINANCE_WRITE';
  }

  return null;
};

export const authorize = (event: APIGatewayProxyEventV2, expectedRole: UserRole | UserRole[]): AuthorizationResult => {
  const appAuthError = authorizeAppToken(event);
  if (appAuthError) {
    return appAuthError;
  }
  if (!hasBearerToken(event)) {
    return fail(401, 'User token required.');
  }

  const authContext = container.security.authenticator.authenticate(event);

  if (!authContext) {
    return fail(401, 'Unauthorized');
  }

  const allowed = Array.isArray(expectedRole) ? expectedRole : [expectedRole];
  if (!allowed.includes(authContext.role)) {
    return fail(403, 'Forbidden');
  }
  if (authContext.role === 'ROLE_ADMIN') {
    const requiredPermission = resolveRequiredAdminPermission(event.requestContext.http.method, event.rawPath);
    if (requiredPermission && !hasAdminPermission(authContext.adminPermissions, requiredPermission)) {
      return fail(403, 'Sem permissao para esta acao administrativa.');
    }
  }

  return {
    subject: authContext.sub,
    role: authContext.role,
    tenantId: authContext.tenantId,
    interviewerId: authContext.interviewerId ?? null,
    adminAccessLevel: authContext.adminAccessLevel ?? null,
    adminPermissions: authContext.adminPermissions ?? []
  };
};
