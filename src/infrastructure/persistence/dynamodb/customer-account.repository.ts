import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  PutCommand
} from '@aws-sdk/lib-dynamodb';
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { dynamoDbDocumentClient, customersTableName } from './dynamo-client';
import { normalizeDigits, normalizeEmail } from './keys';
import { hashPassword, verifyPassword } from '../../security/password-hasher';

export interface CustomerRegistration {
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

export interface CustomerSession {
  userId: string;
  tenantId: string;
  userName: string;
  tenantName: string;
  email: string;
}

export interface CustomerProfile {
  tenantId: string;
  planCode: string;
  questionnaireCreditsBalance: number;
  personType: 'PF' | 'PJ';
  document: string;
  legalName: string;
  tradeName?: string;
  email: string;
  phone: string;
  address: {
    cep: string;
    state: string;
    city: string;
    neighborhood: string;
    street: string;
    number: string;
    complement?: string;
  };
  createdAt: string;
  updatedAt: string;
}

const tenantKey = (tenantId: string) => ({ PK: `TENANT#${tenantId}`, SK: 'PROFILE' });
const userKey = (userId: string) => ({ PK: `USER#${userId}`, SK: 'PROFILE' });
const emailLockKey = (email: string) => ({ PK: `USEREMAIL#${normalizeEmail(email)}`, SK: 'LOCK' });
const tenantDocLockKey = (document: string) => ({ PK: `TENANTDOC#${normalizeDigits(document)}`, SK: 'LOCK' });

export class CustomerAccountRepository {
  async register(input: CustomerRegistration): Promise<CustomerSession> {
    const now = new Date().toISOString();
    const tenantId = uuid();
    const userId = uuid();
    const email = normalizeEmail(input.email);
    const document = normalizeDigits(input.document);
    const password = hashPassword(input.password);

    await dynamoDbDocumentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: customersTableName,
              Item: {
                ...tenantDocLockKey(document),
                entityType: 'TENANT_DOC_LOCK',
                tenantId,
                document
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: customersTableName,
              Item: {
                ...emailLockKey(email),
                entityType: 'USER_EMAIL_LOCK',
                userId,
                tenantId,
                email
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: customersTableName,
              Item: {
                ...tenantKey(tenantId),
                GSI2PK: 'ENTITY#TENANT',
                GSI2SK: `${now}#${tenantId}`,
                entityType: 'TENANT',
                id: tenantId,
                personType: input.personType,
                document,
                legalName: input.legalName,
                tradeName: input.tradeName,
                email,
                phone: input.phone,
                planCode: 'START',
                questionnaireCreditsBalance: 75,
                address: input.address,
                createdAt: now,
                updatedAt: now
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: customersTableName,
              Item: {
                ...userKey(userId),
                GSI2PK: `TENANT#${tenantId}#USER`,
                GSI2SK: `${now}#${userId}`,
                entityType: 'USER',
                id: userId,
                tenantId,
                name: input.legalName,
                email,
                role: 'ROLE_CUSTOMER',
                passwordHash: password.hash,
                passwordSalt: password.salt,
                createdAt: now,
                updatedAt: now
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          }
        ]
      })
    );

    return {
      userId,
      tenantId,
      userName: input.legalName,
      tenantName: input.tradeName || input.legalName,
      email
    };
  }

