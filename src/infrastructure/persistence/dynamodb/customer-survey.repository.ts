import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { dynamoDbDocumentClient, surveysTableName } from './dynamo-client';

export type SurveyQuestionType = 'OPEN_TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'MULTI_CHOICE_MIN';

export interface SurveyOption {
  id: string;
  label: string;
  nextQuestionId?: string;
  fixed?: boolean;
}

export interface SurveyCondition {
  sourceQuestionId: string;
  operator: 'equals' | 'includes';
  value: string;
}

export interface SurveyConditionGroup {
  mode: 'ALL' | 'ANY';
  rules: SurveyCondition[];
}

export interface SurveyQuestion {
  id: string;
  order: number;
  title: string;
  helpText?: string;
  type: SurveyQuestionType;
  options?: SurveyOption[];
  minSelections?: number;
  required: boolean;
  randomizeOptions?: boolean;
  condition?: SurveyCondition;
  conditions?: SurveyConditionGroup;
}

export interface SurveyInterviewerAssignment {
  interviewerId: string;
  maxForms: number;
  periodStart: string;
  periodEnd: string;
}

export interface SurveyWaveInterviewerAssignment {
  interviewerId: string;
  maxForms: number;
}

export interface SurveyWave {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  interviewerAssignments: SurveyWaveInterviewerAssignment[];
}

export interface SurveyLocationCapture {
  captureEnabled: boolean;
  required?: boolean;
  precision?: 'approx' | 'exact';
  city?: string;
  state?: string;
}

export interface SurveyKioskSettings {
  enabled: boolean;
  requireConsent?: boolean;
  consentText?: string;
  autoResetSeconds?: number;
}

export interface SurveyQuotaRule {
  id: string;
  name: string;
  questionId: string;
  optionId: string;
  maxResponses: number;
}

export interface CustomerSurvey {
  id: string;
  tenantId: string;
  ownerTenantId: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'archived';
  audience?: 'B2B' | 'B2C' | 'Mixed';
  questions: SurveyQuestion[];
  quotaRules?: SurveyQuotaRule[];
  interviewerAssignments?: SurveyInterviewerAssignment[];
  waves?: SurveyWave[];
  locationCapture?: SurveyLocationCapture;
  kioskSettings?: SurveyKioskSettings;
  responsesCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyGeoPoint {
  lat: number;
  lng: number;
  accuracyMeters?: number;
}

export interface SurveyResponseMetadata extends Record<string, unknown> {
  interviewerId?: string;
  deviceId?: string;
  location?: SurveyGeoPoint;
}

export interface SurveyResponseRecord {
  id: string;
  clientResponseId: string;
  surveyId: string;
  tenantId: string;
  answers: Record<string, unknown>;
  metadata?: SurveyResponseMetadata;
  submittedAt: string;
}

interface SurveyResponseLockRecord {
  PK: string;
  SK: string;
  entityType: string;
  tenantId: string;
  surveyId: string;
  clientResponseId: string;
  responsePk: string;
  responseSk: string;
  createdAt: string;
  archivedAt?: string;
}

export interface SurveyAnalyticsSnapshotData {
  version: string;
  tenantId: string;
  surveyId: string;
  responsesCount: number;
  sourceUpdatedAt: string;
  generatedAt: string;
  heatmap: Array<{ lat: number; lng: number; count: number }>;
}

export class SurveySubmissionError extends Error {
  constructor(
    public readonly code:
      | 'INTERVIEWER_NOT_ALLOWED'
      | 'INTERVIEWER_QUOTA_REACHED'
      | 'LOCATION_REQUIRED'
      | 'PLAN_LIMIT_REACHED'
      | 'SURVEY_QUOTA_REACHED',
    message: string
  ) {
    super(message);
    this.name = 'SurveySubmissionError';
  }
}

const surveyKey = (tenantId: string, surveyId: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `SURVEY#${surveyId}`
});

const responseKey = (surveyId: string, responseId: string, submittedAt: string) => ({
  PK: `SURVEY#${surveyId}`,
  SK: `RESPONSE#${submittedAt}#${responseId}`
});

const responseLockKey = (surveyId: string, clientResponseId: string) => ({
  PK: `SURVEY#${surveyId}`,
  SK: `RESPONSE_LOCK#${clientResponseId}`
});

const sanitizeCounterPart = (value: string): string => encodeURIComponent(String(value).trim());

