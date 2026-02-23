import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { customersTableName, dynamoDbDocumentClient } from '../persistence/dynamodb/dynamo-client';

interface GuardState {
  failures: number;
  firstFailureAtEpoch: number;
  lockUntilEpoch?: number;
}

export interface LoginGuardEvaluation {
  blocked: boolean;
  retryAfterSeconds: number;
  requiresCaptcha: boolean;
}

const LOGIN_GUARD_SK = 'STATE';
const CAPTCHA_THRESHOLD = 3;
const DEFAULT_WINDOW_SECONDS = 15 * 60;
const DEFAULT_LOCK_SECONDS = 15 * 60;
const DEFAULT_MAX_ATTEMPTS_PER_LOGIN = 5;
const DEFAULT_MAX_ATTEMPTS_PER_IP = 20;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const windowSeconds = toPositiveInt(process.env.LOGIN_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS);
const lockSeconds = toPositiveInt(process.env.LOGIN_LOCK_SECONDS, DEFAULT_LOCK_SECONDS);
const maxAttemptsPerLogin = toPositiveInt(process.env.LOGIN_MAX_ATTEMPTS_PER_LOGIN, DEFAULT_MAX_ATTEMPTS_PER_LOGIN);
const maxAttemptsPerIp = toPositiveInt(process.env.LOGIN_MAX_ATTEMPTS_PER_IP, DEFAULT_MAX_ATTEMPTS_PER_IP);
const ttlSeconds = toPositiveInt(process.env.LOGIN_GUARD_TTL_SECONDS, DEFAULT_TTL_SECONDS);

const toLoginKey = (loginId: string): string => `AUTH#LOGIN#${loginId.trim().toLowerCase()}`;
const toIpKey = (ip: string): string => `AUTH#IP#${ip.trim()}`;

const key = (pk: string) => ({ PK: pk, SK: LOGIN_GUARD_SK });

const readState = async (pk: string): Promise<GuardState | null> => {
  const output = await dynamoDbDocumentClient.send(
    new GetCommand({
      TableName: customersTableName,
      Key: key(pk)
    })
  );
  if (!output.Item) {
    return null;
  }

  return {
    failures: Number(output.Item.failures ?? 0),
    firstFailureAtEpoch: Number(output.Item.firstFailureAtEpoch ?? 0),
    lockUntilEpoch: output.Item.lockUntilEpoch ? Number(output.Item.lockUntilEpoch) : undefined
  };
};

const writeState = async (pk: string, state: GuardState, nowEpoch: number) => {
  await dynamoDbDocumentClient.send(
    new PutCommand({
      TableName: customersTableName,
      Item: {
        ...key(pk),
        entityType: 'AUTH_LOGIN_GUARD',
        failures: state.failures,
        firstFailureAtEpoch: state.firstFailureAtEpoch,
        lockUntilEpoch: state.lockUntilEpoch,
        updatedAt: new Date(nowEpoch * 1000).toISOString(),
        ttlEpoch: nowEpoch + ttlSeconds
      }
    })
  );
};

const clearState = async (pk: string) => {
  await dynamoDbDocumentClient.send(
    new DeleteCommand({
      TableName: customersTableName,
      Key: key(pk)
    })
  );
};

const evaluateOne = (state: GuardState | null, nowEpoch: number): LoginGuardEvaluation => {
  if (!state) {
    return { blocked: false, retryAfterSeconds: 0, requiresCaptcha: false };
  }

  const lockUntil = state.lockUntilEpoch ?? 0;
  if (lockUntil > nowEpoch) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, lockUntil - nowEpoch),
      requiresCaptcha: true
    };
  }

  const inWindow = state.firstFailureAtEpoch > 0 && nowEpoch - state.firstFailureAtEpoch <= windowSeconds;
  return {
    blocked: false,
    retryAfterSeconds: 0,
    requiresCaptcha: inWindow && state.failures >= CAPTCHA_THRESHOLD
  };
};

const mergeEvaluation = (left: LoginGuardEvaluation, right: LoginGuardEvaluation): LoginGuardEvaluation => ({
  blocked: left.blocked || right.blocked,
  retryAfterSeconds: Math.max(left.retryAfterSeconds, right.retryAfterSeconds),
  requiresCaptcha: left.requiresCaptcha || right.requiresCaptcha
});

const nextFailureState = (current: GuardState | null, nowEpoch: number, maxAttempts: number): GuardState => {
  if (!current) {
    return { failures: 1, firstFailureAtEpoch: nowEpoch };
  }

  const lockUntil = current.lockUntilEpoch ?? 0;
  if (lockUntil > nowEpoch) {
    return current;
  }

  const inWindow = current.firstFailureAtEpoch > 0 && nowEpoch - current.firstFailureAtEpoch <= windowSeconds;
  const failures = inWindow ? current.failures + 1 : 1;
  const firstFailureAtEpoch = inWindow ? current.firstFailureAtEpoch : nowEpoch;
  const lockUntilEpoch = failures >= maxAttempts ? nowEpoch + lockSeconds : undefined;

  return {
    failures,
    firstFailureAtEpoch,
    lockUntilEpoch
  };
};

export class LoginGuardService {
  async evaluate(loginId: string, sourceIp?: string): Promise<LoginGuardEvaluation> {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const loginPk = toLoginKey(loginId);
    const ipPk = sourceIp?.trim() ? toIpKey(sourceIp) : null;

    const [loginState, ipState] = await Promise.all([
      readState(loginPk),
      ipPk ? readState(ipPk) : Promise.resolve(null)
    ]);

    const loginEval = evaluateOne(loginState, nowEpoch);
    const ipEval = evaluateOne(ipState, nowEpoch);
    return mergeEvaluation(loginEval, ipEval);
  }

  async registerFailure(loginId: string, sourceIp?: string): Promise<void> {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const loginPk = toLoginKey(loginId);
    const ipPk = sourceIp?.trim() ? toIpKey(sourceIp) : null;

    const [loginState, ipState] = await Promise.all([
      readState(loginPk),
      ipPk ? readState(ipPk) : Promise.resolve(null)
    ]);

    const tasks: Array<Promise<unknown>> = [
      writeState(loginPk, nextFailureState(loginState, nowEpoch, maxAttemptsPerLogin), nowEpoch)
    ];
    if (ipPk) {
      tasks.push(writeState(ipPk, nextFailureState(ipState, nowEpoch, maxAttemptsPerIp), nowEpoch));
    }
    await Promise.all(tasks);
  }

  async registerSuccess(loginId: string, sourceIp?: string): Promise<void> {
    const loginPk = toLoginKey(loginId);
    const ipPk = sourceIp?.trim() ? toIpKey(sourceIp) : null;
    const tasks: Array<Promise<unknown>> = [clearState(loginPk)];
    if (ipPk) {
      tasks.push(clearState(ipPk));
    }
    await Promise.all(tasks);
  }
}
