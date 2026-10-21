// Storage backend selection and process-wide storage state.
//
// getStorageBackend() returns the one process-wide StorageBackend, chosen by
// STORAGE_BACKEND (fs | memory | s3, default fs) and cached on globalThis:
// Next.js dev compiles each route into its own bundle, and per-bundle state
// would give each route its own backend (the memory backend would silently
// stop working in dev). The same pattern guards the serial write queue and the
// change-notification registry (see ./events.ts).
//
// Zero-config compatibility: with no STORAGE_BACKEND set, the fs backend
// behaves exactly as the app always has.

import { createSerialQueue, SerialQueue } from '../serialQueue';
import { getDiagramsDir } from '../config';
import { StorageBackend } from './types';
import { StorageBackendKind, validateStorageDir } from './validate';
import { createFileSystemBackend } from './fileSystemBackend';
import { createMemoryBackend, DEFAULT_MEMORY_NAMESPACE } from './memoryBackend';
import { createS3Backend, readS3ConfigFromEnv, S3BackendConfig } from './s3Backend';

export * from './types';
export * from './validate';
export { emitStorageChange, subscribeStorageChanges, storageEventsKey } from './events';
export type { StorageChangeListener } from './events';
export { createFileSystemBackend, writeFileAtomic } from './fileSystemBackend';
export { createMemoryBackend, DEFAULT_MEMORY_NAMESPACE } from './memoryBackend';
export { createS3Backend, readS3ConfigFromEnv } from './s3Backend';
export type { S3BackendConfig } from './s3Backend';

export interface StorageEnvConfig {
  kind: StorageBackendKind;
  memorySeedDir?: string;
  s3: S3BackendConfig;
}

export const STORAGE_BACKENDS: StorageBackendKind[] = ['fs', 'memory', 's3'];

// The active backend kind. Throws on an unknown STORAGE_BACKEND —
// misconfiguration is a boot error (server.js validates at startup), not a
// per-request 503.
export function getStorageBackendKind(): StorageBackendKind {
  const raw = (process.env.STORAGE_BACKEND || 'fs').trim().toLowerCase();
  if (!STORAGE_BACKENDS.includes(raw as StorageBackendKind)) {
    throw new Error(
      `Unknown STORAGE_BACKEND "${process.env.STORAGE_BACKEND}" — expected one of: ${STORAGE_BACKENDS.join(', ')}`,
    );
  }
  return raw as StorageBackendKind;
}

// Pure readers over process.env. See the env-var table in README.md.
export function readStorageEnv(): StorageEnvConfig {
  return {
    kind: getStorageBackendKind(),
    memorySeedDir: process.env.MEMORY_STORAGE_SEED_DIR || undefined,
    s3: readS3ConfigFromEnv(),
  };
}

// Build a backend directly (tests, the e2e runner). Not cached.
export function createStorageBackend(env: StorageEnvConfig): StorageBackend {
  switch (env.kind) {
    case 'fs':
      return createFileSystemBackend();
    case 'memory':
      return createMemoryBackend({ seedDir: env.memorySeedDir });
    case 's3':
      return createS3Backend(env.s3);
  }
}

const GLOBAL_BACKEND_KEY = '__mermaidSequenceViewerStorageBackend__';
const globalStore = globalThis as typeof globalThis & { [GLOBAL_BACKEND_KEY]?: StorageBackend };

export function getStorageBackend(): StorageBackend {
  if (!globalStore[GLOBAL_BACKEND_KEY]) {
    globalStore[GLOBAL_BACKEND_KEY] = createStorageBackend(readStorageEnv());
  }
  return globalStore[GLOBAL_BACKEND_KEY];
}

// Test hook: drop the cached backend so the next getStorageBackend() rebuilds
// from the current env.
export function resetStorageBackendCache(): void {
  delete globalStore[GLOBAL_BACKEND_KEY];
}

// Process-wide FIFO serial queue for storage writes (renamed from
// diskWriteQueue). Every write — whole-file POST saves and the markdown save
// job — runs inside it, so a read-modify-write can't interleave with another
// write. On globalThis for the same reason as the backend instance.
const GLOBAL_QUEUE_KEY = '__mermaidSequenceViewerStorageWriteQueue__';
const globalQueueStore = globalThis as typeof globalThis & { [GLOBAL_QUEUE_KEY]?: SerialQueue };
export const storageWriteQueue: SerialQueue =
  globalQueueStore[GLOBAL_QUEUE_KEY] ?? (globalQueueStore[GLOBAL_QUEUE_KEY] = createSerialQueue());

// Resolve the storage directory for a request, per the active backend:
//  - fs:     the diagrams directory (today's behavior, unchanged).
//  - memory: a namespace key ('default' when no ?dir=).
//  - s3:     an object-key prefix ('' — the bucket root — when no ?dir=).
export function resolveStorageDir(request?: Request): string {
  const backend = getStorageBackend();
  const dirParam = request ? new URL(request.url).searchParams.get('dir') : null;
  switch (backend.name) {
    case 'fs':
      return getDiagramsDir(request);
    case 'memory':
      return validateStorageDir(dirParam ?? DEFAULT_MEMORY_NAMESPACE, 'memory');
    case 's3':
      return validateStorageDir(dirParam ?? '', 's3');
  }
}
