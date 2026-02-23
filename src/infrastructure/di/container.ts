import { Authenticator } from '../security/authenticator';
import { JwtAuthStrategy } from '../security/strategies/jwt-auth.strategy';
import { assertConfiguredSecret } from '../security/security-config';

const jwtSecret = assertConfiguredSecret('JWT_SECRET', process.env.JWT_SECRET, process.env.APP_STAGE);

const authenticator = new Authenticator([new JwtAuthStrategy(jwtSecret)]);

export const container = {
  security: {
    authenticator
  }
};
