import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { SurveyAnalyticsSnapshot } from './analytics-snapshot.types';
import type { AnalyticsSnapshotStorage } from './analytics-snapshot.storage';

const defaultRoot = process.env.ANALYTICS_SNAPSHOT_LOCAL_DIR?.trim() || '.local/s3/analytics-snapshots';

const normalizePart = (value: string): string => encodeURIComponent(String(value ?? '').trim());
const decompressJson = (buffer: Buffer): string => gunzipSync(buffer).toString('utf-8');
const compressJson = (raw: string): Buffer => gzipSync(Buffer.from(raw, 'utf-8'));

export class FilesystemAnalyticsSnapshotStorage implements AnalyticsSnapshotStorage {
  constructor(private readonly rootDir: string = defaultRoot) {}

  private resolveFilePath(tenantId: string, surveyId: string): string {
    const tenantPart = normalizePart(tenantId);
    const surveyPart = normalizePart(surveyId);
    return path.resolve(this.rootDir, 'clientes', tenantPart, 'pesquisas', `${surveyPart}.json.gz`);
  }

  async readSnapshot(tenantId: string, surveyId: string): Promise<SurveyAnalyticsSnapshot | null> {
    const filePath = this.resolveFilePath(tenantId, surveyId);
    try {
      const raw = await readFile(filePath);
      const json = decompressJson(raw);
      return JSON.parse(json) as SurveyAnalyticsSnapshot;
    } catch {
      return null;
    }
  }

  async writeSnapshot(snapshot: SurveyAnalyticsSnapshot): Promise<void> {
    const filePath = this.resolveFilePath(snapshot.tenantId, snapshot.surveyId);
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });

    const tempPath = `${filePath}.${Date.now()}.tmp`;
    await writeFile(tempPath, compressJson(JSON.stringify(snapshot)));
    await rename(tempPath, filePath);
  }
}