const interviewerCounterKey = (
  surveyId: string,
  interviewerId: string,
  periodStart: string,
  periodEnd: string
) => ({
  PK: `SURVEY#${surveyId}`,
  SK: `COUNTER#INTERVIEWER#${sanitizeCounterPart(interviewerId)}#${sanitizeCounterPart(periodStart)}#${sanitizeCounterPart(periodEnd)}`
});

const quotaCounterKey = (surveyId: string, questionId: string, optionId: string) => ({
  PK: `SURVEY#${surveyId}`,
  SK: `COUNTER#QUOTA#${sanitizeCounterPart(questionId)}#${sanitizeCounterPart(optionId)}`
});

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const responseLockTtlDays = Number(process.env.SURVEY_RESPONSE_LOCK_TTL_DAYS ?? 120);
const toTtlEpoch = (baseIso: string): number => {
  const base = new Date(baseIso).getTime();
  if (!Number.isFinite(base)) {
    return Math.floor(Date.now() / 1000) + 120 * 24 * 60 * 60;
  }
  return Math.floor((base + Math.max(1, responseLockTtlDays) * 24 * 60 * 60 * 1000) / 1000);
};

const toDate = (value: string, boundary: 'start' | 'end' = 'start'): Date => {
  const raw = String(value ?? '').trim();
  if (dateOnlyPattern.test(raw)) {
    return boundary === 'start'
      ? new Date(`${raw}T00:00:00.000Z`)
      : new Date(`${raw}T23:59:59.999Z`);
  }
  return new Date(raw);
};

const isValidDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const clampGeo = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const toGeoPoint = (input: unknown): SurveyGeoPoint | undefined => {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const candidate = input as { lat?: unknown; lng?: unknown; accuracyMeters?: unknown };
  const lat = clampGeo(candidate.lat);
  const lng = clampGeo(candidate.lng);
  if (lat === null || lng === null) {
    return undefined;
  }

  const accuracyMeters = clampGeo(candidate.accuracyMeters);
  return {
    lat,
    lng,
    accuracyMeters: accuracyMeters === null ? undefined : accuracyMeters
  };
};

const encodeCursor = (value: Record<string, unknown> | undefined): string | undefined => {
  if (!value) return undefined;
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
};

const decodeCursor = (value: string | undefined): Record<string, unknown> | undefined => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

export class CustomerSurveyRepository {
  async list(tenantId: string): Promise<CustomerSurvey[]> {
    const items: CustomerSurvey[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: surveysTableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `TENANT#${tenantId}`,
            ':sk': 'SURVEY#'
          },
          ScanIndexForward: false,
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      items.push(...(output.Items ?? []).map((item) => item as CustomerSurvey));
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items;
  }

  async listAvailableForInterviewer(
    tenantId: string,
    interviewerId: string,
    nowIso: string = new Date().toISOString()
  ): Promise<CustomerSurvey[]> {
    const surveys = await this.list(tenantId);
    const now = toDate(nowIso);
    if (!isValidDate(now)) {
      return [];
    }

    const output: CustomerSurvey[] = [];
    for (const survey of surveys) {
      if (survey.status !== 'active') {
        continue;
      }

      const assignments = this.getEffectiveInterviewerAssignments(survey);
      const candidates = assignments.filter((item) => item.interviewerId === interviewerId);
      if (!candidates.length) {
        continue;
      }
      let available = false;
      for (const assignment of candidates) {
        const start = toDate(assignment.periodStart, 'start');
        const end = toDate(assignment.periodEnd, 'end');
        if (!isValidDate(start) || !isValidDate(end)) {
          continue;
        }
        if (now < start || now > end) {
          continue;
        }
        const count = await this.countInterviewerResponsesInPeriod(survey.id, interviewerId, start, end);
        if (count < assignment.maxForms) {
          available = true;
          break;
        }
      }
      if (!available) {
        continue;
      }

      output.push(survey);
    }

    return output;
  }

