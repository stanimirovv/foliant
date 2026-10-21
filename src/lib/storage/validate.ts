// Shared storage validation. Every backend rejects the same file names so a
// diagram that saves on one backend saves on all of them; the rules are the
// strictest common denominator of the backends (S3 keys allow almost anything
// up to 1024 bytes, filesystems cap name components at 255 bytes).

import path from 'path';
import os from 'os';
import { StorageError } from './types';

// A single path component is at most 255 bytes on common filesystems (ext4,
// APFS, NTFS). Enforced for every backend so behavior is identical everywhere;
// only rejects names that would fail on a common filesystem anyway.
export const MAX_FILENAME_BYTES = 255;

export function expandTilde(filepath: string) {
  if (filepath.charCodeAt(0) === 126 /* ~ */) {
    if (filepath.length === 1 || filepath.charCodeAt(1) === 47 /* / */ || filepath.charCodeAt(1) === 92 /* \ */) {
      return os.homedir() + filepath.slice(1);
    }
  }
  return filepath;
}

// Resolve a user-supplied directory path (tilde-expanded, made absolute)
// without any fallback or side effects.
export function resolveDirPath(dirParam: string): string {
  return path.resolve(expandTilde(dirParam));
}

// Throws StorageError('invalid-name') unless `filename` is a safe single path
// component. Rejection set (unchanged from the original validator): empty,
// '/', '\', '.', '..', absolute paths — plus the shared 255-byte cap.
export function validateDiagramFileName(filename: string): void {
  if (
    !filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename === '.' ||
    filename === '..' ||
    path.isAbsolute(filename)
  ) {
    throw new StorageError('invalid-name', 'Invalid file name');
  }
  if (Buffer.byteLength(filename, 'utf-8') > MAX_FILENAME_BYTES) {
    throw new StorageError(
      'invalid-name',
      `Invalid file name: longer than ${MAX_FILENAME_BYTES} bytes`,
    );
  }
}

export type StorageBackendKind = 'fs' | 'memory' | 's3';

// Validates/normalizes a storage directory (the `dir` concept) for a backend
// kind and returns the canonical form the backend works with:
//  - fs:     filesystem path (tilde-expanded, absolute) — unchanged behavior.
//  - memory: namespace key — non-empty, no control characters.
//  - s3:     object-key prefix — leading/trailing slashes stripped, no '..'
//            segments, no backslashes (prefix-escape guard). '' is the
//            bucket root and is valid.
export function validateStorageDir(dir: string, kind: StorageBackendKind): string {
  if (kind === 'fs') {
    return resolveDirPath(dir);
  }
  if (kind === 'memory') {
    if (!dir || /[\x00-\x1f\x7f]/.test(dir)) {
      throw new StorageError('invalid-name', 'Invalid directory name');
    }
    return dir;
  }
  // s3
  const prefix = dir.replace(/^\/+|\/+$/g, '');
  if (prefix.includes('\\') || prefix.split('/').some(seg => seg === '..')) {
    throw new StorageError('invalid-name', 'Invalid directory name');
  }
  if (Buffer.byteLength(prefix, 'utf-8') > 1024) {
    throw new StorageError('invalid-name', 'Invalid directory name: prefix too long');
  }
  return prefix;
}
