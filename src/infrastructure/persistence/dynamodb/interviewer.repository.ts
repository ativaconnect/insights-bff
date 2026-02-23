import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { hashPassword, verifyPassword } from '../../security/password-hasher';
import { dynamoDbDocumentClient, surveysTableName } from './dynamo-client';

export interface InterviewerProfile {
  id: string;
  tenantId: string;
  name: string;
  login: string;
  phone?: string;
  email?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

interface InterviewerRecord extends InterviewerProfile {
  passwordHash: string;
  passwordSalt: string;
}

export interface InterviewerCreateInput {
  name: string;
  login: string;
  password: string;
  phone?: string;
  email?: string;
}

export interface InterviewerUpdateInput {
  name?: string;
  login?: string;
  password?: string;
  phone?: string;
  email?: string;
}

export interface InterviewerUsage {
  assignedSurveyCount: number;
  responseCount: number;
}

export interface InterviewerSession {
  interviewerId: string;
  tenantId: string;
  interviewerName: string;
  login: string;
}

const interviewerKey = (tenantId: string, interviewerId: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `INTERVIEWER#${interviewerId}`
});

const interviewerLoginLockKey = (login: string) => ({
  PK: `INTERVIEWERLOGIN#${normalizeLogin(login)}`,
  SK: 'LOCK'
});

const normalizeLogin = (value: string): string => value.trim().toLowerCase();

