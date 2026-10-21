import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createFileSystemBackend, fsErrorToStorageError, writeFileAtomic } from './fileSystemBackend';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fs-backend-test-'));
}

describe('fsErrorToStorageError', () => {
  const err = (code: string) => Object.assign(new Error(code), { code });

  it('maps errno codes to the taxonomy', () => {
    expect(fsErrorToStorageError(err('ENOENT'), 'x').code).toBe('not-found');
    expect(fsErrorToStorageError(err('EACCES'), 'x').code).toBe('forbidden');
    expect(fsErrorToStorageError(err('EPERM'), 'x').code).toBe('forbidden');
    expect(fsErrorToStorageError(err('ENOSPC'), 'x').code).toBe('unavailable');
    expect(fsErrorToStorageError(err('EROFS'), 'x').code).toBe('unavailable');
    expect(fsErrorToStorageError(err('EDQUOT'), 'x').code).toBe('unavailable');
    expect(fsErrorToStorageError(err('EBUSY'), 'x').code).toBe('unavailable');
    expect(fsErrorToStorageError(err('EMFILE'), 'x').code).toBe('unavailable');
    expect(fsErrorToStorageError(err('EIO'), 'x').code).toBe('unknown');
    expect(fsErrorToStorageError(new Error('plain'), 'x').code).toBe('unknown');
  });
});

describe('fileSystemBackend (fs-specific behavior)', () => {
  let dir: string;
  const backend = createFileSystemBackend();

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('listFiles creates a missing directory (today\'s mkdir -p side effect)', async () => {
    const missing = path.join(dir, 'brand-new');
    expect(await backend.dirExists(missing)).toBe(false);
    const listing = await backend.listFiles(missing);
    expect(listing).toEqual({ files: [], markdownFiles: [] });
    expect(await backend.dirExists(missing)).toBe(true);
  });

  it('writeFile into a missing directory throws not-found (no implicit mkdir)', async () => {
    const missing = path.join(dir, 'nope');
    await expect(backend.writeFile(missing, 'x.mmd', 'x'))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  it('dirExists distinguishes directories from files and missing paths', async () => {
    const file = path.join(dir, 'a.mmd');
    await fs.writeFile(file, 'x');
    expect(await backend.dirExists(file)).toBe(false);
    expect(await backend.dirExists(path.join(dir, 'gone'))).toBe(false);
    expect(await backend.dirExists(dir)).toBe(true);
  });

  it('writes through a symlink to the real target and keeps the link', async () => {
    const real = path.join(dir, 'real.mmd');
    await fs.writeFile(real, 'original');
    const link = path.join(dir, 'link.mmd');
    await fs.symlink(real, link);
    await backend.writeFile(dir, 'link.mmd', 'updated');
    expect(await fs.readFile(real, 'utf-8')).toBe('updated');
    const stat = await fs.lstat(link);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('an existing file keeps its permissions across a write', async () => {
    const file = path.join(dir, 'mode.mmd');
    await fs.writeFile(file, 'original');
    await fs.chmod(file, 0o640);
    await backend.writeFile(dir, 'mode.mmd', 'updated');
    const mode = (await fs.stat(file)).mode & 0o777;
    expect(mode).toBe(0o640);
  });

  it('watch() emits external changes for diagram/markdown files only', async () => {
    const events: Array<{ event: string; file: string }> = [];
    const stop = backend.watch!(dir, e => events.push(e));
    try {
      // let chokidar arm
      await new Promise(resolve => setTimeout(resolve, 300));
      await fs.writeFile(path.join(dir, 'ext.mmd'), 'x');
      await fs.writeFile(path.join(dir, 'notes.md'), 'x');
      await fs.writeFile(path.join(dir, 'ignore.txt'), 'x');
      await new Promise(resolve => setTimeout(resolve, 700));
      // One external write can surface as several chokidar events (add+change
      // on macOS FSEvents); the contract under test is the extension filter,
      // so assert on the set of files that produced events.
      const files = [...new Set(events.map(e => e.file))].sort();
      expect(files).toEqual(['ext.mmd', 'notes.md']);
    } finally {
      stop();
    }
  }, 15000);

  it('watch() closes the watcher when the last subscriber leaves', async () => {
    const stop1 = backend.watch!(dir, () => undefined);
    const stop2 = backend.watch!(dir, () => undefined);
    stop1();
    stop2();
    // no throw, and a fresh watch still works afterwards
    const events: string[] = [];
    const stop3 = backend.watch!(dir, e => events.push(e.file));
    await new Promise(resolve => setTimeout(resolve, 300));
    await fs.writeFile(path.join(dir, 'again.mmd'), 'x');
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(events).toContain('again.mmd');
    stop3();
  }, 15000);

  it('writeFileAtomic leaves no temp files behind on success', async () => {
    const file = path.join(dir, 'atomic.mmd');
    await writeFileAtomic(file, 'content');
    const names = await fs.readdir(dir);
    expect(names).toEqual(['atomic.mmd']);
    expect(await fs.readFile(file, 'utf-8')).toBe('content');
  });

  // Permission-based tests are meaningless as root (root bypasses mode bits).
  const itUnlessRoot = process.getuid && process.getuid() === 0 ? it.skip : it;

  itUnlessRoot('writing into a read-only directory throws forbidden', async () => {
    const ro = path.join(dir, 'readonly');
    await fs.mkdir(ro);
    await fs.chmod(ro, 0o555);
    try {
      await expect(backend.writeFile(ro, 'x.mmd', 'x'))
        .rejects.toMatchObject({ code: 'forbidden' });
    } finally {
      await fs.chmod(ro, 0o755);
    }
  });
});
