import type {
  CustomerSurvey,
  SurveyResponseRecord,
  SurveyWave
} from '../persistence/dynamodb/customer-survey.repository';
import { CustomerSurveyRepository } from '../persistence/dynamodb/customer-survey.repository';
import { logger } from '../observability/logger';
import {
  FilesystemResponseArchiveStorage,
  S3ResponseArchiveStorage,
  type ResponseArchiveStorage
} from './response-archive.storage';

const archiveSafetyLagSeconds = Number(process.env.ANALYTICS_ARCHIVE_SAFETY_LAG_SECONDS ?? 120);
const archiveChunkSize = Number(process.env.ANALYTICS_ARCHIVE_CHUNK_SIZE ?? 250);

const normalizeCount = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const toDate = (value: string): Date => new Date(value);
const isValidDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const responseKey = (response: SurveyResponseRecord): string => `${response.submittedAt}#${response.id}`;

const chunkItems = <T>(items: T[], size: number): T[][] => {
  const output: T[][] = [];
  const normalizedSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : 250;
  for (let i = 0; i < items.length; i += normalizedSize) {
    output.push(items.slice(i, i + normalizedSize));
  }
  return output;
};

const resolveRoundId = (survey: CustomerSurvey, responseIso: string): string => {
  const waves = Array.isArray(survey.waves) ? survey.waves : [];
  if (!waves.length) {
    return 'default';
  }
  const responseAt = toDate(responseIso);
  if (!isValidDate(responseAt)) {
    return 'unassigned';
  }
  for (const wave of waves) {
    const start = toDate(wave.periodStart);
    const end = toDate(wave.periodEnd);
    if (!isValidDate(start) || !isValidDate(end)) {
      continue;
    }
    if (responseAt >= start && responseAt <= end) {
      return String(wave.id || 'unassigned');
    }
  }
  return 'unassigned';
};

const roundIdsForSurvey = (survey: CustomerSurvey): string[] => {
  const waves = (Array.isArray(survey.waves) ? survey.waves : [])
    .map((wave: SurveyWave) => String(wave.id || '').trim())
    .filter(Boolean);
  if (!waves.length) {
    return ['default'];
  }
  return [...new Set([...waves, 'unassigned'])];
};

export class SurveyResponseArchiveService {
  private readonly storage: ResponseArchiveStorage;

  constructor(private readonly repository: CustomerSurveyRepository = new CustomerSurveyRepository(), storage?: ResponseArchiveStorage) {
    if (storage) {
      this.storage = storage;
      return;
    }
    const storageMode = String(process.env.ANALYTICS_SNAPSHOT_STORAGE ?? 'filesystem').trim().toLowerCase();
    this.storage = storageMode === 's3' ? new S3ResponseArchiveStorage() : new FilesystemResponseArchiveStorage();
  }

  async syncSurveyArchives(tenantId: string, surveyId: string): Promise<void> {
    const survey = await this.repository.getById(tenantId, surveyId);
    if (!survey) {
      return;
    }

    const cutoff = new Date(Date.now() - normalizeCount(archiveSafetyLagSeconds) * 1000);
    const cutoffIso = cutoff.toISOString();
    const eligible = await this.repository.listResponsesUntil(tenantId, surveyId, cutoffIso);
    if (!eligible.length) {
      return;
    }

    const buckets = new Map<string, SurveyResponseRecord[]>();
    for (const response of eligible) {
      const roundId = resolveRoundId(survey, response.submittedAt);
      const current = buckets.get(roundId) ?? [];
      current.push(response);
      buckets.set(roundId, current);
    }

    const deletions: SurveyResponseRecord[] = [];
    for (const [roundId, responses] of buckets.entries()) {
      const chunks = chunkItems(responses, normalizeCount(archiveChunkSize));
      for (const chunk of chunks) {
        await this.storage.appendRoundResponses(tenantId, surveyId, roundId, chunk);
        deletions.push(...chunk);
      }
    }

    if (!deletions.length) {
      return;
    }

    await this.repository.archiveAndDeleteResponses(tenantId, surveyId, deletions);
    logger.info('archive.sync.completed', {
      tenantId,
      surveyId,
      archivedFromDynamo: deletions.length,
      rounds: Array.from(buckets.keys())
    });
  }

  async loadArchivedHeatmapPoints(
    tenantId: string,
    survey: CustomerSurvey
  ): Promise<Array<{ lat: number; lng: number; count: number }>> {
    const map = new Map<string, { lat: number; lng: number; count: number }>();
    const roundIds = roundIdsForSurvey(survey);

    for (const roundId of roundIds) {
      const archive = await this.storage.readRoundArchive(tenantId, survey.id, roundId);
      if (!archive) {
        continue;
      }

      for (const response of archive.responses) {
        const location = response.metadata?.location;
        if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
          continue;
        }
        const lat = Number(location.lat.toFixed(3));
        const lng = Number(location.lng.toFixed(3));
        const key = `${lat}|${lng}`;
        const current = map.get(key);
        if (current) {
          current.count += 1;
        } else {
          map.set(key, { lat, lng, count: 1 });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }
}
