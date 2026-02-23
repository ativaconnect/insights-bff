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

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

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

export class CustomerSurveyRepository {
  async list(tenantId: string): Promise<CustomerSurvey[]> {
    const output = await dynamoDbDocumentClient.send(
      new QueryCommand({
        TableName: surveysTableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':sk': 'SURVEY#'
        },
        ScanIndexForward: false
      })
    );

    return (output.Items ?? []).map((item) => item as CustomerSurvey);
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
    if (maxResponsesPerSurvey && maxResponsesPerSurvey > 0) {
      const totalResponses = await this.countSurveyResponses(surveyId);
      if (totalResponses >= maxResponsesPerSurvey) {
        throw new SurveySubmissionError(
          'PLAN_LIMIT_REACHED',
          `Limite de ${maxResponsesPerSurvey} respostas por pesquisa atingido para o seu plano.`
        );
      }
    }

    await this.ensureInterviewerPolicy(survey, options?.interviewerId, submittedAtDate);
    await this.ensureSurveyQuotas(survey, answers);
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
      await dynamoDbDocumentClient.send(
        new TransactWriteCommand({
          TransactItems: [
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
                  createdAt: new Date().toISOString()
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

    const responsePk = lock.Item?.responsePk as string | undefined;
    const responseSk = lock.Item?.responseSk as string | undefined;
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

    return (existing.Item as SurveyResponseRecord | undefined) ?? null;
  }

  private async ensureInterviewerPolicy(
    survey: CustomerSurvey,
    interviewerId: string | undefined,
    submittedAt: Date
  ): Promise<void> {
    const assignments = this.getEffectiveInterviewerAssignments(survey);
    if (!assignments.length) {
      return;
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
      const count = await this.countInterviewerResponsesInPeriod(survey.id, interviewerId, start, end);
      if (count < assignment.maxForms) {
        return;
      }
    }
    throw new SurveySubmissionError('INTERVIEWER_QUOTA_REACHED', 'Cota de formularios do entrevistador atingida.');
  }

  private async ensureSurveyQuotas(survey: CustomerSurvey, answers: Record<string, unknown>): Promise<void> {
    const rules = (survey.quotaRules ?? []).filter(
      (rule) =>
        Boolean(rule?.questionId) &&
        Boolean(rule?.optionId) &&
        Number.isFinite(Number(rule?.maxResponses)) &&
        Number(rule.maxResponses) > 0
    );
    if (!rules.length) {
      return;
    }

    for (const rule of rules) {
      const answer = answers[rule.questionId];
      if (!this.answerContainsOption(answer, rule.optionId)) {
        continue;
      }

      const used = await this.countResponsesByOption(survey.id, rule.questionId, rule.optionId);
      if (used >= Number(rule.maxResponses)) {
        throw new SurveySubmissionError(
          'SURVEY_QUOTA_REACHED',
          `Quota atingida para "${rule.name}" (${rule.maxResponses}).`
        );
      }
    }
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

  private async countInterviewerResponsesInPeriod(
    surveyId: string,
    interviewerId: string,
    start: Date,
    end: Date
  ): Promise<number> {
    let total = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: surveysTableName,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
          ExpressionAttributeValues: {
            ':pk': `SURVEY#${surveyId}`,
            ':from': `RESPONSE#${start.toISOString()}`,
            ':to': `RESPONSE#${end.toISOString()}~`
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

  private async countResponsesByOption(
    surveyId: string,
    questionId: string,
    optionId: string
  ): Promise<number> {
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
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      for (const item of output.Items ?? []) {
        const answers = (item as SurveyResponseRecord).answers ?? {};
        if (this.answerContainsOption(answers[questionId], optionId)) {
          total += 1;
        }
      }

      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return total;
  }
}
