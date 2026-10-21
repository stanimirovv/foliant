// Shared storage-backend conformance suite (R2/R3/R4). Every backend runs the
// same behavioral contract; per-backend divergences (documented in the plan
// and README) live in the backend-specific test files, not here.
//
// Legs:
//  - fs:     always — temp dir per test.
//  - memory: always — fresh backend + namespace per test.
//  - s3:     gated on STORAGE_TEST_S3_ENDPOINT (LocalStack; provided by the
//            e2e runner / CI). Exercises pagination, CAS and retry behavior
//            against a real S3-compatible endpoint.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { StorageBackend } from './types';
import { createFileSystemBackend } from './fileSystemBackend';
import { createMemoryBackend } from './memoryBackend';
import { createS3Backend, S3BackendConfig } from './s3Backend';
import { storageWriteQueue, subscribeStorageChanges } from './index';
import {
  S3Client,
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

interface ConformanceContext {
  backend: StorageBackend;
  dir: string;
  kind: 'fs' | 'memory' | 's3';
  cleanup?: () => Promise<void>;
  // Write a raw nested object (for the no-recursion test). Undefined for
  // backends without a nesting concept (memory).
  writeNestedObject?: (relativePath: string, content: string) => Promise<void>;
}

type MakeBackend = () => Promise<ConformanceContext>;

const BYTE_EDGE_CONTENT = [
  'sequenceDiagram',
  '    A->>B: crlf line\r\nwith crlf',
  '    A->>B: lone cr\rhere',
  '    A->>B: unicode üñïçødé 汉字',
  '    A->>B: emoji 🚀🎉',
  '', // trailing newline
].join('\n');

function describeStorageBackendConformance(label: string, makeBackend: MakeBackend) {
  describe(`storage backend conformance: ${label}`, () => {
    let ctx: ConformanceContext;

    beforeEach(async () => {
      ctx = await makeBackend();
      // Establish the dir/namespace the way the app does (the fs backend
      // creates the directory here, like the original /api/files mkdir -p).
      await ctx.backend.listFiles(ctx.dir);
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    it('round-trips content byte-identically (CRLF, lone CR, unicode, emoji, trailing newline)', async () => {
      await ctx.backend.writeFile(ctx.dir, 'edge.mmd', BYTE_EDGE_CONTENT);
      expect(await ctx.backend.readFile(ctx.dir, 'edge.mmd')).toBe(BYTE_EDGE_CONTENT);
    });

    it('round-trips filenames with spaces and unicode', async () => {
      const name = 'my diagram üñï çødé.mmd';
      await ctx.backend.writeFile(ctx.dir, name, 'sequenceDiagram\nA->>B: Hi');
      expect(await ctx.backend.readFile(ctx.dir, name)).toBe('sequenceDiagram\nA->>B: Hi');
      const listing = await ctx.backend.listFiles(ctx.dir);
      expect(listing.files).toContain(name);
    });

    it('accepts a 255-byte filename and rejects one byte more', async () => {
      const maxName = 'a'.repeat(255 - '.mmd'.length) + '.mmd';
      expect(Buffer.byteLength(maxName, 'utf-8')).toBe(255);
      await ctx.backend.writeFile(ctx.dir, maxName, 'x');
      expect(await ctx.backend.readFile(ctx.dir, maxName)).toBe('x');
      const tooLong = 'a'.repeat(256 - '.mmd'.length) + '.mmd';
      await expect(ctx.backend.writeFile(ctx.dir, tooLong, 'x'))
        .rejects.toMatchObject({ code: 'invalid-name' });
    });

    it('listFiles separates .mmd from .md/.markdown, case-insensitively, sorted', async () => {
      // Distinct base names: on case-insensitive filesystems (APFS default)
      // same-name-different-case files would collide.
      await ctx.backend.writeFile(ctx.dir, 'b.mmd', 'x');
      await ctx.backend.writeFile(ctx.dir, 'a.mmd', 'x');
      await ctx.backend.writeFile(ctx.dir, 'notes.md', '# n');
      await ctx.backend.writeFile(ctx.dir, 'upper.MD', '# n');
      await ctx.backend.writeFile(ctx.dir, 'long.markdown', '# n');
      await ctx.backend.writeFile(ctx.dir, 'other.Markdown', '# n');
      await ctx.backend.writeFile(ctx.dir, 'ignore.txt', 'x');
      const listing = await ctx.backend.listFiles(ctx.dir);
      expect(listing.files).toEqual(['a.mmd', 'b.mmd']);
      expect(listing.markdownFiles).toEqual(['long.markdown', 'notes.md', 'other.Markdown', 'upper.MD']);
    });

    it('listFiles does not recurse into subdirectories', async () => {
      await ctx.backend.writeFile(ctx.dir, 'top.mmd', 'x');
      await ctx.writeNestedObject?.('nested/inner.mmd', 'x');
      const listing = await ctx.backend.listFiles(ctx.dir);
      expect(listing.files).toEqual(['top.mmd']);
    });

    it('readFile of a missing file throws not-found', async () => {
      await expect(ctx.backend.readFile(ctx.dir, 'nope.mmd'))
        .rejects.toMatchObject({ code: 'not-found' });
    });

    it('rejects invalid file names with invalid-name', async () => {
      for (const bad of ['', '.', '..', 'a/b', 'a\\b', '/abs.mmd', '../escape.mmd']) {
        await expect(ctx.backend.readFile(ctx.dir, bad))
          .rejects.toMatchObject({ code: 'invalid-name' });
        await expect(ctx.backend.writeFile(ctx.dir, bad, 'x'))
          .rejects.toMatchObject({ code: 'invalid-name' });
      }
    });

    it('dirExists is false before anything exists and true after a write', async () => {
      const fresh = await makeBackend();
      try {
        expect(await fresh.backend.dirExists(fresh.dir)).toBe(false);
        // The app always lists before writing (fs: mkdir -p side effect).
        await fresh.backend.listFiles(fresh.dir);
        await fresh.backend.writeFile(fresh.dir, 'seed.mmd', 'x');
        expect(await fresh.backend.dirExists(fresh.dir)).toBe(true);
      } finally {
        await fresh.cleanup?.();
      }
    });

    it('listFiles establishes the dir/namespace (fs mkdir -p / memory namespace parity)', async () => {
      // s3 is the documented divergence: an empty prefix cannot "exist".
      if (ctx.kind === 's3') {
        expect(await ctx.backend.dirExists(ctx.dir)).toBe(false);
      } else {
        expect(await ctx.backend.dirExists(ctx.dir)).toBe(true);
      }
    });

    it('readFileVersion returns content and a stable version', async () => {
      await ctx.backend.writeFile(ctx.dir, 'v.mmd', 'one');
      const v1 = await ctx.backend.readFileVersion(ctx.dir, 'v.mmd');
      expect(v1.content).toBe('one');
      expect(typeof v1.version).toBe('string');
      expect(v1.version.length).toBeGreaterThan(0);
      const v2 = await ctx.backend.readFileVersion(ctx.dir, 'v.mmd');
      expect(v2.version).toBe(v1.version);
      await ctx.backend.writeFile(ctx.dir, 'v.mmd', 'two');
      const v3 = await ctx.backend.readFileVersion(ctx.dir, 'v.mmd');
      expect(v3.version).not.toBe(v1.version);
    });

    it('CAS: writeFile with the current ifMatchVersion succeeds', async () => {
      await ctx.backend.writeFile(ctx.dir, 'cas.mmd', 'base');
      const { version } = await ctx.backend.readFileVersion(ctx.dir, 'cas.mmd');
      await ctx.backend.writeFile(ctx.dir, 'cas.mmd', 'updated', { ifMatchVersion: version });
      expect(await ctx.backend.readFile(ctx.dir, 'cas.mmd')).toBe('updated');
    });

    it('CAS: writeFile with a stale ifMatchVersion throws conflict and writes nothing', async () => {
      await ctx.backend.writeFile(ctx.dir, 'cas.mmd', 'base');
      const { version } = await ctx.backend.readFileVersion(ctx.dir, 'cas.mmd');
      // an external writer changes the file
      await ctx.backend.writeFile(ctx.dir, 'cas.mmd', 'external');
      await expect(ctx.backend.writeFile(ctx.dir, 'cas.mmd', 'mine', { ifMatchVersion: version }))
        .rejects.toMatchObject({ code: 'conflict' });
      expect(await ctx.backend.readFile(ctx.dir, 'cas.mmd')).toBe('external');
    });

    it('CAS: writeFile with ifMatchVersion on a missing file throws conflict', async () => {
      await expect(
        ctx.backend.writeFile(ctx.dir, 'ghost.mmd', 'x', { ifMatchVersion: 'v1-deadbeef' }),
      ).rejects.toMatchObject({ code: 'conflict' });
      await expect(ctx.backend.readFile(ctx.dir, 'ghost.mmd'))
        .rejects.toMatchObject({ code: 'not-found' });
    });

    it('concurrent writes through the serial queue never interleave; the final content is one writer\'s', async () => {
      const writers = Array.from({ length: 8 }, (_, i) => `writer-${i}\n`);
      await Promise.all(
        writers.map(content =>
          storageWriteQueue.run(() => ctx.backend.writeFile(ctx.dir, 'race.mmd', content)),
        ),
      );
      const final = await ctx.backend.readFile(ctx.dir, 'race.mmd');
      expect(writers).toContain(final);
    });

    it('writeFile pulses a change event for its dir (API-mediated live reload)', async () => {
      const events: Array<{ event: string; file: string }> = [];
      const unsubscribe = subscribeStorageChanges(ctx.kind, ctx.dir, e => events.push(e));
      try {
        await ctx.backend.writeFile(ctx.dir, 'pulse.mmd', 'x');
        expect(events).toEqual([{ event: 'change', file: 'pulse.mmd' }]);
      } finally {
        unsubscribe();
      }
    });

    it('change events are scoped per dir', async () => {
      const other = await makeBackend();
      const events: string[] = [];
      const unsubscribe = subscribeStorageChanges(ctx.kind, ctx.dir, e => events.push(e.file));
      try {
        await other.backend.listFiles(other.dir); // establish the other dir/namespace
        await other.backend.writeFile(other.dir, 'other.mmd', 'x');
        expect(events).toEqual([]);
        await ctx.backend.writeFile(ctx.dir, 'mine.mmd', 'x');
        expect(events).toEqual(['mine.mmd']);
      } finally {
        unsubscribe();
        await other.cleanup?.();
      }
    });

    it('a ~5 MB diagram round-trips', async () => {
      const line = '    participant PX as Some Participant With A Fairly Long Display Name\n';
      const content = 'sequenceDiagram\n' + line.repeat(70000); // ~5 MB
      expect(content.length).toBeGreaterThan(4.5 * 1024 * 1024);
      await ctx.backend.writeFile(ctx.dir, 'big.mmd', content);
      expect(await ctx.backend.readFile(ctx.dir, 'big.mmd')).toBe(content);
    }, 30000);
  });
}

// --- fs leg (always) -------------------------------------------------------

describeStorageBackendConformance('fs', async () => {
  // The store dir intentionally does not exist yet: listFiles (called in the
  // shared beforeEach) creates it, like the original /api/files mkdir -p.
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-conf-fs-'));
  const dir = path.join(base, 'store');
  return {
    backend: createFileSystemBackend(),
    dir,
    kind: 'fs',
    writeNestedObject: async (relativePath, content) => {
      const target = path.join(dir, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    },
    cleanup: async () => {
      await fs.rm(base, { recursive: true, force: true });
    },
  };
});

// --- memory leg (always) ---------------------------------------------------

let memoryNsCounter = 0;
describeStorageBackendConformance('memory', async () => {
  memoryNsCounter += 1;
  return {
    backend: createMemoryBackend(),
    dir: `conf-${memoryNsCounter}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'memory',
  };
});

// --- s3 leg (gated on a reachable LocalStack endpoint) ---------------------

function s3ClientConfig(cfg: S3BackendConfig) {
  return {
    region: cfg.region || 'us-east-1',
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    },
  };
}

async function s3CleanupPrefix(cfg: S3BackendConfig, prefix: string): Promise<void> {
  const client = new S3Client(s3ClientConfig(cfg));
  let continuationToken: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: cfg.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const keys = (res.Contents ?? []).map(o => o.Key!).filter(Boolean);
    if (keys.length > 0) {
      await client.send(new DeleteObjectsCommand({
        Bucket: cfg.bucket,
        Delete: { Objects: keys.map(k => ({ Key: k })), Quiet: true },
      }));
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
}

const s3Endpoint = process.env.STORAGE_TEST_S3_ENDPOINT;
if (s3Endpoint) {
  const s3Config: S3BackendConfig = {
    bucket: process.env.STORAGE_TEST_S3_BUCKET || 'mermaid-viewer-e2e',
    endpoint: s3Endpoint,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
  };

  // Created once per test-file run; CreateBucket is idempotent (a second call
  // fails with BucketAlreadyOwnedByYou, which we ignore).
  const ensureBucket = (async () => {
    const client = new S3Client(s3ClientConfig(s3Config));
    try {
      await client.send(new CreateBucketCommand({ Bucket: s3Config.bucket }));
    } catch {
      // already exists
    }
  })();

  let s3PrefixCounter = 0;

  describeStorageBackendConformance('s3', async () => {
    await ensureBucket;
    s3PrefixCounter += 1;
    const dir = `conf${s3PrefixCounter}${Date.now().toString(36)}`;
    const client = new S3Client(s3ClientConfig(s3Config));
    const backend = createS3Backend(s3Config);
    return {
      backend,
      dir,
      kind: 's3',
      writeNestedObject: async (relativePath, content) => {
        await client.send(new PutObjectCommand({
          Bucket: s3Config.bucket,
          Key: `${dir}/${relativePath}`,
          Body: content,
        }));
      },
      cleanup: async () => {
        await s3CleanupPrefix(s3Config, `${dir}/`);
      },
    };
  });

  describe('storage backend conformance: s3 (endpoint-specific)', () => {
    it('paginates ListObjectsV2 beyond the 1000-key page size', async () => {
      const client = new S3Client(s3ClientConfig(s3Config));
      const dir = `pagination${Date.now().toString(36)}`;
      const backend = createS3Backend(s3Config);
      try {
        const total = 1001;
        for (let i = 0; i < total; i += 50) {
          await Promise.all(
            Array.from({ length: Math.min(50, total - i) }, (_, j) => {
              const n = i + j;
              return client.send(new PutObjectCommand({
                Bucket: s3Config.bucket,
                Key: `${dir}/f${String(n).padStart(4, '0')}.mmd`,
                Body: 'x',
              }));
            }),
          );
        }
        const listing = await backend.listFiles(dir);
        expect(listing.files).toHaveLength(total);
        expect(listing.files[0]).toBe('f0000.mmd');
        expect(listing.files[total - 1]).toBe('f1000.mmd');
      } finally {
        await s3CleanupPrefix(s3Config, `${dir}/`);
      }
    }, 180000);

    it('maps a missing bucket to unavailable with a message naming S3_BUCKET', async () => {
      const backend = createS3Backend({ ...s3Config, bucket: 'definitely-missing-bucket-xyz' });
      await expect(backend.listFiles(''))
        .rejects.toMatchObject({ code: 'unavailable' });
      await expect(backend.listFiles('')).rejects.toThrow(/S3_BUCKET/);
    });

    it('retries transient failures, then reports unavailable on a dead endpoint', async () => {
      const backend = createS3Backend({
        ...s3Config,
        endpoint: 'http://127.0.0.1:1', // nothing listening
      });
      const started = Date.now();
      await expect(backend.readFile('', 'x.mmd'))
        .rejects.toMatchObject({ code: 'unavailable' });
      // 3 attempts with ≈200/400/800 ms backoff: at least ~1.2 s of waiting.
      expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    }, 30000);
  });
}
