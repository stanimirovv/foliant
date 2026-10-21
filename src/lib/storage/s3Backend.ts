// Amazon S3 storage backend. `dir` maps to an object-key prefix inside
// S3_BUCKET ('' is the bucket root). Keys are passed to the SDK as opaque
// strings — never URL-encoded by hand.
//
//  - Atomicity: S3 has no rename; a PutObject appears whole or not at all.
//  - CAS: native ETag conditional writes (IfMatch on PutObject). Because some
//    S3-compatible endpoints ignore IfMatch, writeFile also fast-fails with a
//    pre-write GetObject compare when `ifMatchVersion` is given — correct
//    everywhere, a real cross-process CAS on S3.
//  - Live reload: API-mediated writes pulse the shared emitter; external
//    changes are picked up by optional polling (S3_POLL_INTERVAL_MS,
//    ListObjectsV2 ETag/LastModified diff). S3 event notifications are a
//    future option, out of scope.
//  - Retries: transient failures (throttling, 5xx, network) retry up to 3
//    attempts with exponential backoff (≈200/400/800 ms + jitter); after
//    exhaustion the error is 'unavailable'.

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { FileListing, StorageBackend, StorageChangeEvent, StorageError, isStorageError } from './types';
import { validateDiagramFileName, validateStorageDir } from './validate';
import { splitFileListing } from './fileSystemBackend';
import { emitStorageChange } from './events';

