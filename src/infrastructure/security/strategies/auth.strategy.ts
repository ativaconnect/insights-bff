import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { AuthContext } from '../../../application/ports/services/token.service';

export interface AuthStrategy {
  authenticate(event: APIGatewayProxyEventV2): AuthContext | null;
}