  async getById(tenantId: string, surveyId: string): Promise<CustomerSurvey | null> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: surveysTableName,
        Key: surveyKey(tenantId, surveyId)
      })
    );

    return (output.Item as CustomerSurvey | undefined) ?? null;
  }

  async create(
    tenantId: string,
    payload: Pick<
      CustomerSurvey,
      | 'name'
      | 'description'
      | 'status'
      | 'audience'
      | 'questions'
      | 'quotaRules'
      | 'interviewerAssignments'
      | 'waves'
      | 'locationCapture'
      | 'kioskSettings'
    >
  ): Promise<CustomerSurvey> {
    const now = new Date().toISOString();
    const survey: CustomerSurvey = {
      id: uuid(),
      tenantId,
      ownerTenantId: tenantId,
      name: payload.name,
      description: payload.description,
      status: payload.status,
      audience: payload.audience,
      questions: payload.questions,
      quotaRules: payload.quotaRules,
      interviewerAssignments: payload.interviewerAssignments,
      waves: payload.waves,
      locationCapture: payload.locationCapture,
      kioskSettings: payload.kioskSettings,
      responsesCount: 0,
      createdAt: now,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: surveysTableName,
        Item: {
          ...surveyKey(tenantId, survey.id),
          GSI2PK: `TENANT#${tenantId}#SURVEY`,
          GSI2SK: `${survey.createdAt}#${survey.id}`,
          entityType: 'SURVEY',
          ...survey
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      })
    );

    return survey;
  }

  async update(
    tenantId: string,
    surveyId: string,
    payload: Partial<
      Pick<
        CustomerSurvey,
        | 'name'
        | 'description'
        | 'status'
        | 'audience'
        | 'questions'
        | 'quotaRules'
        | 'interviewerAssignments'
        | 'waves'
        | 'locationCapture'
        | 'kioskSettings'
      >
    >
  ): Promise<CustomerSurvey | null> {
    const current = await this.getById(tenantId, surveyId);
    if (!current) {
      return null;
    }

    const next: CustomerSurvey = {
      ...current,
      ...payload,
      updatedAt: new Date().toISOString()
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: surveysTableName,
        Item: {
          ...surveyKey(tenantId, surveyId),
          GSI2PK: `TENANT#${tenantId}#SURVEY`,
          GSI2SK: `${current.createdAt}#${surveyId}`,
          entityType: 'SURVEY',
          ...next
        },
        ConditionExpression: 'attribute_exists(PK)'
      })
    );

    return next;
  }

  async addResponse(
    tenantId: string,
    surveyId: string,
    answers: Record<string, unknown>,
    metadata?: Record<string, unknown>,
    options?: {
      clientResponseId?: string;
      submittedAt?: string;
      interviewerId?: string;
      deviceId?: string;
      location?: SurveyGeoPoint;
      maxResponsesPerSurvey?: number;
      defaultCreditsBalance?: number;
    }
  ): Promise<SurveyResponseRecord | null> {
    const survey = await this.getById(tenantId, surveyId);
    if (!survey) {
      return null;
    }

    const responseId = uuid();
    const clientResponseId = options?.clientResponseId?.trim() || `${tenantId}-${surveyId}-${responseId}`;
    const submittedAt = options?.submittedAt ?? new Date().toISOString();

    const existingForClientId = await this.getResponseByClientResponseId(surveyId, clientResponseId);
    if (existingForClientId) {
      return existingForClientId;
    }

    const submittedAtDate = toDate(submittedAt);
    if (!isValidDate(submittedAtDate)) {
      throw new Error('invalid submittedAt');
    }

    const metadataLocation = toGeoPoint(options?.location ?? metadata?.location);
    if (survey.locationCapture?.captureEnabled && survey.locationCapture.required && !metadataLocation) {
      throw new SurveySubmissionError('LOCATION_REQUIRED', 'Localizacao obrigatoria para esta pesquisa.');
    }

    const maxResponsesPerSurvey = options?.maxResponsesPerSurvey;

    const resolvedInterviewerAssignment = this.resolveInterviewerAssignment(
      survey,
      options?.interviewerId,
      submittedAtDate
    );
    const matchedQuotaRules = this.resolveMatchedQuotaRules(survey, answers);
    const defaultCreditsBalance = Number(options?.defaultCreditsBalance ?? 0);
    const seedCredits = Number.isFinite(defaultCreditsBalance) && defaultCreditsBalance >= 0
      ? Math.floor(defaultCreditsBalance)
      : 0;

    const response: SurveyResponseRecord = {
      id: responseId,
      clientResponseId,
      surveyId,
      tenantId,
      answers,
      metadata: {
        ...metadata,
        interviewerId: options?.interviewerId,
        deviceId: options?.deviceId,
        location: metadataLocation
      },
      submittedAt
    };

    try {
      const surveyLimitUpdate = {
        Update: {
          TableName: surveysTableName,
          Key: surveyKey(tenantId, surveyId),
          UpdateExpression: 'SET responsesCount = if_not_exists(responsesCount, :zero) + :one',
          ConditionExpression:
            maxResponsesPerSurvey && maxResponsesPerSurvey > 0
              ? 'attribute_exists(PK) AND if_not_exists(responsesCount, :zero) < :maxResponses'
              : 'attribute_exists(PK)',
          ExpressionAttributeValues:
            maxResponsesPerSurvey && maxResponsesPerSurvey > 0
              ? {
                  ':zero': 0,
                  ':one': 1,
                  ':maxResponses': maxResponsesPerSurvey
                }
              : {
                  ':zero': 0,
                  ':one': 1
                }
        }
      };

      const interviewerCounterUpdate = resolvedInterviewerAssignment
        ? [
            {
              Update: {
                TableName: surveysTableName,
                Key: interviewerCounterKey(
                  surveyId,
                  resolvedInterviewerAssignment.interviewerId,
                  resolvedInterviewerAssignment.periodStart,
                  resolvedInterviewerAssignment.periodEnd
                ),
                UpdateExpression:
                  'SET #count = if_not_exists(#count, :zero) + :one, entityType = :entityType, surveyId = :surveyId, interviewerId = :interviewerId, periodStart = :periodStart, periodEnd = :periodEnd, updatedAt = :updatedAt',
                ConditionExpression: 'if_not_exists(#count, :zero) < :maxForms',
                ExpressionAttributeNames: {
                  '#count': 'count'
                },
                ExpressionAttributeValues: {
                  ':zero': 0,
                  ':one': 1,
                  ':maxForms': Number(resolvedInterviewerAssignment.maxForms),
                  ':entityType': 'SURVEY_COUNTER_INTERVIEWER',
                  ':surveyId': surveyId,
                  ':interviewerId': resolvedInterviewerAssignment.interviewerId,
                  ':periodStart': resolvedInterviewerAssignment.periodStart,
                  ':periodEnd': resolvedInterviewerAssignment.periodEnd,
                  ':updatedAt': new Date().toISOString()
                }
              }
            }
          ]
        : [];

      const quotaCounterUpdates = matchedQuotaRules.map((rule) => ({
        Update: {
          TableName: surveysTableName,
          Key: quotaCounterKey(surveyId, rule.questionId, rule.optionId),
          UpdateExpression:
            'SET #count = if_not_exists(#count, :zero) + :one, entityType = :entityType, surveyId = :surveyId, questionId = :questionId, optionId = :optionId, ruleName = :ruleName, updatedAt = :updatedAt',
          ConditionExpression: 'if_not_exists(#count, :zero) < :maxResponses',
          ExpressionAttributeNames: {
            '#count': 'count'
          },
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
            ':maxResponses': Number(rule.maxResponses),
            ':entityType': 'SURVEY_COUNTER_QUOTA',
            ':surveyId': surveyId,
            ':questionId': rule.questionId,
            ':optionId': rule.optionId,
            ':ruleName': rule.name,
            ':updatedAt': new Date().toISOString()
          }
        }
      }));

      await dynamoDbDocumentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            surveyLimitUpdate,
            ...interviewerCounterUpdate,
            ...quotaCounterUpdates,
            {
              Update: {
                TableName: surveysTableName,
                Key: {
                  PK: `TENANT#${tenantId}`,
                  SK: 'PROFILE'
                },
                UpdateExpression:
                  'SET questionnaireCreditsBalance = if_not_exists(questionnaireCreditsBalance, :seedCredits) - :one, updatedAt = :now',
                ConditionExpression:
                  'attribute_exists(PK) AND if_not_exists(questionnaireCreditsBalance, :seedCredits) >= :one',
                ExpressionAttributeValues: {
                  ':seedCredits': seedCredits,
                  ':one': 1,
                  ':now': new Date().toISOString()
                }
              }
            },
            {
              Put: {
                TableName: surveysTableName,
                Item: {
                  ...responseLockKey(surveyId, clientResponseId),
                  entityType: 'SURVEY_RESPONSE_LOCK',
                  tenantId,
                  surveyId,
                  clientResponseId,
                  responsePk: `SURVEY#${surveyId}`,
                  responseSk: `RESPONSE#${response.submittedAt}#${response.id}`,
                  createdAt: new Date().toISOString(),
                  ttlEpoch: toTtlEpoch(response.submittedAt)
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
              }
            },
            {
              Put: {
                TableName: surveysTableName,
                Item: {
                  ...responseKey(surveyId, response.id, response.submittedAt),
                  GSI2PK: `TENANT#${tenantId}#SURVEY#RESPONSES`,
                  GSI2SK: `${response.submittedAt}#${surveyId}#${response.id}`,
                  entityType: 'SURVEY_RESPONSE',
                  ...response
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
              }
            }
          ]
        })
      );
    } catch (error: unknown) {
      const errorName = (error as { name?: string }).name;
      if (errorName !== 'TransactionCanceledException') {
        throw error;
      }

      const existing = await this.getResponseByClientResponseId(surveyId, clientResponseId);
      if (existing) {
        return existing;
      }

      if (maxResponsesPerSurvey && maxResponsesPerSurvey > 0) {
        const surveyState = await this.getById(tenantId, surveyId);
        const count = Number(surveyState?.responsesCount ?? 0);
        if (Number.isFinite(count) && count >= maxResponsesPerSurvey) {
          throw new SurveySubmissionError(
            'PLAN_LIMIT_REACHED',
            `Limite de ${maxResponsesPerSurvey} respostas por pesquisa atingido para o seu plano.`
          );
        }
      }

      const tenantState = await dynamoDbDocumentClient.send(
        new GetCommand({
          TableName: surveysTableName,
          Key: {
            PK: `TENANT#${tenantId}`,
            SK: 'PROFILE'
          }
        })
      );
      const balance = Number(tenantState.Item?.questionnaireCreditsBalance ?? 0);
      if (!Number.isFinite(balance) || balance <= 0) {
        throw new SurveySubmissionError(
          'PLAN_LIMIT_REACHED',
          'Saldo de creditos insuficiente para registrar novas respostas.'
        );
      }

      if (resolvedInterviewerAssignment) {
        const interviewerCount = await this.getInterviewerCounterCount(
          surveyId,
          resolvedInterviewerAssignment.interviewerId,
          resolvedInterviewerAssignment.periodStart,
          resolvedInterviewerAssignment.periodEnd
        );
        if (interviewerCount >= Number(resolvedInterviewerAssignment.maxForms)) {
          throw new SurveySubmissionError('INTERVIEWER_QUOTA_REACHED', 'Cota de formularios do entrevistador atingida.');
        }
      }

      for (const rule of matchedQuotaRules) {
        const used = await this.getQuotaCounterCount(surveyId, rule.questionId, rule.optionId);
        if (used >= Number(rule.maxResponses)) {
          throw new SurveySubmissionError(
            'SURVEY_QUOTA_REACHED',
            `Quota atingida para "${rule.name}" (${rule.maxResponses}).`
          );
        }
      }

      throw error;
    }

    return response;
  }

  async addResponsesBatch(
    tenantId: string,
    surveyId: string,
    items: Array<{
      answers: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      clientResponseId?: string;
      submittedAt?: string;
      interviewerId?: string;
      deviceId?: string;
      location?: SurveyGeoPoint;
      maxResponsesPerSurvey?: number;
      defaultCreditsBalance?: number;
    }>
  ): Promise<SurveyResponseRecord[]> {
    const output: SurveyResponseRecord[] = [];

    for (const item of items) {
      const created = await this.addResponse(tenantId, surveyId, item.answers, item.metadata, {
        clientResponseId: item.clientResponseId,
        submittedAt: item.submittedAt,
        interviewerId: item.interviewerId,
        deviceId: item.deviceId,
        location: item.location,
        maxResponsesPerSurvey: item.maxResponsesPerSurvey,
        defaultCreditsBalance: item.defaultCreditsBalance
      });
      if (created) {
        output.push(created);
      }
    }

    return output;
  }

  async listResponses(tenantId: string, surveyId: string): Promise<SurveyResponseRecord[]> {
    const survey = await this.getById(tenantId, surveyId);
    if (!survey) {
      return [];
    }

    const items: SurveyResponseRecord[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: surveysTableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `SURVEY#${surveyId}`,
            ':sk': 'RESPONSE#'
          },
          ScanIndexForward: false,
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      items.push(...(output.Items ?? []).map((item) => item as SurveyResponseRecord));
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items;
  }

  async listResponsesPage(
    tenantId: string,
    surveyId: string,
    limit: number,
    cursor?: string
  ): Promise<{ items: SurveyResponseRecord[]; nextCursor?: string }> {
    const survey = await this.getById(tenantId, surveyId);
    if (!survey) {
      return { items: [] };
    }

    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: surveysTableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SURVEY#${surveyId}`,
          ':sk': 'RESPONSE#'
        },
        ScanIndexForward: false,
        Limit: normalizedLimit,
        ExclusiveStartKey: decodeCursor(cursor)
      })
    );

    return {
      items: (output.Items ?? []) as SurveyResponseRecord[],
      nextCursor: encodeCursor(output.LastEvaluatedKey as Record<string, unknown> | undefined)
    };
  }

  async listResponsesUntil(tenantId: string, surveyId: string, cutoffIso: string): Promise<SurveyResponseRecord[]> {
    const survey = await this.getById(tenantId, surveyId);
    if (!survey) {
      return [];
    }

    const items: SurveyResponseRecord[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: surveysTableName,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
          ExpressionAttributeValues: {
            ':pk': `SURVEY#${surveyId}`,
            ':from': 'RESPONSE#',
            ':to': `RESPONSE#${cutoffIso}~`
          },
          ScanIndexForward: true,
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      items.push(...(output.Items ?? []).map((item) => item as SurveyResponseRecord));
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items;
  }

  async archiveAndDeleteResponses(tenantId: string, surveyId: string, responses: SurveyResponseRecord[]): Promise<void> {
    const uniqueByResponseKey = new Map<string, SurveyResponseRecord>();
    for (const response of responses) {
      uniqueByResponseKey.set(`${response.submittedAt}#${response.id}`, response);
    }
    const unique = Array.from(uniqueByResponseKey.values());
    if (!unique.length) {
      return;
    }

    const chunkSize = 10;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      await dynamoDbDocumentClient.send(
        new TransactWriteCommand({
          TransactItems: chunk.flatMap((response) => [
            {
              Put: {
                TableName: surveysTableName,
                Item: {
                  ...(() => {
                    const nowIso = new Date().toISOString();
                    return {
                      ...responseLockKey(surveyId, response.clientResponseId),
                      entityType: 'SURVEY_RESPONSE_LOCK',
                      tenantId,
                      surveyId,
                      clientResponseId: response.clientResponseId,
                      responsePk: `SURVEY#${surveyId}`,
                      responseSk: `RESPONSE#${response.submittedAt}#${response.id}`,
                      createdAt: nowIso,
                      archivedAt: nowIso,
                      ttlEpoch: toTtlEpoch(nowIso)
                    };
                  })(),
                }
              }
            },
            {
              Delete: {
                TableName: surveysTableName,
                Key: responseKey(surveyId, response.id, response.submittedAt)
              }
            }
          ])
        })
      );
    }
  }

  async heatmap(tenantId: string, surveyId: string): Promise<Array<{ lat: number; lng: number; count: number }>> {
    const survey = await this.getById(tenantId, surveyId);
    if (!survey || !survey.locationCapture?.captureEnabled) {
      return [];
    }

    const points = new Map<string, { lat: number; lng: number; count: number }>();
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: surveysTableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `SURVEY#${surveyId}`,
            ':sk': 'RESPONSE#'
          },
          ProjectionExpression: '#metadata',
          ExpressionAttributeNames: {
            '#metadata': 'metadata'
          },
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      for (const item of output.Items ?? []) {
        const metadata = (item as SurveyResponseRecord).metadata;
        const location = toGeoPoint(metadata?.location);
        if (!location) {
          continue;
        }

        const lat = Number(location.lat.toFixed(3));
        const lng = Number(location.lng.toFixed(3));
        const key = `${lat}|${lng}`;
        const current = points.get(key);
        if (current) {
          current.count += 1;
        } else {
          points.set(key, { lat, lng, count: 1 });
        }
      }

      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return Array.from(points.values()).sort((a, b) => b.count - a.count);
  }

  async getResponsesSummary(tenantId: string, surveyId: string): Promise<{ surveyId: string; responsesCount: number } | null> {
    const survey = await this.getById(tenantId, surveyId);
    if (!survey) {
      return null;
    }

    const directCount = Number(survey.responsesCount);
    if (Number.isFinite(directCount) && directCount >= 0) {
      return {
        surveyId,
        responsesCount: directCount
      };
    }

    const fallback = await this.countSurveyResponses(surveyId);
    return {
      surveyId,
      responsesCount: fallback
    };
  }

  async computeAnalyticsSnapshot(
    tenantId: string,
    surveyId: string,
    options?: {
      version?: string;
      baselineResponsesCount?: number;
      sourceUpdatedAt?: string;
      archivedHeatmap?: Array<{ lat: number; lng: number; count: number }>;
    }
  ): Promise<SurveyAnalyticsSnapshotData | null> {
    const survey = await this.getById(tenantId, surveyId);
    if (!survey) {
      return null;
    }

    const baseCount = Number(options?.baselineResponsesCount ?? survey.responsesCount);
    const countFromSurvey = Number.isFinite(baseCount) && baseCount >= 0 ? Math.floor(baseCount) : NaN;
    const responsesCount = Number.isFinite(countFromSurvey) ? countFromSurvey : await this.countSurveyResponses(surveyId);
    const sourceUpdatedAt = String(options?.sourceUpdatedAt ?? survey.updatedAt ?? '');
    const version = String(options?.version ?? `${responsesCount}:${sourceUpdatedAt}`);

    const heatmapMap = new Map<string, { lat: number; lng: number; count: number }>();
    for (const archived of options?.archivedHeatmap ?? []) {
      const lat = Number(archived.lat);
      const lng = Number(archived.lng);
      const count = Number(archived.count);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(count) || count <= 0) {
        continue;
      }
      const key = `${lat}|${lng}`;
      const current = heatmapMap.get(key);
      if (current) {
        current.count += Math.floor(count);
      } else {
        heatmapMap.set(key, { lat, lng, count: Math.floor(count) });
      }
    }

    if (survey.locationCapture?.captureEnabled && responsesCount > 0) {
      let lastEvaluatedKey: Record<string, unknown> | undefined;

      do {
        const output = await dynamoDbDocumentClient.send(
          new QueryCommand({
            TableName: surveysTableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: {
              ':pk': `SURVEY#${surveyId}`,
              ':sk': 'RESPONSE#'
            },
            ProjectionExpression: '#metadata',
            ExpressionAttributeNames: {
              '#metadata': 'metadata'
            },
            ExclusiveStartKey: lastEvaluatedKey
          })
        );

        for (const item of output.Items ?? []) {
          const location = toGeoPoint((item as SurveyResponseRecord).metadata?.location);
          if (!location) {
            continue;
          }

          const lat = Number(location.lat.toFixed(3));
          const lng = Number(location.lng.toFixed(3));
          const key = `${lat}|${lng}`;
          const current = heatmapMap.get(key);
          if (current) {
            current.count += 1;
          } else {
            heatmapMap.set(key, { lat, lng, count: 1 });
          }
        }

        lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastEvaluatedKey);

    }

    return {
      version,
      tenantId,
      surveyId,
      responsesCount,
      sourceUpdatedAt,
      generatedAt: new Date().toISOString(),
      heatmap: Array.from(heatmapMap.values()).sort((a, b) => b.count - a.count)
    };
  }

  private async getResponseByClientResponseId(
    surveyId: string,
    clientResponseId: string
  ): Promise<SurveyResponseRecord | null> {
    const lock = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: surveysTableName,
        Key: responseLockKey(surveyId, clientResponseId)
      })
    );

    const lockItem = lock.Item as SurveyResponseLockRecord | undefined;
    const responsePk = lockItem?.responsePk as string | undefined;
    const responseSk = lockItem?.responseSk as string | undefined;
    if (!responsePk || !responseSk) {
      return null;
    }

    const existing = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: surveysTableName,
        Key: {
          PK: responsePk,
          SK: responseSk
        }
      })
    );

    if (existing.Item) {
      return existing.Item as SurveyResponseRecord;
    }

    const submittedAt = responseSk.startsWith('RESPONSE#') ? responseSk.slice('RESPONSE#'.length).split('#')[0] : '';
    const responseId = responseSk.includes('#') ? responseSk.split('#').slice(2).join('#') : '';
    return {
      id: responseId || 'archived',
      clientResponseId,
      surveyId,
      tenantId: lockItem?.tenantId ?? '',
      answers: {},
      submittedAt: submittedAt || new Date().toISOString(),
      metadata: {
        archived: true,
        archivedAt: lockItem?.archivedAt
      }
    };
  }

  private resolveInterviewerAssignment(
    survey: CustomerSurvey,
    interviewerId: string | undefined,
    submittedAt: Date
  ): SurveyInterviewerAssignment | null {
    const assignments = this.getEffectiveInterviewerAssignments(survey);
    if (!assignments.length) {
      return null;
    }

    if (!interviewerId) {
      throw new SurveySubmissionError('INTERVIEWER_NOT_ALLOWED', 'Pesquisa restrita para entrevistadores vinculados.');
    }

    const candidates = assignments.filter((item) => item.interviewerId === interviewerId);
    if (!candidates.length) {
      throw new SurveySubmissionError('INTERVIEWER_NOT_ALLOWED', 'Entrevistador nao vinculado a pesquisa.');
    }
    for (const assignment of candidates) {
      const start = toDate(assignment.periodStart, 'start');
      const end = toDate(assignment.periodEnd, 'end');
      if (!isValidDate(start) || !isValidDate(end)) {
        continue;
      }
      if (submittedAt < start || submittedAt > end) {
        continue;
      }
      if (Number(assignment.maxForms) > 0) {
        return assignment;
      }
    }
    throw new SurveySubmissionError('INTERVIEWER_QUOTA_REACHED', 'Cota de formularios do entrevistador atingida.');
  }

  private resolveMatchedQuotaRules(
    survey: CustomerSurvey,
    answers: Record<string, unknown>
  ): SurveyQuotaRule[] {
    const rules = (survey.quotaRules ?? []).filter(
      (rule) =>
        Boolean(rule?.questionId) &&
        Boolean(rule?.optionId) &&
        Number.isFinite(Number(rule?.maxResponses)) &&
        Number(rule.maxResponses) > 0
    );
    if (!rules.length) {
      return [];
    }

    const matched: SurveyQuotaRule[] = [];
    for (const rule of rules) {
      const answer = answers[rule.questionId];
      if (!this.answerContainsOption(answer, rule.optionId)) {
        continue;
      }
      matched.push(rule);
    }
    return matched;
  }

  private answerContainsOption(answer: unknown, optionId: string): boolean {
    if (Array.isArray(answer)) {
      return answer.some((item) => String(item) === optionId);
    }
    return String(answer ?? '') === optionId;
  }

  private getEffectiveInterviewerAssignments(survey: CustomerSurvey): SurveyInterviewerAssignment[] {
    const waves = Array.isArray(survey.waves) ? survey.waves : [];
    if (!waves.length) {
      return survey.interviewerAssignments ?? [];
    }
    return waves.flatMap((wave) =>
      (wave.interviewerAssignments ?? []).map((assignment) => ({
        interviewerId: assignment.interviewerId,
        maxForms: Number(assignment.maxForms ?? 0),
        periodStart: wave.periodStart,
        periodEnd: wave.periodEnd
      }))
    );
  }

  private async countSurveyResponses(surveyId: string): Promise<number> {
    let total = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: surveysTableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `SURVEY#${surveyId}`,
            ':sk': 'RESPONSE#'
          },
          Select: 'COUNT',
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      total += Number(output.Count ?? 0);
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return total;
  }

  private async countInterviewerResponsesInPeriod(
    surveyId: string,
    interviewerId: string,
    start: Date,
    end: Date
  ): Promise<number> {
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const counter = await this.getInterviewerCounterCount(surveyId, interviewerId, startIso, endIso);
    if (counter > 0) {
      return counter;
    }

    let total = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: surveysTableName,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
          ExpressionAttributeValues: {
            ':pk': `SURVEY#${surveyId}`,
            ':from': `RESPONSE#${startIso}`,
            ':to': `RESPONSE#${endIso}~`
          },
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      for (const item of output.Items ?? []) {
        const metadata = (item as SurveyResponseRecord).metadata;
        if (metadata?.interviewerId === interviewerId) {
          total += 1;
        }
      }
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return total;
  }

  private async getInterviewerCounterCount(
    surveyId: string,
    interviewerId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<number> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: surveysTableName,
        Key: interviewerCounterKey(surveyId, interviewerId, periodStart, periodEnd)
      })
    );
    const count = Number(output.Item?.count ?? 0);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  }

  private async getQuotaCounterCount(surveyId: string, questionId: string, optionId: string): Promise<number> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: surveysTableName,
        Key: quotaCounterKey(surveyId, questionId, optionId)
      })
    );
    const count = Number(output.Item?.count ?? 0);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  }
}
