import jwt from 'jsonwebtoken';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { AuthContext } from '../../../application/ports/services/token.service';
import type { OwnerAdminAccessLevel, OwnerAdminPermission } from '../../../core/domain/value-objects/admin-permissions';
import type { AuthStrategy } from './auth.strategy';

interface JwtPayload {
  sub: string;
  role: 'ROLE_CUSTOMER' | 'ROLE_INTERVIEWER' | 'ROLE_ADMIN';
  tenantId?: string;
  interviewerId?: string;
  adminAccessLevel?: OwnerAdminAccessLevel;
  adminPermissions?: OwnerAdminPermission[];
}

export class JwtAuthStrategy implements AuthStrategy {
  constructor(private readonly secret: string) {}

  authenticate(event: APIGatewayProxyEventV2): AuthContext | null {
    const header = event.headers.authorization ?? event.headers.Authorization;
    const token = header && header.startsWith('Bearer ') ? header.replace('Bearer ', '').trim() : null;
    if (!token) {
      return null;
    }

    try {
      const payload = jwt.verify(token, this.secret) as JwtPayload;
      return {
        sub: payload.sub,
        role: payload.role,
        tenantId: payload.tenantId ?? null,
        interviewerId: payload.interviewerId ?? null,
        adminAccessLevel: payload.adminAccessLevel ?? null,
        adminPermissions: Array.isArray(payload.adminPermissions) ? payload.adminPermissions : []
      };
    } catch {
      return null;
    }
  }
}
