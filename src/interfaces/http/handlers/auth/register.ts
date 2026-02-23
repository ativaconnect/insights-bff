import jwt from 'jsonwebtoken';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CustomerAccountRepository } from '../../../../infrastructure/persistence/dynamodb/customer-account.repository';
import { parseBody } from '../../request';
import { fail, ok } from '../../response';

interface RegisterRequest {
  personType: 'PF' | 'PJ';
  document: string;
  legalName: string;
  tradeName?: string;
  email: string;
  phone: string;
  password: string;
  address: {
    cep: string;
    state: string;
    city: string;
    neighborhood: string;
    street: string;
    number: string;
    complement?: string;
  };
}

const repository = new CustomerAccountRepository();

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = parseBody<RegisterRequest>(event);
    if (
      !body.email ||
      !body.password ||
      !body.document ||
      !body.legalName ||
      !body.personType ||
      !body.address?.cep
    ) {
      return fail(400, 'Dados obrigatorios ausentes.');
    }

    if (body.password.length < 6) {
      return fail(400, 'Senha deve ter ao menos 6 caracteres.');
    }

    const session = await repository.register(body);
    const secret = process.env.JWT_SECRET ?? 'local-dev-secret';
    const expiresInSeconds = 2 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    const token = jwt.sign(
      {
        sub: session.userId,
        role: 'ROLE_CUSTOMER',
        tenantId: session.tenantId
      },
      secret,
      { expiresIn: `${expiresInSeconds}s` }
    );

    return ok(
      {
        token,
        expiresInSeconds,
        expiresAt,
        session: {
          role: 'ROLE_CUSTOMER',
          userName: session.userName,
          tenantName: session.tenantName,
          tenantId: session.tenantId,
          email: session.email
        }
      },
      201
    );
  } catch (error: any) {
    if (error?.name === 'TransactionCanceledException' || error?.name === 'ConditionalCheckFailedException') {
      return fail(409, 'Email ou CPF/CNPJ ja cadastrado.');
    }
    return fail(400, 'Nao foi possivel concluir o cadastro.');
  }
};
