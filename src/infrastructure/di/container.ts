import { Authenticator } from '../security/authenticator';
import { JwtAuthStrategy } from '../security/strategies/jwt-auth.strategy';
import { ApiKeyAuthStrategy } from '../security/strategies/api-key-auth.strategy';

const jwtSecret = process.env.JWT_SECRET ?? 'local-dev-secret';
const authenticator = new Authenticator([new JwtAuthStrategy(jwtSecret), new ApiKeyAuthStrategy()]);

export const container = {
  security: {
    authenticator
  }
};
