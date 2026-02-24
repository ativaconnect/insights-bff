import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { logger } from '../observability/logger';
import type { SurveyResponseRecord } from '../persistence/dynamodb/customer-survey.repository';

export interface SurveyRoundResponseArchive {
  schemaVersion: 1;
  tenantId: string;
  surveyId: string;
  roundId: string;
  updatedAt: string;
  responses: SurveyResponseRecord[];
}

interface SurveyRoundArchiveIndex {
  schemaVersion: 1;
  tenantId: string;
  surveyId: string;
  roundId: string;
  updatedAt: string;
  chunkIds: string[];
}

interface SurveyRoundArchiveChunk {
  schemaVersion: 1;
  tenantId: string;
  surveyId: string;
  roundId: string;
  chunkId: string;
  updatedAt: string;
  responses: SurveyResponseRecord[];
}

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
const responseKey = (response: SurveyResponseRecord): string => `${response.submittedAt}#${response.id}`;

const buildChunkId = (responses: SurveyResponseRecord[]): string => {
  const keys = responses.map((item) => responseKey(item)).sort().join('|');
  return createHash('sha1').update(keys).digest('hex');
};

const dedupeResponses = (responses: SurveyResponseRecord[]): SurveyResponseRecord[] => {
  const map = new Map<string, SurveyResponseRecord>();
  for (const response of responses) {
    map.set(responseKey(response), response);
  }
  return Array.from(map.values()).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
};

export interface ResponseArchiveStorage {
  readRoundArchive(tenantId: string, surveyId: string, roundId: string): Promise<SurveyRoundResponseArchive | null>;
  writeRoundArchive(archive: SurveyRoundResponseArchive): Promise<void>;
  appendRoundResponses(
    tenantId: string,
    surveyId: string,
    roundId: string,
    responses: SurveyResponseRecord[]
  ): Promise<void>;
  buildArchiveKey(tenantId: string, surveyId: string, roundId: string): string;
}

export class S3ResponseArchiveStorage implements ResponseArchiveStorage {
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

  private buildRoundBaseKey(tenantId: string, surveyId: string, roundId: string): string {
    return `analytics-archives/clientes/${normalizePart(tenantId)}/pesquisas/${normalizePart(surveyId)}/rodadas/${normalizePart(roundId)}`;
  }

  private buildIndexKey(tenantId: string, surveyId: string, roundId: string): string {
    return `${this.buildRoundBaseKey(tenantId, surveyId, roundId)}/index.json.gz`;
  }

  buildArchiveKey(tenantId: string, surveyId: string, roundId: string): string {
    return this.buildIndexKey(tenantId, surveyId, roundId);
  }

  private buildChunkKey(tenantId: string, surveyId: string, roundId: string, chunkId: string): string {
    return `${this.buildRoundBaseKey(tenantId, surveyId, roundId)}/chunks/${normalizePart(chunkId)}.json.gz`;
  }

