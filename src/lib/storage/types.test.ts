import { describe, it, expect } from 'vitest';
import {
  StorageError,
  STORAGE_ERROR_STATUS,
  storageErrorToResponse,
  isStorageError,
  StorageErrorCode,
} from './types';

describe('StorageError', () => {
  it('carries a code, message, and optional cause', () => {
    const cause = new Error('boom');
    const err = new StorageError('not-found', 'missing', cause);
    expect(err.name).toBe('StorageError');
    expect(err.code).toBe('not-found');
    expect(err.message).toBe('missing');
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
  });

  it('isStorageError duck-types across bundle boundaries', () => {
    expect(isStorageError(new StorageError('unknown', 'x'))).toBe(true);
    // a look-alike from another bundle (different class identity)
    const foreign = new Error('x') as Error & { code: string };
    foreign.name = 'StorageError';
    foreign.code = 'conflict';
    expect(isStorageError(foreign)).toBe(true);
    expect(isStorageError(new Error('plain'))).toBe(false);
    expect(isStorageError({ code: 'conflict' })).toBe(false);
    expect(isStorageError('nope')).toBe(false);
  });
});

describe('storageErrorToResponse', () => {
  const cases: Array<[StorageErrorCode, number]> = [
    ['invalid-name', 400],
    ['not-found', 404],
    ['conflict', 409],
    ['verify-failed', 500],
    ['unavailable', 503],
    ['forbidden', 403],
    ['too-large', 413],
    ['unknown', 500],
  ];

  it.each(cases)('maps %s → %i with { error, code } body', async (code, status) => {
    const res = storageErrorToResponse(new StorageError(code, `msg-${code}`));
    expect(res.status).toBe(status);
    expect(res.status).toBe(STORAGE_ERROR_STATUS[code]);
    expect(await res.json()).toEqual({ error: `msg-${code}`, code });
  });

  it('maps non-storage errors to 500 unknown', async () => {
    const res = storageErrorToResponse(new Error('kaput'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'kaput', code: 'unknown' });
    const res2 = storageErrorToResponse('string failure');
    expect(res2.status).toBe(500);
    expect(await res2.json()).toEqual({ error: 'string failure', code: 'unknown' });
  });
});
