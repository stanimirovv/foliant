import { describe, it, expect, afterEach } from 'vitest';
import { s3ErrorToStorageError, readS3ConfigFromEnv, createS3Backend } from './s3Backend';
import { StorageError } from './types';

const cfg = { bucket: 'my-bucket', endpoint: 'http://localhost:4566', region: 'us-east-1', forcePathStyle: true };

function s3Err(name: string, status?: number, message = name) {
  return Object.assign(new Error(message), {
    name,
    $metadata: { httpStatusCode: status },
  });
}

describe('s3ErrorToStorageError', () => {
  it('maps NoSuchKey to not-found', () => {
    expect(s3ErrorToStorageError(s3Err('NoSuchKey', 404), cfg, 'x.mmd').code).toBe('not-found');
  });

  it('maps NoSuchBucket to unavailable and names S3_BUCKET', () => {
    const err = s3ErrorToStorageError(s3Err('NoSuchBucket', 404), cfg);
    expect(err.code).toBe('unavailable');
    expect(err.message).toContain('S3_BUCKET');
    expect(err.message).toContain('my-bucket');
  });

  it('maps PreconditionFailed to conflict', () => {
    expect(s3ErrorToStorageError(s3Err('PreconditionFailed', 412), cfg, 'x.mmd').code).toBe('conflict');
  });

  it('maps access-denied variants to forbidden', () => {
    expect(s3ErrorToStorageError(s3Err('AccessDenied', 403), cfg).code).toBe('forbidden');
    expect(s3ErrorToStorageError(s3Err('AllAccessDisabled', 403), cfg).code).toBe('forbidden');
    expect(s3ErrorToStorageError(s3Err('Forbidden', 403), cfg).code).toBe('forbidden');
  });

  it('maps EntityTooLarge to too-large', () => {
    expect(s3ErrorToStorageError(s3Err('EntityTooLarge', 400), cfg).code).toBe('too-large');
  });

  it('maps bare 404/403 statuses without an SDK error name', () => {
    expect(s3ErrorToStorageError(s3Err('UnknownError', 404), cfg).code).toBe('not-found');
    expect(s3ErrorToStorageError(s3Err('UnknownError', 403), cfg).code).toBe('forbidden');
  });

  it('maps 5xx to unavailable and anything else to unknown', () => {
    expect(s3ErrorToStorageError(s3Err('InternalError', 500), cfg).code).toBe('unavailable');
    expect(s3ErrorToStorageError(s3Err('Weird', 418), cfg).code).toBe('unknown');
    expect(s3ErrorToStorageError('nope', cfg).code).toBe('unknown');
  });

  it('passes StorageErrors through unchanged', () => {
    const original = new StorageError('conflict', 'already conflicted');
    expect(s3ErrorToStorageError(original, cfg)).toBe(original);
  });
});

describe('readS3ConfigFromEnv', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('defaults: real S3, virtual-host style, polling off', () => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_FORCE_PATH_STYLE;
    delete process.env.S3_POLL_INTERVAL_MS;
    delete process.env.S3_BUCKET;
    const config = readS3ConfigFromEnv();
    expect(config.bucket).toBe('');
    expect(config.endpoint).toBeUndefined();
    expect(config.region).toBe('us-east-1');
    expect(config.forcePathStyle).toBe(false);
    expect(config.pollIntervalMs).toBe(0);
  });

  it('endpoint set: path-style addressing defaults to true (LocalStack)', () => {
    process.env.S3_ENDPOINT = 'http://localhost:4566';
    delete process.env.S3_FORCE_PATH_STYLE;
    expect(readS3ConfigFromEnv().forcePathStyle).toBe(true);
    process.env.S3_FORCE_PATH_STYLE = 'false';
    expect(readS3ConfigFromEnv().forcePathStyle).toBe(false);
  });

  it('parses S3_POLL_INTERVAL_MS and ignores junk', () => {
    process.env.S3_POLL_INTERVAL_MS = '1000';
    expect(readS3ConfigFromEnv().pollIntervalMs).toBe(1000);
    process.env.S3_POLL_INTERVAL_MS = 'junk';
    expect(readS3ConfigFromEnv().pollIntervalMs).toBe(0);
  });
});

describe('createS3Backend', () => {
  it('requires S3_BUCKET', () => {
    expect(() => createS3Backend({ bucket: '' }))
      .toThrow(/S3_BUCKET is required/);
  });
});
