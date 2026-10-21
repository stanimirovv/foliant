import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import {
  validateDiagramFileName,
  validateStorageDir,
  resolveDirPath,
  MAX_FILENAME_BYTES,
} from './validate';
import { isStorageError } from './types';

describe('validateDiagramFileName', () => {
  it('accepts ordinary file names', () => {
    for (const name of ['main.mmd', 'notes.md', '..foo.mmd', '.hidden.mmd', 'with space.mmd', 'üñïçødé.mmd', 'a'.repeat(100) + '.mmd']) {
      expect(() => validateDiagramFileName(name)).not.toThrow();
    }
  });

  it('rejects the original rejection set', () => {
    for (const name of ['', '/', '\\', '.', '..', 'a/b', 'a\\b', '/etc/passwd', '..\\..\\x', 'foo/../bar']) {
      expect(() => validateDiagramFileName(name)).toThrowError(/Invalid file name/);
    }
  });

  it('rejects names over the shared 255-byte cap', () => {
    expect(() => validateDiagramFileName('a'.repeat(MAX_FILENAME_BYTES) + '.mmd')).toThrowError(/255/);
    expect(() => validateDiagramFileName('€'.repeat(128))).toThrowError(/255/); // 384 bytes
  });

  it('accepts a name of exactly 255 bytes (multibyte)', () => {
    const name = '€'.repeat(85); // 85 * 3 = 255 bytes
    expect(Buffer.byteLength(name, 'utf-8')).toBe(255);
    expect(() => validateDiagramFileName(name)).not.toThrow();
  });

  it('throws StorageError with code invalid-name', () => {
    try {
      validateDiagramFileName('../x');
      expect.unreachable();
    } catch (err) {
      expect(isStorageError(err)).toBe(true);
      expect((err as { code: string }).code).toBe('invalid-name');
    }
  });
});

describe('validateStorageDir', () => {
  it('fs: resolves to an absolute path, expanding tilde', () => {
    expect(validateStorageDir('relative/dir', 'fs')).toBe(path.resolve('relative/dir'));
    expect(validateStorageDir('/abs/dir', 'fs')).toBe('/abs/dir');
    expect(validateStorageDir('~/diagrams', 'fs')).toBe(path.join(os.homedir(), 'diagrams'));
  });

  it('memory: accepts any non-empty string without control characters', () => {
    expect(validateStorageDir('default', 'memory')).toBe('default');
    expect(validateStorageDir('/tmp/cypress-diagrams-x', 'memory')).toBe('/tmp/cypress-diagrams-x');
    expect(() => validateStorageDir('', 'memory')).toThrowError(/Invalid directory/);
    expect(() => validateStorageDir('a\x00b', 'memory')).toThrowError(/Invalid directory/);
    expect(() => validateStorageDir('a\nb', 'memory')).toThrowError(/Invalid directory/);
  });

  it('s3: strips surrounding slashes and allows the empty root prefix', () => {
    expect(validateStorageDir('', 's3')).toBe('');
    expect(validateStorageDir('/', 's3')).toBe('');
    expect(validateStorageDir('flows/', 's3')).toBe('flows');
    expect(validateStorageDir('/flows/diagrams/', 's3')).toBe('flows/diagrams');
  });

  it('s3: rejects prefix escapes', () => {
    expect(() => validateStorageDir('a/../b', 's3')).toThrowError(/Invalid directory/);
    expect(() => validateStorageDir('../etc', 's3')).toThrowError(/Invalid directory/);
    expect(() => validateStorageDir('a\\b', 's3')).toThrowError(/Invalid directory/);
  });
});

describe('resolveDirPath', () => {
  it('matches the historical behavior', () => {
    expect(resolveDirPath('x')).toBe(path.resolve('x'));
    expect(resolveDirPath('~/x')).toBe(path.join(os.homedir(), 'x'));
  });
});