  private async readIndex(tenantId: string, surveyId: string, roundId: string): Promise<SurveyRoundArchiveIndex | null> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.buildIndexKey(tenantId, surveyId, roundId)
        })
      );
      const raw = await streamToBuffer(output.Body);
      if (!raw.length) {
        return null;
      }
      return JSON.parse(decompressJson(raw)) as SurveyRoundArchiveIndex;
    } catch {
      return null;
    }
  }

  private async writeIndex(index: SurveyRoundArchiveIndex): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.buildIndexKey(index.tenantId, index.surveyId, index.roundId),
        Body: compressJson(JSON.stringify(index)),
        ContentType: 'application/json; charset=utf-8',
        ContentEncoding: 'gzip'
      })
    );
  }

  private async readChunk(
    tenantId: string,
    surveyId: string,
    roundId: string,
    chunkId: string
  ): Promise<SurveyRoundArchiveChunk | null> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.buildChunkKey(tenantId, surveyId, roundId, chunkId)
        })
      );
      const raw = await streamToBuffer(output.Body);
      if (!raw.length) {
        return null;
      }
      return JSON.parse(decompressJson(raw)) as SurveyRoundArchiveChunk;
    } catch {
      return null;
    }
  }

  private async writeChunk(chunk: SurveyRoundArchiveChunk): Promise<void> {
    const key = this.buildChunkKey(chunk.tenantId, chunk.surveyId, chunk.roundId, chunk.chunkId);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: compressJson(JSON.stringify(chunk)),
        ContentType: 'application/json; charset=utf-8',
        ContentEncoding: 'gzip'
      })
    );
    logger.debug('archive.s3.chunk.write', {
      bucket: this.bucket,
      key,
      responses: chunk.responses.length
    });
  }

  async appendRoundResponses(
    tenantId: string,
    surveyId: string,
    roundId: string,
    responses: SurveyResponseRecord[]
  ): Promise<void> {
    const deduped = dedupeResponses(responses);
    if (!deduped.length) {
      return;
    }

    const chunkId = buildChunkId(deduped);
    const chunk: SurveyRoundArchiveChunk = {
      schemaVersion: 1,
      tenantId,
      surveyId,
      roundId,
      chunkId,
      updatedAt: new Date().toISOString(),
      responses: deduped
    };

    await this.writeChunk(chunk);

    const existing = await this.readIndex(tenantId, surveyId, roundId);
    const chunkIds = new Set(existing?.chunkIds ?? []);
    chunkIds.add(chunkId);

    await this.writeIndex({
      schemaVersion: 1,
      tenantId,
      surveyId,
      roundId,
      updatedAt: new Date().toISOString(),
      chunkIds: Array.from(chunkIds)
    });
  }

  async readRoundArchive(
    tenantId: string,
    surveyId: string,
    roundId: string
  ): Promise<SurveyRoundResponseArchive | null> {
    const index = await this.readIndex(tenantId, surveyId, roundId);
    if (!index?.chunkIds.length) {
      return null;
    }

    const chunks = await Promise.all(index.chunkIds.map((chunkId) => this.readChunk(tenantId, surveyId, roundId, chunkId)));
    const responses = dedupeResponses(chunks.flatMap((chunk) => chunk?.responses ?? []));

    return {
      schemaVersion: 1,
      tenantId,
      surveyId,
      roundId,
      updatedAt: index.updatedAt,
      responses
    };
  }

  async writeRoundArchive(archive: SurveyRoundResponseArchive): Promise<void> {
    const chunkId = `full-${Date.now()}`;
    const chunk: SurveyRoundArchiveChunk = {
      schemaVersion: 1,
      tenantId: archive.tenantId,
      surveyId: archive.surveyId,
      roundId: archive.roundId,
      chunkId,
      updatedAt: new Date().toISOString(),
      responses: dedupeResponses(archive.responses)
    };
    await this.writeChunk(chunk);
    await this.writeIndex({
      schemaVersion: 1,
      tenantId: archive.tenantId,
      surveyId: archive.surveyId,
      roundId: archive.roundId,
      updatedAt: new Date().toISOString(),
      chunkIds: [chunkId]
    });
  }
}

const defaultRoot = process.env.ANALYTICS_SNAPSHOT_LOCAL_DIR?.trim() || '.local/s3/analytics-snapshots';

export class FilesystemResponseArchiveStorage implements ResponseArchiveStorage {
  constructor(private readonly rootDir: string = defaultRoot) {}

  private buildRoundBaseDir(tenantId: string, surveyId: string, roundId: string): string {
    return path.resolve(
      this.rootDir,
      'analytics-archives',
      'clientes',
      normalizePart(tenantId),
      'pesquisas',
      normalizePart(surveyId),
      'rodadas',
      normalizePart(roundId)
    );
  }

  private buildIndexPath(tenantId: string, surveyId: string, roundId: string): string {
    return path.resolve(this.buildRoundBaseDir(tenantId, surveyId, roundId), 'index.json.gz');
  }

  private buildChunkPath(tenantId: string, surveyId: string, roundId: string, chunkId: string): string {
    return path.resolve(this.buildRoundBaseDir(tenantId, surveyId, roundId), 'chunks', `${normalizePart(chunkId)}.json.gz`);
  }