export class InterviewerRepository {
  async list(tenantId: string): Promise<InterviewerProfile[]> {
    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: surveysTableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':sk': 'INTERVIEWER#'
        },
        ScanIndexForward: false
      })
    );

    return (output.Items ?? []).map((item) => this.toProfile(item as InterviewerRecord));
  }

  async getById(tenantId: string, interviewerId: string): Promise<InterviewerProfile | null> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: surveysTableName,
        Key: interviewerKey(tenantId, interviewerId)
      })
    );

    const record = output.Item as InterviewerRecord | undefined;
    return record ? this.toProfile(record) : null;
  }

  async create(tenantId: string, input: InterviewerCreateInput): Promise<InterviewerProfile> {
    const now = new Date().toISOString();
    const interviewerId = uuid();
    const login = normalizeLogin(input.login);
    const password = hashPassword(input.password);

    const record: InterviewerRecord = {
      id: interviewerId,
      tenantId,
      name: input.name,
      login,
      phone: input.phone,
      email: input.email,
      status: 'active',
      passwordHash: password.hash,
      passwordSalt: password.salt,
      createdAt: now,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: surveysTableName,
              Item: {
                ...interviewerLoginLockKey(login),
                entityType: 'INTERVIEWER_LOGIN_LOCK',
                tenantId,
                interviewerId,
                login
              },
              ConditionExpression: 'attribute_not_exists(PK)'
            }
          },
          {
            Put: {
              TableName: surveysTableName,
              Item: {
                ...interviewerKey(tenantId, interviewerId),
                GSI2PK: `TENANT#${tenantId}#INTERVIEWER`,
                GSI2SK: `${now}#${interviewerId}`,
                entityType: 'INTERVIEWER',
                ...record
              },
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            }
          }
        ]
      })
    );

    return this.toProfile(record);
  }

  async authenticate(loginInput: string, passwordInput: string): Promise<InterviewerSession | null> {
    const login = normalizeLogin(loginInput);
    const lockOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: surveysTableName,
        Key: interviewerLoginLockKey(login)
      })
    );

    const tenantId = lockOutput.Item?.tenantId as string | undefined;
    const interviewerId = lockOutput.Item?.interviewerId as string | undefined;
    if (!tenantId || !interviewerId) {
      return null;
    }

    const interviewerOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: surveysTableName,
        Key: interviewerKey(tenantId, interviewerId)
      })
    );
    const interviewer = interviewerOutput.Item as InterviewerRecord | undefined;
    if (!interviewer || interviewer.status !== 'active') {
      return null;
    }

    if (!verifyPassword(passwordInput, interviewer.passwordHash, interviewer.passwordSalt)) {
      return null;
    }

    return {
      interviewerId: interviewer.id,
      tenantId: interviewer.tenantId,
      interviewerName: interviewer.name,
      login: interviewer.login
    };
  }

  async update(tenantId: string, interviewerId: string, input: InterviewerUpdateInput): Promise<InterviewerProfile | null> {
    const current = await this.getRecordById(tenantId, interviewerId);
    if (!current) {
      return null;
    }

    const nextLogin = input.login ? normalizeLogin(input.login) : current.login;
    const password = input.password ? hashPassword(input.password) : null;
    const now = new Date().toISOString();

    const next: InterviewerRecord = {
      ...current,
      name: input.name ?? current.name,
      login: nextLogin,
      phone: input.phone ?? current.phone,
      email: input.email ?? current.email,
      passwordHash: password?.hash ?? current.passwordHash,
      passwordSalt: password?.salt ?? current.passwordSalt,
      updatedAt: now
    };

    if (nextLogin !== current.login) {
      await dynamoDbDocumentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: surveysTableName,
                Item: {
                  ...interviewerLoginLockKey(nextLogin),
                  entityType: 'INTERVIEWER_LOGIN_LOCK',
                  tenantId,
                  interviewerId,
                  login: nextLogin
                },
                ConditionExpression: 'attribute_not_exists(PK)'
              }
            },
            {
              Put: {
                TableName: surveysTableName,
                Item: {
                  ...interviewerKey(tenantId, interviewerId),
                  GSI2PK: `TENANT#${tenantId}#INTERVIEWER`,
                  GSI2SK: `${current.createdAt}#${interviewerId}`,
                  entityType: 'INTERVIEWER',
                  ...next
                },
                ConditionExpression: 'attribute_exists(PK)'
              }
            },
            {
              Delete: {
                TableName: surveysTableName,
                Key: interviewerLoginLockKey(current.login)
              }
            }
          ]
        })
      );
    } else {
      await dynamoDbDocumentClient.send(
        new PutCommand({
          TableName: surveysTableName,
          Item: {
            ...interviewerKey(tenantId, interviewerId),
            GSI2PK: `TENANT#${tenantId}#INTERVIEWER`,
            GSI2SK: `${current.createdAt}#${interviewerId}`,
            entityType: 'INTERVIEWER',
            ...next
          },
          ConditionExpression: 'attribute_exists(PK)'
        })
      );
    }

    return this.toProfile(next);
  }

  async setStatus(
    tenantId: string,
    interviewerId: string,
    status: 'active' | 'inactive'
  ): Promise<InterviewerProfile | null> {
    const current = await this.getRecordById(tenantId, interviewerId);
    if (!current) {
      return null;
    }

    const next: InterviewerRecord = {
      ...current,
      status,
      updatedAt: new Date().toISOString()
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: surveysTableName,
        Item: {
          ...interviewerKey(tenantId, interviewerId),
          GSI2PK: `TENANT#${tenantId}#INTERVIEWER`,
          GSI2SK: `${current.createdAt}#${interviewerId}`,
          entityType: 'INTERVIEWER',
          ...next
        },
        ConditionExpression: 'attribute_exists(PK)'
      })
    );

    return this.toProfile(next);
  }

  async getUsage(tenantId: string, interviewerId: string): Promise<InterviewerUsage> {
    let assignedSurveyCount = 0;
    let surveyKey: Record<string, unknown> | undefined;

    do {
      const surveys = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: surveysTableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `TENANT#${tenantId}`,
            ':sk': 'SURVEY#'
          },
          ExclusiveStartKey: surveyKey
        })
      );

      for (const item of surveys.Items ?? []) {
        const assignments = (item['interviewerAssignments'] as Array<{ interviewerId?: string }> | undefined) ?? [];
        if (assignments.some((entry) => entry.interviewerId === interviewerId)) {
          assignedSurveyCount += 1;
        }
      }

      surveyKey = surveys.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (surveyKey);

    let responseCount = 0;
    let responseKey: Record<string, unknown> | undefined;

    do {
      const responses = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: surveysTableName,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': `TENANT#${tenantId}#SURVEY#RESPONSES`
          },
          ExclusiveStartKey: responseKey
        })
      );

      for (const item of responses.Items ?? []) {
        const metadata = (item['metadata'] as Record<string, unknown> | undefined) ?? {};
        if (metadata['interviewerId'] === interviewerId) {
          responseCount += 1;
        }
      }

      responseKey = responses.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (responseKey);

    return {
      assignedSurveyCount,
      responseCount
    };
  }

  async removeIfUnused(tenantId: string, interviewerId: string): Promise<'deleted' | 'in_use' | 'not_found'> {
    const current = await this.getRecordById(tenantId, interviewerId);
    if (!current) {
      return 'not_found';
    }

    const usage = await this.getUsage(tenantId, interviewerId);
    if (usage.assignedSurveyCount > 0 || usage.responseCount > 0) {
      return 'in_use';
    }

    await dynamoDbDocumentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: surveysTableName,
              Key: interviewerKey(tenantId, interviewerId),
              ConditionExpression: 'attribute_exists(PK)'
            }
          },
          {
            Delete: {
              TableName: surveysTableName,
              Key: interviewerLoginLockKey(current.login)
            }
          }
        ]
      })
    );

    return 'deleted';
  }

  private async getRecordById(tenantId: string, interviewerId: string): Promise<InterviewerRecord | null> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: surveysTableName,
        Key: interviewerKey(tenantId, interviewerId)
      })
    );

    return (output.Item as InterviewerRecord | undefined) ?? null;
  }

  private toProfile(record: InterviewerRecord): InterviewerProfile {
    return {
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      login: record.login,
      phone: record.phone,
      email: record.email,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
}
