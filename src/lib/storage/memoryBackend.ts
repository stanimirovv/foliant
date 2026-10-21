// In-memory storage backend. Volatile by design: everything lives in a Map
// for the process lifetime and is lost on server restart. Intended for
// scratchpads and testing — the UI surfaces a banner when this backend is
// active. There is no external writer, so live reload is API-mediated only
// (writeFile pulses the shared storageEvents emitter).
//
// Semantics mirror the fs backend: listFiles creates the namespace (parity
// with the fs `mkdir -p` side effect), writes are atomic by construction
// (single-threaded Map mutation inside the caller's serial write queue), and
// every write is read back and must be byte-identical.

import fs from 'fs/promises';
import path from 'path';
import { StorageBackend, StorageError } from './types';
import { validateDiagramFileName, validateStorageDir } from './validate';
import { sha256, splitFileListing } from './fileSystemBackend';
import { emitStorageChange } from './events';

export const DEFAULT_MEMORY_NAMESPACE = 'default';

interface MemoryEntry {
  content: string;
  version: number;
  hash: string;
}

export interface MemoryBackendOptions {
  // Optional directory whose files seed the default namespace at boot.
  seedDir?: string;
}

export function createMemoryBackend(opts: MemoryBackendOptions = {}): StorageBackend {
  // namespace (dir) -> filename -> entry
  const namespaces = new Map<string, Map<string, MemoryEntry>>();
  let versionCounter = 0;

  // Seeding is async; every operation awaits it so the first request after
  // boot already sees the seeded files.
  const seedPromise: Promise<void> = (async () => {
    if (!opts.seedDir) return;
    try {
      const names = await fs.readdir(opts.seedDir);
      const ns = namespaces.get(DEFAULT_MEMORY_NAMESPACE) ?? new Map<string, MemoryEntry>();
      namespaces.set(DEFAULT_MEMORY_NAMESPACE, ns);
      for (const name of names) {
        if (/\.(mmd|md|markdown)$/i.test(name)) {
          try {
            const content = await fs.readFile(path.join(opts.seedDir, name), 'utf-8');
            ns.set(name, { content, version: ++versionCounter, hash: sha256(content) });
          } catch {
            // skip unreadable seed files
          }
        }
      }
    } catch {
      // a missing/unreadable seed dir just means an empty store
    }
  })();

  function namespaceFor(dir: string): Map<string, MemoryEntry> {
    validateStorageDir(dir, 'memory');
    let ns = namespaces.get(dir);
    if (!ns) {
      ns = new Map();
      namespaces.set(dir, ns);
    }
    return ns;
  }

  function versionString(entry: MemoryEntry): string {
    return `v${entry.version}-${entry.hash}`;
  }

  return {
    name: 'memory',

    async listFiles(dir) {
      await seedPromise;
      const ns = namespaceFor(dir); // creates the namespace, like fs mkdir -p
      return splitFileListing([...ns.keys()]);
    },

    async readFile(dir, filename) {
      await seedPromise;
      validateDiagramFileName(filename);
      const entry = namespaces.get(dir)?.get(filename);
      if (!entry) {
        throw new StorageError('not-found', `File not found: ${filename}`);
      }
      return entry.content;
    },

    async readFileVersion(dir, filename) {
      await seedPromise;
      validateDiagramFileName(filename);
      const entry = namespaces.get(dir)?.get(filename);
      if (!entry) {
        throw new StorageError('not-found', `File not found: ${filename}`);
      }
      return { content: entry.content, version: versionString(entry) };
    },

    async writeFile(dir, filename, content, opts) {
      await seedPromise;
      validateDiagramFileName(filename);
      const ns = namespaceFor(dir); // creates the namespace, like fs write into a new dir after listFiles
      if (opts?.ifMatchVersion !== undefined) {
        const current = ns.get(filename);
        const currentVersion = current ? versionString(current) : null;
        if (currentVersion === null || currentVersion !== opts.ifMatchVersion) {
          throw new StorageError(
            'conflict',
            `The file changed on disk since it was read; reload it before saving (${filename})`,
          );
        }
      }
      ns.set(filename, { content, version: ++versionCounter, hash: sha256(content) });
      // Read-back verification. A mismatch here indicates a bug in this
      // backend — fail loudly rather than serve divergent state.
      const readBack = ns.get(filename);
      if (!readBack || readBack.content !== content) {
        throw new StorageError(
          'verify-failed',
          `Contents aren't saved: ${filename} in memory does not match what was saved`,
        );
      }
      emitStorageChange('memory', dir, { event: 'change', file: filename });
    },

    async dirExists(dir) {
      await seedPromise;
      try {
        validateStorageDir(dir, 'memory');
      } catch {
        return false;
      }
      return namespaces.has(dir);
    },

    // No watch(): the memory backend has no external writer by design;
    // API-mediated changes arrive through the storageEvents emitter.
  };
}
