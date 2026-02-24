import type { SurveyAnalyticsSnapshot } from './analytics-snapshot.types';

export interface AnalyticsSnapshotStorage {
  readSnapshot(tenantId: string, surveyId: string): Promise<SurveyAnalyticsSnapshot | null>;
  writeSnapshot(snapshot: SurveyAnalyticsSnapshot): Promise<void>;
}

