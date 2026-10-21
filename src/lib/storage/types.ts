// Storage abstraction: the interface every persistence backend implements and
// the error taxonomy route handlers map to HTTP responses.
//
// The app persists everything in file content (the `%% CONFIG:` header of .mmd
// files and fenced blocks), so the storage surface is exactly: list a directory,
// read a file, write a file (atomically, with read-back verification and
// compare-and-swap), probe a directory, and notify on change. Three backends
// implement it — file system (default), in-memory, Amazon S3 — selected by
// STORAGE_BACKEND (see ./index.ts).

import { NextResponse } from 'next/server';

// Stable machine-readable error codes. Each maps to one HTTP status (below)
// and to a distinct surfacing in the client's save indicator.
export type StorageErrorCode =
  | 'invalid-name'   // filename/dir fails shared validation        → HTTP 400
  | 'not-found'      // file (or dir) does not exist                 → HTTP 404
  | 'conflict'       // compare-and-swap version mismatch            → job code 'conflict'
  | 'verify-failed'  // read-back after write is not byte-identical  → HTTP 500, "Contents aren't saved: …"
  | 'unavailable'    // backend unreachable / misconfigured / full   → HTTP 503
  | 'forbidden'      // permission denied                            → HTTP 403
  | 'too-large'      // payload/key over backend limit               → HTTP 413
  | 'unknown';       // anything else                                → HTTP 500

export class StorageError extends Error {
  code: StorageErrorCode;
  cause?: unknown;
  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

// Duck-type check that survives Next.js dev's per-route bundles: the
// StorageError class that threw can differ from the one referenced here.
export function isStorageError(err: unknown): err is StorageError {
  return (
    err instanceof Error &&
    err.name === 'StorageError' &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

export interface FileListing {
  files: string[];
  markdownFiles: string[];
}

export interface FileVersion {
  content: string;
  // fs/memory: sha256 of content at read time. s3: the object ETag.
  version: string;
}

export interface StorageChangeEvent {
  event: string;
  file: string;
}

export interface StorageBackend {
  readonly name: 'fs' | 'memory' | 's3';
  listFiles(dir: string): Promise<FileListing>;
  // Throws StorageError('not-found') when the file does not exist.
  readFile(dir: string, filename: string): Promise<string>;
  // Throws StorageError('not-found') when the file does not exist.
  readFileVersion(dir: string, filename: string): Promise<FileVersion>;
  /** Atomic + read-back verified write. If `ifMatchVersion` is given and the
   *  current version differs, throws `conflict` and writes nothing. */
  writeFile(dir: string, filename: string, content: string,
            opts?: { ifMatchVersion?: string }): Promise<void>;
  dirExists(dir: string): Promise<boolean>;
  /** External-change notifications. Optional: fs implements it via chokidar,
   *  s3 via polling (config-gated). API-mediated write events are emitted by
   *  every backend through `storageEvents` regardless. */
  watch?(dir: string, onChange: (e: StorageChangeEvent) => void): () => void;
}

export const STORAGE_ERROR_STATUS: Record<StorageErrorCode, number> = {
  'invalid-name': 400,
  'not-found': 404,
  'conflict': 409,
  'verify-failed': 500,
  'unavailable': 503,
  'forbidden': 403,
  'too-large': 413,
  'unknown': 500,
};

// Maps any thrown value to an HTTP response. StorageErrors keep their message
// and gain a machine-readable `code` (additive, backward compatible); coded
// app errors (e.g. JobError('verify-failed') from the markdown verification)
// reuse their code when it is a known storage code; anything else becomes a
// 500 'unknown'. Used by every route handler.
export function storageErrorToResponse(err: unknown): NextResponse {
  if (isStorageError(err)) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: STORAGE_ERROR_STATUS[err.code] ?? 500 },
    );
  }
  if (err instanceof Error && typeof (err as { code?: unknown }).code === 'string') {
    const code = (err as { code?: unknown }).code as StorageErrorCode;
    if (code in STORAGE_ERROR_STATUS) {
      return NextResponse.json(
        { error: err.message, code },
        { status: STORAGE_ERROR_STATUS[code] },
      );
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message, code: 'unknown' }, { status: 500 });
}
