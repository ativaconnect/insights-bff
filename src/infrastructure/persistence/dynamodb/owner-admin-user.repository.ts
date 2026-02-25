import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import {
  type OwnerAdminAccessLevel,
  type OwnerAdminPermission,
  normalizeOwnerAdminPermissions,
  resolveOwnerPermissionsByAccessLevel
} from '../../../core/domain/value-objects/admin-permissions';
import { hashPassword, verifyPassword } from '../../security/password-hasher';
import { dynamoDbDocumentClient, plansTableName } from './dynamo-client';

const normalizeEmail = (value: string): string => String(value ?? '').trim().toLowerCase();

const userKey = (userId: string) => ({ PK: `OWNER_USER#${userId}`, SK: 'PROFILE' });
const emailLockKey = (email: string) => ({ PK: `OWNER_USER_EMAIL#${normalizeEmail(email)}`, SK: 'LOCK' });

export interface OwnerAdminUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  accessLevel: OwnerAdminAccessLevel;
  permissions: OwnerAdminPermission[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface OwnerAdminUserStored extends OwnerAdminUser {
  passwordHash: string;
  passwordSalt: string;
}

const normalizeAccessLevel = (input: unknown): OwnerAdminAccessLevel => {
  const value = String(input ?? '').trim().toUpperCase();
  if (value === 'OWNER' || value === 'OPERATIONS' || value === 'FINANCE' || value === 'VIEWER' || value === 'CUSTOM') {
    return value;
  }
  return 'VIEWER';
};

const stripPassword = (stored: OwnerAdminUserStored): OwnerAdminUser => ({
  id: stored.id,
  tenantId: stored.tenantId,
  name: stored.name,
  email: stored.email,
  accessLevel: stored.accessLevel,
  permissions: stored.permissions,
  active: stored.active,
  createdAt: stored.createdAt,
  updatedAt: stored.updatedAt,
  createdBy: stored.createdBy
});

export class OwnerAdminUserRepository {
  private normalizeStored(item: Record<string, unknown>): OwnerAdminUserStored {
    const accessLevel = normalizeAccessLevel(item.accessLevel);
    return {
      id: String(item.id),
      tenantId: String(item.tenantId ?? 'tenant-owner-admin'),
      name: String(item.name),
      email: normalizeEmail(String(item.email)),
      accessLevel,
      permissions:
        accessLevel === 'CUSTOM'
          ? normalizeOwnerAdminPermissions(item.permissions)
          : resolveOwnerPermissionsByAccessLevel(accessLevel),
      active: Boolean(item.active ?? true),
      createdAt: String(item.createdAt ?? new Date().toISOString()),
      updatedAt: String(item.updatedAt ?? new Date().toISOString()),
      createdBy: String(item.createdBy ?? 'system'),
      passwordHash: String(item.passwordHash ?? ''),
      passwordSalt: String(item.passwordSalt ?? '')
    };
  }

  async ensureBootstrapAdmin(input: {
    tenantId: string;
    name: string;
    email: string;
    password: string;
  }): Promise<OwnerAdminUser> {
    const existing = await this.getByEmail(input.email);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const id = uuid();
    const password = hashPassword(input.password);
    const email = normalizeEmail(input.email);
    const item: OwnerAdminUserStored = {
      id,
      tenantId: input.tenantId,
      name: String(input.name ?? 'Administrador').trim() || 'Administrador',
      email,
      accessLevel: 'OWNER',
      permissions: resolveOwnerPermissionsByAccessLevel('OWNER'),
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy: 'system-bootstrap',
      passwordHash: password.hash,
      passwordSalt: password.salt
    };

    try {
      await dynamoDbDocumentClient.send(
        new PutCommand({
          TableName: plansTableName,
          Item: {
            ...emailLockKey(email),
            entityType: 'OWNER_ADMIN_USER_EMAIL_LOCK',
            userId: id,
            createdAt: now
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        })
      );
      await dynamoDbDocumentClient.send(
        new PutCommand({
          TableName: plansTableName,
          Item: {
            ...userKey(id),
            GSI2PK: 'ENTITY#OWNER_ADMIN_USER',
            GSI2SK: `${now}#${id}`,
            entityType: 'OWNER_ADMIN_USER',
            ...item
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        })
      );
      return stripPassword(item);
    } catch {
      const fallback = await this.getByEmail(email);
      if (!fallback) {
        throw new Error('Nao foi possivel inicializar usuario admin owner.');
      }
      return fallback;
    }
  }

  async ensureOwnerAccessBootstrap(input: {
    tenantId: string;
    name: string;
    email: string;
    password: string;
  }): Promise<OwnerAdminUser> {
    const users = await this.listUsers();
    const activeOwner = users.find((user) => user.active && user.accessLevel === 'OWNER');
    if (activeOwner) {
      return activeOwner;
    }

    const bootstrapEmail = normalizeEmail(input.email);
    const bootstrap = await this.getByEmail(bootstrapEmail);
    if (!bootstrap) {
      return this.ensureBootstrapAdmin(input);
    }

    const updated = await this.updateUser(bootstrap.id, {
      actorId: 'system-bootstrap',
      name: String(input.name ?? '').trim() || 'Administrador Principal',
      password: String(input.password ?? '').trim() || 'admin123',
      accessLevel: 'OWNER',
      active: true
    });

    if (!updated) {
      throw new Error('Nao foi possivel garantir bootstrap owner admin.');
    }
    return updated;
  }

  async authenticate(emailInput: string, passwordInput: string): Promise<OwnerAdminUser | null> {
    const lockOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: emailLockKey(emailInput)
      })
    );
    const userId = lockOutput.Item?.userId as string | undefined;
    if (!userId) {
      return null;
    }

    const userOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: userKey(userId)
      })
    );
    if (!userOutput.Item) {
      return null;
    }

    const user = this.normalizeStored(userOutput.Item as Record<string, unknown>);
    if (!user.active) {
      return null;
    }
    if (!verifyPassword(passwordInput, user.passwordHash, user.passwordSalt)) {
      return null;
    }
    return stripPassword(user);
  }

  async getByEmail(emailInput: string): Promise<OwnerAdminUser | null> {
    const lockOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: emailLockKey(emailInput)
      })
    );
    const userId = lockOutput.Item?.userId as string | undefined;
    if (!userId) {
      return null;
    }
    const userOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: userKey(userId)
      })
    );
    if (!userOutput.Item) {
      return null;
    }
    return stripPassword(this.normalizeStored(userOutput.Item as Record<string, unknown>));
  }

  async listUsers(): Promise<OwnerAdminUser[]> {
    const items: OwnerAdminUser[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: plansTableName,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': 'ENTITY#OWNER_ADMIN_USER'
          },
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      for (const item of output.Items ?? []) {
        items.push(stripPassword(this.normalizeStored(item as Record<string, unknown>)));
      }

      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createUser(input: {
    actorId: string;
    tenantId: string;
    name: string;
    email: string;
    password: string;
    accessLevel: OwnerAdminAccessLevel;
    permissions?: OwnerAdminPermission[];
    active?: boolean;
  }): Promise<OwnerAdminUser> {
    const now = new Date().toISOString();
    const id = uuid();
    const email = normalizeEmail(input.email);
    const password = hashPassword(input.password);
    const accessLevel = normalizeAccessLevel(input.accessLevel);
    const permissions = resolveOwnerPermissionsByAccessLevel(accessLevel, input.permissions);

    const item: OwnerAdminUserStored = {
      id,
      tenantId: input.tenantId,
      name: String(input.name ?? '').trim(),
      email,
      accessLevel,
      permissions,
      active: input.active !== false,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      passwordHash: password.hash,
      passwordSalt: password.salt
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: plansTableName,
        Item: {
          ...emailLockKey(email),
          entityType: 'OWNER_ADMIN_USER_EMAIL_LOCK',
          userId: id,
          createdAt: now
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      })
    );

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: plansTableName,
        Item: {
          ...userKey(id),
          GSI2PK: 'ENTITY#OWNER_ADMIN_USER',
          GSI2SK: `${now}#${id}`,
          entityType: 'OWNER_ADMIN_USER',
          ...item
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      })
    );

    return stripPassword(item);
  }

  async updateUser(
    userId: string,
    input: {
      actorId: string;
      name?: string;
      password?: string;
      accessLevel?: OwnerAdminAccessLevel;
      permissions?: OwnerAdminPermission[];
      active?: boolean;
    }
  ): Promise<OwnerAdminUser | null> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: userKey(userId)
      })
    );
    if (!output.Item) {
      return null;
    }

    const current = this.normalizeStored(output.Item as Record<string, unknown>);
    const accessLevel = input.accessLevel ? normalizeAccessLevel(input.accessLevel) : current.accessLevel;
    const nextPermissions = input.accessLevel || input.permissions
      ? resolveOwnerPermissionsByAccessLevel(accessLevel, input.permissions)
      : current.permissions;

    const next: OwnerAdminUserStored = {
      ...current,
      name: input.name ? String(input.name).trim() : current.name,
      active: input.active ?? current.active,
      accessLevel,
      permissions: nextPermissions,
      updatedAt: new Date().toISOString(),
      passwordHash: current.passwordHash,
      passwordSalt: current.passwordSalt
    };

    if (input.password && String(input.password).trim()) {
      const password = hashPassword(String(input.password).trim());
      next.passwordHash = password.hash;
      next.passwordSalt = password.salt;
    }

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: plansTableName,
        Item: {
          ...userKey(userId),
          GSI2PK: 'ENTITY#OWNER_ADMIN_USER',
          GSI2SK: `${current.createdAt}#${userId}`,
          entityType: 'OWNER_ADMIN_USER',
          ...next
        },
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)'
      })
    );

    return stripPassword(next);
  }
}
