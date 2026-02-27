import { createHash } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const GCS_BUCKET = process.env.GCS_BUCKET;
const GCS_PROJECT_ID = process.env.GCS_PROJECT_ID;
const GCS_KEY_FILENAME = process.env.GCS_KEY_FILENAME;
const STRICT_GCS = process.env.STORAGE_STRICT_GCS === 'true' || process.env.NODE_ENV === 'production';

interface StorageLike {
  bucket(name: string): BucketLike;
}

interface BucketLike {
  file(name: string): FileLike;
}

interface FileLike {
  save(data: Buffer, options?: { resumable?: boolean; contentType?: string; metadata?: Record<string, string> }): Promise<void>;
  download(): Promise<[Buffer]>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<void>;
  getSignedUrl(options: {
    version: 'v4';
    action: 'read';
    expires: number | string | Date;
    responseDisposition?: string;
    responseType?: string;
  }): Promise<[string]>;
}

type StorageImport = {
  Storage: new (options?: { projectId?: string; keyFilename?: string }) => StorageLike;
};

let cachedStorage: StorageLike | null = null;

function resolveLocalPath(storagePath: string): string {
  const baseDir = resolve(UPLOAD_DIR);
  const targetPath = resolve(baseDir, storagePath);
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}${sep}`)) {
    throw new Error('Invalid storage path');
  }
  return targetPath;
}

async function getGcsStorage(): Promise<StorageLike | null> {
  if (!GCS_BUCKET) return null;
  if (cachedStorage) return cachedStorage;

  try {
    const dynamicImport = new Function('moduleName', 'return import(moduleName)') as (moduleName: string) => Promise<unknown>;
    const imported = await dynamicImport('@google-cloud/storage') as StorageImport;
    cachedStorage = new imported.Storage({
      projectId: GCS_PROJECT_ID,
      keyFilename: GCS_KEY_FILENAME,
    });
    return cachedStorage;
  } catch (error) {
    if (STRICT_GCS) {
      throw new Error(
        `GCS_BUCKET is set but @google-cloud/storage is unavailable or misconfigured: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
}

function toGcsPath(objectPath: string): string {
  return `gcs://${GCS_BUCKET}/${objectPath}`;
}

function parseGcsPath(storagePath: string): { bucket: string; objectPath: string } | null {
  if (!storagePath.startsWith('gcs://')) return null;
  const withoutScheme = storagePath.slice('gcs://'.length);
  const slashIdx = withoutScheme.indexOf('/');
  if (slashIdx <= 0) return null;
  return {
    bucket: withoutScheme.slice(0, slashIdx),
    objectPath: withoutScheme.slice(slashIdx + 1),
  };
}

export async function putObject(objectPath: string, buffer: Buffer, contentType: string): Promise<string> {
  const gcs = await getGcsStorage();
  if (gcs && GCS_BUCKET) {
    const file = gcs.bucket(GCS_BUCKET).file(objectPath);
    await file.save(buffer, {
      resumable: false,
      contentType,
      metadata: { cacheControl: 'private, max-age=0, no-store' },
    });
    return toGcsPath(objectPath);
  }

  const fullPath = resolveLocalPath(objectPath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
  return objectPath;
}

export async function getObjectBuffer(storagePath: string): Promise<Buffer> {
  const gcsTarget = parseGcsPath(storagePath);
  if (gcsTarget) {
    const gcs = await getGcsStorage();
    if (!gcs) throw new Error('GCS backend unavailable');
    const [buffer] = await gcs.bucket(gcsTarget.bucket).file(gcsTarget.objectPath).download();
    return buffer;
  }

  return readFile(resolveLocalPath(storagePath));
}

export async function deleteObject(storagePath: string): Promise<void> {
  const gcsTarget = parseGcsPath(storagePath);
  if (gcsTarget) {
    const gcs = await getGcsStorage();
    if (!gcs) return;
    await gcs.bucket(gcsTarget.bucket).file(gcsTarget.objectPath).delete({ ignoreNotFound: true });
    return;
  }

  await unlink(resolveLocalPath(storagePath)).catch(() => undefined);
}

export async function getSignedDownloadUrl(
  storagePath: string,
  filename: string,
  mimeType: string,
  expiresSeconds = 15 * 60,
): Promise<string | null> {
  const gcsTarget = parseGcsPath(storagePath);
  if (!gcsTarget) return null;

  const gcs = await getGcsStorage();
  if (!gcs) return null;

  const [url] = await gcs.bucket(gcsTarget.bucket).file(gcsTarget.objectPath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresSeconds * 1000,
    responseDisposition: `attachment; filename="${filename}"`,
    responseType: mimeType || 'application/octet-stream',
  });
  return url;
}

export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function buildObjectPath(docId: string, originalName: string): string {
  const dateDir = new Date().toISOString().split('T')[0];
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = safeName.split('.').pop() || 'bin';
  return join(dateDir, `${docId}.${ext}`);
}
