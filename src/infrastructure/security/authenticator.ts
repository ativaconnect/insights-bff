import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { AuthContext } from '../../application/ports/services/token.service';
import type { AuthStrategy } from './strategies/auth.strategy';

export class Authenticator {
  constructor(private readonly strategies: AuthStrategy[]) {}

  authenticate(event: APIGatewayProxyEventV2): AuthContext | null {
    for (const strategy of this.strategies) {
      const context = strategy.authenticate(event);
      if (context) {
        return context;
      }
    }

    return null;
  }
}