  async authenticate(emailInput: string, passwordInput: string): Promise<CustomerSession | null> {
    const email = normalizeEmail(emailInput);
    const emailLock = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: customersTableName,
        Key: emailLockKey(email)
      })
    );

    const userId = emailLock.Item?.userId as string | undefined;
    if (!userId) {
      return null;
    }

    const userOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: customersTableName,
        Key: userKey(userId)
      })
    );

    const user = userOutput.Item as
      | { id: string; tenantId: string; name: string; email: string; passwordHash: string; passwordSalt: string }
      | undefined;
    if (!user) {
      return null;
    }

    if (!verifyPassword(passwordInput, user.passwordHash, user.passwordSalt)) {
      return null;
    }

    const tenantOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: customersTableName,
        Key: tenantKey(user.tenantId)
      })
    );
    const tenant = tenantOutput.Item as { legalName: string; tradeName?: string } | undefined;

    return {
      userId: user.id,
      tenantId: user.tenantId,
      userName: user.name,
      tenantName: tenant?.tradeName || tenant?.legalName || user.name,
      email: user.email
    };
  }

  async getProfile(tenantId: string): Promise<CustomerProfile | null> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: customersTableName,
        Key: tenantKey(tenantId)
      })
    );

    if (!output.Item) {
      return null;
    }

    const item = output.Item as Omit<CustomerProfile, 'tenantId'> & { id: string };
    return {
      tenantId: item.id,
      planCode: item.planCode ?? 'START',
      questionnaireCreditsBalance: Number(item.questionnaireCreditsBalance ?? 75),
      personType: item.personType,
      document: item.document,
      legalName: item.legalName,
      tradeName: item.tradeName,
      email: item.email,
      phone: item.phone,
      address: item.address,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }

  async updateProfile(tenantId: string, payload: Partial<CustomerProfile>): Promise<CustomerProfile | null> {
    const current = await this.getProfile(tenantId);
    if (!current) {
      return null;
    }

    const currentEmail = normalizeEmail(current.email);
    const currentDocument = normalizeDigits(current.document);

    const next = {
      ...current,
      ...payload,
      tenantId,
      planCode: current.planCode ?? 'START',
      questionnaireCreditsBalance: current.questionnaireCreditsBalance ?? 75,
      email: normalizeEmail(String(payload.email ?? current.email)),
      document: normalizeDigits(String(payload.document ?? current.document)),
      updatedAt: new Date().toISOString()
    };

    const userId = await this.findTenantOwnerUserId(tenantId);
    const user = await this.getUserById(userId);
    if (!user) {
      throw new Error('Tenant user not found');
    }

    const operations: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
        Put: {
          TableName: customersTableName,
          Item: {
            ...tenantKey(tenantId),
            GSI2PK: 'ENTITY#TENANT',
            GSI2SK: `${current.createdAt}#${tenantId}`,
            entityType: 'TENANT',
            id: tenantId,
            personType: next.personType,
            document: next.document,
            legalName: next.legalName,
            tradeName: next.tradeName,
            email: next.email,
            phone: next.phone,
            planCode: next.planCode ?? 'START',
            questionnaireCreditsBalance: next.questionnaireCreditsBalance ?? 75,
            address: next.address,
            createdAt: current.createdAt,
            updatedAt: next.updatedAt
          },
          ConditionExpression: 'attribute_exists(PK)'
        }
      },
      {
        Put: {
          TableName: customersTableName,
          Item: {
            ...userKey(userId),
            GSI2PK: `TENANT#${tenantId}#USER`,
            GSI2SK: `${user.createdAt}#${userId}`,
            entityType: 'USER',
            id: user.id,
            tenantId: user.tenantId,
            name: next.legalName,
            email: next.email,
            role: 'ROLE_CUSTOMER',
            passwordHash: user.passwordHash,
            passwordSalt: user.passwordSalt,
            createdAt: user.createdAt,
            updatedAt: next.updatedAt
          },
          ConditionExpression: 'attribute_exists(PK)'
        }
      }
    ];

    if (next.document !== currentDocument) {
      operations.push({
        Put: {
          TableName: customersTableName,
          Item: {
            ...tenantDocLockKey(next.document),
            entityType: 'TENANT_DOC_LOCK',
            tenantId,
            document: next.document
          },
          ConditionExpression: 'attribute_not_exists(PK)'
        }
      });
      operations.push({
        Delete: {
          TableName: customersTableName,
          Key: tenantDocLockKey(currentDocument)
        }
      });
    }

    if (next.email !== currentEmail) {
      operations.push({
        Put: {
          TableName: customersTableName,
          Item: {
            ...emailLockKey(next.email),
            entityType: 'USER_EMAIL_LOCK',
            userId,
            tenantId,
            email: next.email
          },
          ConditionExpression: 'attribute_not_exists(PK)'
        }
      });
      operations.push({
        Delete: {
          TableName: customersTableName,
          Key: emailLockKey(currentEmail)
        }
      });
    }

    await dynamoDbDocumentClient.send(
      new TransactWriteCommand({
        TransactItems: operations
      })
    );

    return next;
  }

  private async getUserById(
    userId: string
  ): Promise<
    | {
        id: string;
        tenantId: string;
        createdAt: string;
        passwordHash: string;
        passwordSalt: string;
      }
    | undefined
  > {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: customersTableName,
        Key: userKey(userId)
      })
    );

    const item = output.Item as
      | {
          id: string;
          tenantId: string;
          createdAt: string;
          passwordHash: string;
          passwordSalt: string;
        }
      | undefined;

    return item;
  }

  private async findTenantOwnerUserId(tenantId: string): Promise<string> {
    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: customersTableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#USER`
        },
        Limit: 1
      })
    );

    const userId = output.Items?.[0]?.id as string | undefined;
    if (!userId) {
      throw new Error('Tenant user not found');
    }
    return userId;
  }
}
