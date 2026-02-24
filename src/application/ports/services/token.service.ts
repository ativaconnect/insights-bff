import type { UserRole } from '../../../core/domain/value-objects/user-role';
import type { OwnerAdminAccessLevel, OwnerAdminPermission } from '../../../core/domain/value-objects/admin-permissions';

export interface AuthContext {
  sub: string;
  role: UserRole;
  tenantId: string | null;
  interviewerId?: string | null;
  adminAccessLevel?: OwnerAdminAccessLevel | null;
  adminPermissions?: OwnerAdminPermission[];
}

export interface TokenService {
  verify(token: string): AuthContext;
}
