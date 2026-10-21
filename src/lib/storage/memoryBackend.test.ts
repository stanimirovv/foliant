import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createMemoryBackend, DEFAULT_MEMORY_NAMESPACE } from './memoryBackend';

describe('memoryBackend (memory-specific behavior)', () => {
  it('is volatile: a new backend instance starts empty (the volatility contract)', async () => {
    const first = createMemoryBackend();
    await first.writeFile('default', 'a.mmd', 'x');
    expect(await first.readFile('default', 'a.mmd')).toBe('x');
    // "restart": a brand-new instance has no state
    const second = createMemoryBackend();
    await expect(second.readFile('default', 'a.mmd'))
      .rejects.toMatchObject({ code: 'not-found' });
    expect(await second.dirExists('default')).toBe(false);
  });

  it('isolates namespaces from each other', async () => {
    const backend = createMemoryBackend();
    await backend.writeFile('ns-a', 'a.mmd', 'A');
    await backend.writeFile('ns-b', 'b.mmd', 'B');
    expect((await backend.listFiles('ns-a')).files).toEqual(['a.mmd']);
    expect((await backend.listFiles('ns-b')).files).toEqual(['b.mmd']);
    await expect(backend.readFile('ns-a', 'b.mmd')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('writeFile creates the namespace (parity with fs after listFiles)', async () => {
    const backend = createMemoryBackend();
    expect(await backend.dirExists('fresh')).toBe(false);
    await backend.writeFile('fresh', 'x.mmd', 'x');
    expect(await backend.dirExists('fresh')).toBe(true);
  });

  it('dirExists rejects invalid namespaces', async () => {
    const backend = createMemoryBackend();
    expect(await backend.dirExists('')).toBe(false);
    expect(await backend.dirExists('a\x00b')).toBe(false);
  });

  it('seeds the default namespace from MEMORY_STORAGE_SEED_DIR', async () => {
    const seedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-seed-'));
    try {
      await fs.writeFile(path.join(seedDir, 'demo.mmd'), 'sequenceDiagram\nA->>B: Seed');
      await fs.writeFile(path.join(seedDir, 'doc.md'), '# Seed doc');
      await fs.writeFile(path.join(seedDir, 'skip.txt'), 'not a diagram');
      const backend = createMemoryBackend({ seedDir });
      // seeding is awaited inside every operation
      const listing = await backend.listFiles(DEFAULT_MEMORY_NAMESPACE);
      expect(listing.files).toEqual(['demo.mmd']);
      expect(listing.markdownFiles).toEqual(['doc.md']);
      expect(await backend.readFile(DEFAULT_MEMORY_NAMESPACE, 'demo.mmd'))
        .toBe('sequenceDiagram\nA->>B: Seed');
      // seeded entries get real versions and support CAS
      const { version } = await backend.readFileVersion(DEFAULT_MEMORY_NAMESPACE, 'demo.mmd');
      await backend.writeFile(DEFAULT_MEMORY_NAMESPACE, 'demo.mmd', 'v2', { ifMatchVersion: version });
      expect(await backend.readFile(DEFAULT_MEMORY_NAMESPACE, 'demo.mmd')).toBe('v2');
    } finally {
      await fs.rm(seedDir, { recursive: true, force: true });
    }
  });

  it('a missing seed dir just means an empty store', async () => {
    const backend = createMemoryBackend({ seedDir: '/definitely/not/here' });
    const listing = await backend.listFiles(DEFAULT_MEMORY_NAMESPACE);
    expect(listing).toEqual({ files: [], markdownFiles: [] });
  });
});
