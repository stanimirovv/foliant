// Server-side disk writes. Every write to the diagrams directory goes through
// here so that:
//  - writes never run in parallel: `diskWriteQueue` is one process-wide FIFO
//    lock shared by every route that writes (whole-file saves and the
//    embedded-diagram save job), so a read-modify-write can't interleave with
//    another write;
//  - a reader never sees a half-written file: content goes to a temp file in
//    the same directory, is fsynced, then renamed over the target;
//  - every write is verified: the file is read back and must be
//    byte-identical to what was meant to be written.

import fs from 'fs/promises';
import path from 'path';
import { createSerialQueue, SerialQueue } from './serialQueue';
import { JobError } from './jobQueue';
import { verifyMarkdownFileAndDiagrams } from './markdownSave';

// On globalThis for the same reason as defaultJobQueue: Next.js dev compiles
// each route into its own bundle, and per-bundle module state would give
// each route its own lock.
const GLOBAL_KEY = '__mermaidSequenceViewerDiskWriteQueue__';
const globalStore = globalThis as typeof globalThis & { [GLOBAL_KEY]?: SerialQueue };
export const diskWriteQueue: SerialQueue =
  globalStore[GLOBAL_KEY] ?? (globalStore[GLOBAL_KEY] = createSerialQueue());

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
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
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

// Throws JobError('verify-failed') unless the file on disk is exactly
// `expected`. Returns the content read back.
export async function verifyWrittenContent(
  readFile: (filePath: string) => Promise<string>,
  filePath: string,
  expected: string,
): Promise<string> {
  let onDisk: string;
  try {
    onDisk = await readFile(filePath);
  } catch {
    throw new JobError('verify-failed', `Could not read ${path.basename(filePath)} back after saving`);
  }
  if (onDisk !== expected) {
    throw new JobError(
      'verify-failed',
      `${path.basename(filePath)} on disk does not match what was saved (${expected.length} chars written, ${onDisk.length} read back)`,
    );
  }
  return onDisk;
}

// Write + read-back verification, for whole-file saves.
export async function writeFileVerified(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8');
  await verifyWrittenContent(p => fs.readFile(p, 'utf-8'), filePath, content);
}

// Write + read-back verification of markdown file and all diagrams inside it.
export async function writeMarkdownFileVerified(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8');
  const onDisk = await verifyWrittenContent(p => fs.readFile(p, 'utf-8'), filePath, content);
  verifyMarkdownFileAndDiagrams(onDisk, content);
}
