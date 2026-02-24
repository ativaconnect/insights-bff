import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { SurveyAnalyticsSnapshot } from './analytics-snapshot.types';
import type { AnalyticsSnapshotStorage } from './analytics-snapshot.storage';

const asBoolean = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const normalizePart = (value: string): string => encodeURIComponent(String(value ?? '').trim());

const streamToBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) {
    return Buffer.alloc(0);
  }
  const readable = body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    readable.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    readable.on('error', reject);
    readable.on('end', () => resolve());
  });
  return Buffer.concat(chunks);
};

const decompressJson = (buffer: Buffer): string => gunzipSync(buffer).toString('utf-8');
const compressJson = (raw: string): Buffer => gzipSync(Buffer.from(raw, 'utf-8'));

export class S3AnalyticsSnapshotStorage implements AnalyticsSnapshotStorage {
  private readonly bucket = process.env.ANALYTICS_SNAPSHOT_S3_BUCKET?.trim() || 'insights-analytics-local';
  private readonly client: S3Client;

  constructor() {
    const region = process.env.ANALYTICS_SNAPSHOT_S3_REGION?.trim() || process.env.AWS_REGION || 'us-east-1';
    const endpoint = process.env.ANALYTICS_SNAPSHOT_S3_ENDPOINT?.trim() || undefined;
    const forcePathStyle = asBoolean(process.env.ANALYTICS_SNAPSHOT_S3_FORCE_PATH_STYLE, Boolean(endpoint));
    const accessKeyId = process.env.ANALYTICS_SNAPSHOT_S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.ANALYTICS_SNAPSHOT_S3_SECRET_ACCESS_KEY?.trim();

    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      ...(accessKeyId && secretAccessKey
        ? {
            credentials: {
              accessKeyId,
              secretAccessKey
            }
          }
        : {})
    });
  }

  private buildKey(tenantId: string, surveyId: string): string {
    return `analytics-snapshots/clientes/${normalizePart(tenantId)}/pesquisas/${normalizePart(surveyId)}.json.gz`;
  }

  async readSnapshot(tenantId: string, surveyId: string): Promise<SurveyAnalyticsSnapshot | null> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.buildKey(tenantId, surveyId)
        })
      );
      const raw = await streamToBuffer(output.Body);
      if (!raw.length) {
        return null;
      }
      const json = decompressJson(raw);
      return JSON.parse(json) as SurveyAnalyticsSnapshot;
    } catch {
      return null;
    }
  }

  async writeSnapshot(snapshot: SurveyAnalyticsSnapshot): Promise<void> {
    const payload = compressJson(JSON.stringify(snapshot));
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.buildKey(snapshot.tenantId, snapshot.surveyId),
        Body: payload,
        ContentType: 'application/json; charset=utf-8',
        ContentEncoding: 'gzip'
      })
    );
  }
}
