import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import {
  getStorageBackend,
  getStorageBackendKind,
  readStorageEnv,
  resolveStorageDir,
  resetStorageBackendCache,
  storageWriteQueue,
  subscribeStorageChanges,
  emitStorageChange,
} from './index';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetStorageBackendCache();
});

describe('getStorageBackendKind', () => {
  it('defaults to fs with no env (zero-config compatibility)', () => {
    delete process.env.STORAGE_BACKEND;
    expect(getStorageBackendKind()).toBe('fs');
  });

  it('accepts fs, memory, s3 (case/whitespace tolerant)', () => {
    process.env.STORAGE_BACKEND = 'memory';
    expect(getStorageBackendKind()).toBe('memory');
    process.env.STORAGE_BACKEND = ' S3 ';
    expect(getStorageBackendKind()).toBe('s3');
  });

  it('throws a clear error on an unknown backend (misconfiguration is a boot error)', () => {
    process.env.STORAGE_BACKEND = 'bogus';
    expect(() => getStorageBackendKind()).toThrow(/Unknown STORAGE_BACKEND "bogus"/);
  });
});

describe('readStorageEnv', () => {
  it('reads the memory seed dir', () => {
    process.env.STORAGE_BACKEND = 'memory';
    process.env.MEMORY_STORAGE_SEED_DIR = './diagrams';
    expect(readStorageEnv().memorySeedDir).toBe('./diagrams');
  });
});

describe('getStorageBackend', () => {
  it('caches one instance on globalThis (shared across route bundles in dev)', () => {
    delete process.env.STORAGE_BACKEND;
    const a = getStorageBackend();
    const b = getStorageBackend();
    expect(a).toBe(b);
    expect(a.name).toBe('fs');
  });

  it('builds a memory backend when selected', () => {
    process.env.STORAGE_BACKEND = 'memory';
    expect(getStorageBackend().name).toBe('memory');
  });

  it('throws for s3 without S3_BUCKET (the boot check in server.js mirrors this)', () => {
    process.env.STORAGE_BACKEND = 's3';
    delete process.env.S3_BUCKET;
    expect(() => getStorageBackend()).toThrow(/S3_BUCKET is required/);
  });
});

describe('resolveStorageDir', () => {
  const req = (url: string) => new Request(url);

  it('fs: ?dir= resolves to an absolute path; default is DIAGRAMS_DIR or ./diagrams', () => {
    delete process.env.STORAGE_BACKEND;
    delete process.env.DIAGRAMS_DIR;
    expect(resolveStorageDir(req('http://x/api/files?dir=rel/dir'))).toBe(path.resolve('rel/dir'));
    expect(resolveStorageDir(req('http://x/api/files'))).toBe(path.join(process.cwd(), 'diagrams'));
    process.env.DIAGRAMS_DIR = '/data/diagrams';
    expect(resolveStorageDir(req('http://x/api/files'))).toBe('/data/diagrams');
  });

  it('memory: ?dir= is the namespace; default is "default"', () => {
    process.env.STORAGE_BACKEND = 'memory';
    expect(resolveStorageDir(req('http://x/api/files?dir=scratch'))).toBe('scratch');
    expect(resolveStorageDir(req('http://x/api/files'))).toBe('default');
  });

  it('s3: ?dir= is the prefix; default is the bucket root', () => {
    process.env.STORAGE_BACKEND = 's3';
    process.env.S3_BUCKET = 'b';
    expect(resolveStorageDir(req('http://x/api/files?dir=flows/'))).toBe('flows');
    expect(resolveStorageDir(req('http://x/api/files'))).toBe('');
  });
});

describe('storageWriteQueue', () => {
  it('serializes tasks FIFO', async () => {
    const order: number[] = [];
    await Promise.all([
      storageWriteQueue.run(async () => { await new Promise(r => setTimeout(r, 30)); order.push(1); }),
      storageWriteQueue.run(async () => { order.push(2); }),
      storageWriteQueue.run(async () => { order.push(3); }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('a failing task does not block the queue', async () => {
    const order: string[] = [];
    await Promise.allSettled([
      storageWriteQueue.run(async () => { throw new Error('boom'); }),
      storageWriteQueue.run(async () => { order.push('after'); }),
    ]);
    expect(order).toEqual(['after']);
  });
});

describe('storageEvents emitter', () => {
  it('delivers events to subscribers and stops after unsubscribe', () => {
    const seen: string[] = [];
    const unsub = subscribeStorageChanges('memory', 'evt-test', e => seen.push(e.file));
    emitStorageChange('memory', 'evt-test', { event: 'change', file: 'a.mmd' });
    emitStorageChange('memory', 'other', { event: 'change', file: 'b.mmd' }); // different dir
    emitStorageChange('fs', 'evt-test', { event: 'change', file: 'c.mmd' }); // different kind
    unsub();
    emitStorageChange('memory', 'evt-test', { event: 'change', file: 'd.mmd' });
    expect(seen).toEqual(['a.mmd']);
  });

  it('a throwing listener does not break emit or other listeners', () => {
    const seen: string[] = [];
    const unsub1 = subscribeStorageChanges('memory', 'evt-throw', () => { throw new Error('listener boom'); });
    const unsub2 = subscribeStorageChanges('memory', 'evt-throw', e => seen.push(e.file));
    emitStorageChange('memory', 'evt-throw', { event: 'change', file: 'x.mmd' });
    expect(seen).toEqual(['x.mmd']);
    unsub1();
    unsub2();
  });
});
