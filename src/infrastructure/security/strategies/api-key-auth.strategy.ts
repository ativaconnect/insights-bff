import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { AuthContext } from '../../../application/ports/services/token.service';
import type { AuthStrategy } from './auth.strategy';

/**
 * Placeholder for app-to-app integrations. API keys can be mapped to service principals.
 */
export class ApiKeyAuthStrategy implements AuthStrategy {
  authenticate(event: APIGatewayProxyEventV2): AuthContext | null {
    const apiKey = event.headers['x-api-key'];
    if (!apiKey) {
      return null;
    }

    return {
      sub: `app:${apiKey.slice(0, 6)}`,
      role: 'ROLE_CUSTOMER',
      tenantId: event.headers['x-tenant-id'] ?? null
    };
  }
}