export interface S3BackendConfig {
  bucket: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  pollIntervalMs?: number;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export function readS3ConfigFromEnv(): S3BackendConfig {
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const forcePathStyle = endpoint
    ? (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false'
    : process.env.S3_FORCE_PATH_STYLE === 'true';
  const poll = Number(process.env.S3_POLL_INTERVAL_MS || 0);
  return {
    bucket: process.env.S3_BUCKET || '',
    endpoint,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle,
    pollIntervalMs: Number.isFinite(poll) && poll > 0 ? poll : 0,
  };
}

const TRANSIENT_NAMES = new Set([
  'ThrottlingException',
  'Throttling',
  'ThrottlingException',
  'RequestLimitExceeded',
  'SlowDown',
  'InternalError',
  'ServiceUnavailable',
  'RequestTimeout',
  'RequestTimeoutException',
  'PriorRequestNotComplete',
  'ConnectionError',
]);

const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function isTransientS3Error(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  if (e.name && TRANSIENT_NAMES.has(e.name)) return true;
  if (e.code && TRANSIENT_CODES.has(e.code)) return true;
  const status = e.$metadata?.httpStatusCode;
  if (typeof status === 'number' && status >= 500) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run an S3 command with the retry policy: up to 3 attempts, exponential
// backoff base 200 ms with jitter. Transient failures after the last attempt
// become StorageError('unavailable'); anything else propagates raw (the
// caller maps it).
async function withS3Retry<T>(op: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (!isTransientS3Error(err)) throw err;
      if (attempt + 1 < maxAttempts) {
        const backoff = 200 * 2 ** attempt + Math.floor(Math.random() * 100);
        await sleep(backoff);
      }
    }
  }
  throw new StorageError(
    'unavailable',
    `S3 unavailable after ${maxAttempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    lastErr,
  );
}

// Map an S3 SDK error to the storage error taxonomy.
export function s3ErrorToStorageError(err: unknown, config: S3BackendConfig, filename?: string): StorageError {
  if (isStorageError(err)) return err;
  const e = err as { name?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const name = e.name || e.code || '';
  const status = e.$metadata?.httpStatusCode;
  const detail = filename ? `: ${filename}` : '';
  switch (name) {
    case 'NoSuchKey':
      return new StorageError('not-found', `File not found${detail}`, err);
    case 'NoSuchBucket':
      return new StorageError(
        'unavailable',
        `S3 bucket '${config.bucket}' does not exist or is not reachable (S3_BUCKET)`,
        err,
      );
    case 'PreconditionFailed':
      return new StorageError(
        'conflict',
        `The file changed on disk since it was read; reload it before saving${detail}`,
        err,
      );
    case 'AccessDenied':
    case 'AllAccessDisabled':
    case 'Forbidden':
      return new StorageError('forbidden', `Permission denied by S3${detail}`, err);
    case 'EntityTooLarge':
      return new StorageError('too-large', `File too large for S3${detail}`, err);
    default:
      if (status === 404) return new StorageError('not-found', `File not found${detail}`, err);
      if (status === 403) return new StorageError('forbidden', `Permission denied by S3${detail}`, err);
      if (status === 503 || status === 500) {
        return new StorageError('unavailable', `S3 unavailable (HTTP ${status})${detail}`, err);
      }
      return new StorageError(
        'unknown',
        e.message ? `${e.name || 'S3 error'}: ${e.message}` : 'S3 request failed',
        err,
      );
  }
}

function keyFor(dir: string, filename: string): string {
  return dir === '' ? filename : `${dir}/${filename}`;
}

function prefixFor(dir: string): string {
  return dir === '' ? '' : `${dir}/`;
}

// Strip the prefix and keep only top-level names (depth 0, like the fs
// readdir and the chokidar depth: 0 watch).
function topLevelNames(keys: string[], prefix: string): string[] {
  const names: string[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (rest === '' || rest.includes('/')) continue; // dir marker or nested
    names.push(rest);
  }
  return names;
}

interface S3ObjectInfo {
  key: string;
  etag: string;
  lastModified: number;
}

// List every object under `prefix`, following pagination (ListObjectsV2
// returns at most 1000 keys per page — without this, large directories
// silently truncate).
async function listAllObjects(client: S3Client, bucket: string, prefix: string): Promise<S3ObjectInfo[]> {
  const objects: S3ObjectInfo[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        objects.push({
          key: obj.Key,
          etag: (obj.ETag || '').replace(/^"|"$/g, ''),
          lastModified: obj.LastModified?.getTime() ?? 0,
        });
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

export function createS3Backend(config: S3BackendConfig): StorageBackend {
  if (!config.bucket) {
    throw new Error('S3_BUCKET is required when STORAGE_BACKEND=s3');
  }
  const credentials = config.accessKeyId && config.secretAccessKey
    ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    : config.endpoint
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        }
      : undefined; // default AWS credential provider chain

  const client = new S3Client({
    region: config.region || 'us-east-1',
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    credentials,
  });

  const bucket = config.bucket;

  async function getObject(dir: string, filename: string): Promise<{ content: string; etag: string }> {
    try {
      const res = await withS3Retry(() =>
        client.send(new GetObjectCommand({ Bucket: bucket, Key: keyFor(dir, filename) })),
      );
      const content = await res.Body!.transformToString();
      const etag = (res.ETag || '').replace(/^"|"$/g, '');
      return { content, etag };
    } catch (err) {
      throw s3ErrorToStorageError(err, config, filename);
    }
  }

  return {
    name: 's3',

    async listFiles(dir) {
      validateStorageDir(dir, 's3');
      const prefix = prefixFor(dir);
      try {
        const objects = await withS3Retry(() => listAllObjects(client, bucket, prefix));
        const listing: FileListing = splitFileListing(topLevelNames(objects.map(o => o.key), prefix));
        return listing;
      } catch (err) {
        throw s3ErrorToStorageError(err, config, dir || undefined);
      }
    },

    async readFile(dir, filename) {
      validateDiagramFileName(filename);
      const { content } = await getObject(dir, filename);
      return content;
    },

    async readFileVersion(dir, filename) {
      validateDiagramFileName(filename);
      const { content, etag } = await getObject(dir, filename);
      return { content, version: etag };
    },

    async writeFile(dir, filename, content, opts) {
      validateDiagramFileName(filename);
      const key = keyFor(dir, filename);
      try {
        if (opts?.ifMatchVersion !== undefined) {
          // Fast-fail compare (also covers endpoints that ignore IfMatch);
          // the PutObject IfMatch below is the atomic cross-process CAS.
          let currentEtag: string | null = null;
          try {
            currentEtag = (await getObject(dir, filename)).etag;
          } catch (err) {
            if (!isStorageError(err) || err.code !== 'not-found') throw err;
          }
          if (currentEtag === null || currentEtag !== opts.ifMatchVersion) {
            throw new StorageError(
              'conflict',
              `The file changed on disk since it was read; reload it before saving (${filename})`,
            );
          }
        }
        await withS3Retry(() =>
          client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: content,
            ContentType: 'text/plain; charset=utf-8',
            ...(opts?.ifMatchVersion !== undefined ? { IfMatch: opts.ifMatchVersion } : {}),
          })),
        );
      } catch (err) {
        throw s3ErrorToStorageError(err, config, filename);
      }
      // Read-back verification: the object must be byte-identical.
      const { content: onDisk } = await getObject(dir, filename);
      if (onDisk !== content) {
        throw new StorageError(
          'verify-failed',
          `Contents aren't saved: ${filename} on S3 does not match what was saved (${content.length} chars written, ${onDisk.length} read back)`,
        );
      }
      emitStorageChange('s3', dir, { event: 'change', file: filename });
    },

    async dirExists(dir) {
      validateStorageDir(dir, 's3');
      try {
        await withS3Retry(() => client.send(new HeadBucketCommand({ Bucket: bucket })));
      } catch (err) {
        throw s3ErrorToStorageError(err, config);
      }
      if (dir === '') return true; // bucket reachable -> root exists
      // S3 has no empty directories: the prefix exists iff at least one
      // object lives under it. This documented divergence is asserted in the
      // storage e2e suite (E7).
      try {
        const res = await withS3Retry(() =>
          client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefixFor(dir), MaxKeys: 1 })),
        );
        return (res.KeyCount ?? 0) > 0;
      } catch (err) {
        throw s3ErrorToStorageError(err, config, dir || undefined);
      }
    },

    watch(dir, onChange) {
      const intervalMs = config.pollIntervalMs ?? 0;
      if (intervalMs <= 0) return () => undefined; // polling off by default
      validateStorageDir(dir, 's3');
      const prefix = prefixFor(dir);
      let cache = new Map<string, string>(); // key -> etag|lastModified
      let baselineEstablished = false;
      let stopped = false;

      const poll = async () => {
        if (stopped) return;
        let objects: S3ObjectInfo[];
        try {
          objects = await withS3Retry(() => listAllObjects(client, bucket, prefix));
        } catch {
          return; // transient endpoint trouble: try again next tick
        }
        const next = new Map<string, string>();
        for (const obj of objects) {
          next.set(obj.key, `${obj.etag}|${obj.lastModified}`);
        }
        if (!baselineEstablished) {
          baselineEstablished = true;
          cache = next;
          return;
        }
        const events: StorageChangeEvent[] = [];
        for (const [key, sig] of next) {
          if (!cache.has(key)) events.push({ event: 'add', file: key.slice(prefix.length) });
          else if (cache.get(key) !== sig) events.push({ event: 'change', file: key.slice(prefix.length) });
        }
        for (const key of cache.keys()) {
          if (!next.has(key)) events.push({ event: 'unlink', file: key.slice(prefix.length) });
        }
        cache = next;
        for (const e of events) {
          if (!/\.(mmd|md|markdown)$/i.test(e.file)) continue;
          try {
            onChange(e);
          } catch {
            // ignore listener failures
          }
        }
      };

      const timer = setInterval(() => {
        void poll();
      }, intervalMs);
      (timer as { unref?: () => void }).unref?.();
      // establish the baseline immediately so the first diff is meaningful
      void poll();
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
  };
}
