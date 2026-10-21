// File-system storage backend (the default). This is the app's original
// persistence layer moved behind the StorageBackend interface with zero
// behavior change:
//  - listFiles creates the directory (mkdir -p side effect, as before);
//  - writes are atomic (temp file in the same dir + fsync + rename), write
//    through symlinks to their real target, and keep an existing file's mode;
//  - every write is read back and must be byte-identical;
//  - watch() is the chokidar per-directory watcher behind live reload.
//
// On top of the original behavior this backend adds compare-and-swap: a
// version (sha256 of the content) is returned by readFileVersion and checked
// by writeFile when `ifMatchVersion` is given. The check runs inside the
// process-wide storageWriteQueue (routes run every write inside it), so the
// read-compare-write is serialized against other writes.

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import chokidar, { FSWatcher } from 'chokidar';
import {
  FileListing,
  StorageBackend,
  StorageChangeEvent,
  StorageError,
} from './types';
import { validateDiagramFileName, MAX_FILENAME_BYTES } from './validate';
import { emitStorageChange } from './events';

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

// Split a flat name list into diagram files and markdown files. Matching is
// case-insensitive (.MD / .Markdown count as markdown everywhere) and both
// lists come back sorted so every backend lists identically.
export function splitFileListing(names: string[]): FileListing {
  const files: string[] = [];
  const markdownFiles: string[] = [];
  for (const name of names) {
    if (/\.mmd$/i.test(name)) files.push(name);
    else if (/\.(md|markdown)$/i.test(name)) markdownFiles.push(name);
  }
  files.sort();
  markdownFiles.sort();
  return { files, markdownFiles };
}

// Map an fs errno to the storage error taxonomy.
export function fsErrorToStorageError(err: unknown, filename: string): StorageError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'ENOENT':
      return new StorageError('not-found', `File not found: ${filename}`, err);
    case 'EACCES':
    case 'EPERM':
      return new StorageError('forbidden', `Permission denied: ${filename}`, err);
    case 'ENOSPC':
      return new StorageError('unavailable', `No space left on device: ${filename}`, err);
    case 'EROFS':
      return new StorageError('unavailable', `Read-only file system: ${filename}`, err);
    case 'EDQUOT':
      return new StorageError('unavailable', `Disk quota exceeded: ${filename}`, err);
    case 'EBUSY':
    case 'EMFILE':
      return new StorageError('unavailable', `Storage temporarily unavailable: ${filename}`, err);
    case 'ENAMETOOLONG':
      return new StorageError('invalid-name', `File name too long: ${filename}`, err);
    default:
      return new StorageError('unknown', err instanceof Error ? err.message : String(err), err);
  }
}

// Atomically replace `filePath` with `content`. A symlinked file is written
// through to its real target (the link survives), and an existing file keeps
// its permissions. The temp file is removed if anything fails.
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  let target = filePath;
  let mode: number | undefined;
  try {
    target = await fs.realpath(filePath);
    mode = (await fs.stat(target)).mode & 0o7777;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; // new file
  }
  // The temp file lives next to the target and carries a suffix; keep the
  // whole component within the 255-byte filesystem limit even for a
  // max-length target name (code-point safe truncation).
  const tmpSuffix = `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const room = MAX_FILENAME_BYTES - Buffer.byteLength(tmpSuffix, 'utf-8');
  const base = path.basename(target);
  const tmpBase = Buffer.byteLength(base, 'utf-8') > room
    ? [...base].slice(0, room).join('')
    : base;
  const tmp = path.join(path.dirname(target), tmpBase + tmpSuffix);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await fs.rename(tmp, target);
  } catch (err) {
    await handle?.close().catch(() => undefined);
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export function createFileSystemBackend(): StorageBackend {
  // chokidar watchers per directory, created on first subscribe and closed
  // when the last subscriber for that directory leaves.
  const watchers = new Map<string, {
    watcher: FSWatcher;
    listeners: Set<(e: StorageChangeEvent) => void>;
  }>();

  async function readFile(dir: string, filename: string): Promise<string> {
    validateDiagramFileName(filename);
    try {
      return await fs.readFile(path.join(dir, filename), 'utf-8');
    } catch (err) {
      throw fsErrorToStorageError(err, filename);
    }
  }

  return {
    name: 'fs',

    async listFiles(dir) {
      try {
        await fs.mkdir(dir, { recursive: true });
        const names = await fs.readdir(dir);
        return splitFileListing(names);
      } catch (err) {
        throw fsErrorToStorageError(err, dir);
      }
    },

    readFile,

    async readFileVersion(dir, filename) {
      const content = await readFile(dir, filename);
      return { content, version: sha256(content) };
    },

    async writeFile(dir, filename, content, opts) {
      validateDiagramFileName(filename);
      const filePath = path.join(dir, filename);
      if (opts?.ifMatchVersion !== undefined) {
        let currentVersion: string | null = null;
        try {
          currentVersion = sha256(await fs.readFile(filePath, 'utf-8'));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw fsErrorToStorageError(err, filename);
          }
        }
        if (currentVersion === null || currentVersion !== opts.ifMatchVersion) {
          throw new StorageError(
            'conflict',
            `The file changed on disk since it was read; reload it before saving (${filename})`,
          );
        }
      }
      try {
        await writeFileAtomic(filePath, content);
      } catch (err) {
        throw fsErrorToStorageError(err, filename);
      }
      // Read-back verification: the file on disk must be byte-identical to
      // what was meant to be written.
      let onDisk: string;
      try {
        onDisk = await fs.readFile(filePath, 'utf-8');
      } catch (err) {
        throw new StorageError(
          'verify-failed',
          `Contents aren't saved: could not read ${filename} back after saving`,
          err,
        );
      }
      if (onDisk !== content) {
        throw new StorageError(
          'verify-failed',
          `Contents aren't saved: ${filename} on disk does not match what was saved (${content.length} chars written, ${onDisk.length} read back)`,
        );
      }
      emitStorageChange('fs', dir, { event: 'change', file: filename });
    },

    async dirExists(dir) {
      try {
        const stat = await fs.stat(dir);
        return stat.isDirectory();
      } catch {
        return false;
      }
    },

    watch(dir, onChange) {
      let state = watchers.get(dir);
      if (!state) {
        const listeners = new Set<(e: StorageChangeEvent) => void>();
        // chokidar v4+ removed glob support: watching ['*.mmd', '*.md', ...]
        // would watch literal files with those names and never fire. Watch the
        // directory's top level instead and filter by extension here.
        const watcher = chokidar.watch('.', { cwd: dir, ignoreInitial: true, depth: 0 });
        watcher.on('all', (event: string, file: string) => {
          if (!/\.(mmd|md|markdown)$/i.test(file)) return;
          const e = { event, file };
          for (const listener of [...listeners]) {
            try {
              listener(e);
            } catch {
              // ignore listener failures
            }
          }
        });
        state = { watcher, listeners };
        watchers.set(dir, state);
      }
      state.listeners.add(onChange);
      return () => {
        const current = watchers.get(dir);
        if (!current) return;
        current.listeners.delete(onChange);
        if (current.listeners.size === 0) {
          watchers.delete(dir);
          current.watcher.close().catch(() => undefined);
        }
      };
    },
  };
}
