import type { UserRole } from '../../../core/domain/value-objects/user-role';

export interface AuthContext {
  sub: string;
  role: UserRole;
  tenantId: string | null;
  interviewerId?: string | null;
}

export interface TokenService {
  verify(token: string): AuthContext;
}
