import { CustomerSurveyRepository } from '../persistence/dynamodb/customer-survey.repository';
import { FilesystemAnalyticsSnapshotStorage } from './filesystem-analytics-snapshot.storage';
import { S3AnalyticsSnapshotStorage } from './s3-analytics-snapshot.storage';
import type { SurveyAnalyticsSnapshot } from './analytics-snapshot.types';
import type { AnalyticsSnapshotStorage } from './analytics-snapshot.storage';
import { SurveyResponseArchiveService } from './survey-response-archive.service';
import { logger } from '../observability/logger';

const buildVersion = (responsesCount: number, sourceUpdatedAt: string): string =>
  `${Math.max(0, Math.floor(Number(responsesCount) || 0))}:${String(sourceUpdatedAt ?? '')}`;

export class SurveyAnalyticsSnapshotService {
  private readonly storage: AnalyticsSnapshotStorage;
  private readonly archiveService: SurveyResponseArchiveService;

  constructor(
    private readonly repository: CustomerSurveyRepository = new CustomerSurveyRepository(),
    storage?: AnalyticsSnapshotStorage,
    archiveService?: SurveyResponseArchiveService
  ) {
    this.archiveService = archiveService ?? new SurveyResponseArchiveService(this.repository);

    if (storage) {
      this.storage = storage;
      return;
    }
    const storageMode = String(process.env.ANALYTICS_SNAPSHOT_STORAGE ?? 'filesystem').trim().toLowerCase();
    this.storage = storageMode === 's3' ? new S3AnalyticsSnapshotStorage() : new FilesystemAnalyticsSnapshotStorage();
  }

  async getSnapshot(tenantId: string, surveyId: string): Promise<SurveyAnalyticsSnapshot | null> {
    try {
      await this.archiveService.syncSurveyArchives(tenantId, surveyId);
    } catch (error) {
      logger.warn('analytics.archive.sync_failed', {
        tenantId,
        surveyId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const survey = await this.repository.getById(tenantId, surveyId);
    if (!survey) {
      return null;
    }

    const responsesCount = Number(survey.responsesCount ?? 0);
    const normalizedCount = Number.isFinite(responsesCount) && responsesCount >= 0 ? Math.floor(responsesCount) : 0;
    const sourceUpdatedAt = String(survey.updatedAt ?? '');
    const version = buildVersion(normalizedCount, sourceUpdatedAt);

    const cached = await this.storage.readSnapshot(tenantId, surveyId);
    if (cached && cached.version === version) {
      return cached;
    }

    const archivedHeatmap = await this.archiveService.loadArchivedHeatmapPoints(tenantId, survey);

    const rebuilt = await this.repository.computeAnalyticsSnapshot(tenantId, surveyId, {
      version,
      baselineResponsesCount: normalizedCount,
      sourceUpdatedAt,
      archivedHeatmap
    });
    if (!rebuilt) {
      return null;
    }

    await this.storage.writeSnapshot(rebuilt);
    return rebuilt;
  }
}
