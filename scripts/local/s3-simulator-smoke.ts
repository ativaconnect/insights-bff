import { FilesystemAnalyticsSnapshotStorage } from '../../src/infrastructure/analytics/filesystem-analytics-snapshot.storage';
import { S3AnalyticsSnapshotStorage } from '../../src/infrastructure/analytics/s3-analytics-snapshot.storage';
import type { AnalyticsSnapshotStorage } from '../../src/infrastructure/analytics/analytics-snapshot.storage';

const tenantId = process.env.S3_SIM_TENANT_ID?.trim() || 'tenant-demo';
const surveyId = process.env.S3_SIM_SURVEY_ID?.trim() || 'survey-demo';

async function main(): Promise<void> {
  const storageMode = String(process.env.ANALYTICS_SNAPSHOT_STORAGE ?? 'filesystem').trim().toLowerCase();
  const storage: AnalyticsSnapshotStorage =
    storageMode === 's3' ? new S3AnalyticsSnapshotStorage() : new FilesystemAnalyticsSnapshotStorage();
  const now = new Date().toISOString();

  await storage.writeSnapshot({
    version: `1:${now}`,
    tenantId,
    surveyId,
    responsesCount: 1,
    sourceUpdatedAt: now,
    generatedAt: now,
    heatmap: [{ lat: -23.55, lng: -46.63, count: 1 }]
  });

  const read = await storage.readSnapshot(tenantId, surveyId);
  if (!read) {
    throw new Error('Falha ao ler snapshot do simulador S3 local.');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        tenantId: read.tenantId,
        surveyId: read.surveyId,
        storage: storageMode,
        version: read.version,
        responsesCount: read.responsesCount,
        pathBase: process.env.ANALYTICS_SNAPSHOT_LOCAL_DIR ?? '.local/s3/analytics-snapshots'
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