  buildArchiveKey(tenantId: string, surveyId: string, roundId: string): string {
    return this.buildIndexPath(tenantId, surveyId, roundId);
  }

  private async readIndex(tenantId: string, surveyId: string, roundId: string): Promise<SurveyRoundArchiveIndex | null> {
    try {
      const raw = await readFile(this.buildIndexPath(tenantId, surveyId, roundId));
      return JSON.parse(decompressJson(raw)) as SurveyRoundArchiveIndex;
    } catch {
      return null;
    }
  }

  private async writeIndex(index: SurveyRoundArchiveIndex): Promise<void> {
    const filePath = this.buildIndexPath(index.tenantId, index.surveyId, index.roundId);
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tempPath = `${filePath}.${Date.now()}.tmp`;
    await writeFile(tempPath, compressJson(JSON.stringify(index)));
    await rename(tempPath, filePath);
  }

  private async readChunk(
    tenantId: string,
    surveyId: string,
    roundId: string,
    chunkId: string
  ): Promise<SurveyRoundArchiveChunk | null> {
    try {
      const raw = await readFile(this.buildChunkPath(tenantId, surveyId, roundId, chunkId));
      return JSON.parse(decompressJson(raw)) as SurveyRoundArchiveChunk;
    } catch {
      return null;
    }
  }

  private async writeChunk(chunk: SurveyRoundArchiveChunk): Promise<void> {
    const filePath = this.buildChunkPath(chunk.tenantId, chunk.surveyId, chunk.roundId, chunk.chunkId);
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tempPath = `${filePath}.${Date.now()}.tmp`;
    await writeFile(tempPath, compressJson(JSON.stringify(chunk)));
    await rename(tempPath, filePath);
  }

  async appendRoundResponses(
    tenantId: string,
    surveyId: string,
    roundId: string,
    responses: SurveyResponseRecord[]
  ): Promise<void> {
    const deduped = dedupeResponses(responses);
    if (!deduped.length) {
      return;
    }

    const chunkId = buildChunkId(deduped);
    await this.writeChunk({
      schemaVersion: 1,
      tenantId,
      surveyId,
      roundId,
      chunkId,
      updatedAt: new Date().toISOString(),
      responses: deduped
    });

    const existing = await this.readIndex(tenantId, surveyId, roundId);
    const chunkIds = new Set(existing?.chunkIds ?? []);
    chunkIds.add(chunkId);

    await this.writeIndex({
      schemaVersion: 1,
      tenantId,
      surveyId,
      roundId,
      updatedAt: new Date().toISOString(),
      chunkIds: Array.from(chunkIds)
    });
  }

  async readRoundArchive(
    tenantId: string,
    surveyId: string,
    roundId: string
  ): Promise<SurveyRoundResponseArchive | null> {
    const index = await this.readIndex(tenantId, surveyId, roundId);
    if (!index?.chunkIds.length) {
      return null;
    }

    const chunks = await Promise.all(index.chunkIds.map((chunkId) => this.readChunk(tenantId, surveyId, roundId, chunkId)));
    const responses = dedupeResponses(chunks.flatMap((chunk) => chunk?.responses ?? []));

    return {
      schemaVersion: 1,
      tenantId,
      surveyId,
      roundId,
      updatedAt: index.updatedAt,
      responses
    };
  }

  async writeRoundArchive(archive: SurveyRoundResponseArchive): Promise<void> {
    const chunkId = `full-${Date.now()}`;
    await this.writeChunk({
      schemaVersion: 1,
      tenantId: archive.tenantId,
      surveyId: archive.surveyId,
      roundId: archive.roundId,
      chunkId,
      updatedAt: new Date().toISOString(),
      responses: dedupeResponses(archive.responses)
    });
    await this.writeIndex({
      schemaVersion: 1,
      tenantId: archive.tenantId,
      surveyId: archive.surveyId,
      roundId: archive.roundId,
      updatedAt: new Date().toISOString(),
      chunkIds: [chunkId]
    });
  }
}
