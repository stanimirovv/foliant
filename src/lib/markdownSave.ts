// The background job behind POST /api/markdown/save: persist an edited
// mermaid diagram back into its markdown file.
//
// Safety model (deterministic, compare-and-swap):
//  1. Re-read the markdown file at job time (not at request time), together
//     with its storage version.
//  2. The target block must still contain exactly the content the editor
//     loaded (`expectedContent`). Any external change -> JobError('conflict'),
//     nothing is written.
//  3. The replacement is spliced by AST offsets (see ./markdown) and verified
//     with assertOnlyMermaidBlockChanged before anything is written.
//  4. The file is written through the injected writeFile with the version
//     read in step 1 (true CAS on every backend): if anything wrote the file
//     between the job's read and its write, the backend throws
//     StorageError('conflict') and nothing is written. The write is atomic
//     and read-back verified by the storage backend, so a crash mid-write
//     cannot leave a truncated file.

import {
  extractMermaidBlocks,
  replaceMermaidBlock,
  assertOnlyMermaidBlockChanged,
} from './markdown';
import { JobError } from './jobQueue';
import { isStorageError } from './storage/types';

export interface MarkdownSaveJobArgs {
  filePath: string;
  index: number;
  content: string;          // the full edited diagram source (config line included)
  expectedContent: string;  // the block content the editor originally loaded
}

export interface MarkdownSaveDeps {
  readFileVersion: (filePath: string) => Promise<{ content: string; version: string }>;
  writeFile: (filePath: string, content: string, opts?: { ifMatchVersion?: string }) => Promise<void>;
}

export interface MarkdownSaveResult {
  status: 'done';
  bytesWritten: number;
}

export function verifyMarkdownFileAndDiagrams(
  diskContent: string,
  expectedFileContent: string,
  targetDiagramIndex?: number,
  expectedTargetDiagramContent?: string,
): void {
  if (diskContent !== expectedFileContent) {
    throw new JobError(
      'verify-failed',
      "Contents aren't saved: markdown file on disk does not match saved content",
    );
  }
  let verifiedBlocks;
  try {
    verifiedBlocks = extractMermaidBlocks(diskContent);
  } catch (err) {
    throw new JobError(
      'verify-failed',
      `Contents aren't saved: failed to extract diagrams from markdown file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (targetDiagramIndex !== undefined && expectedTargetDiagramContent !== undefined) {
    const block = verifiedBlocks[targetDiagramIndex];
    if (!block) {
      throw new JobError(
        'verify-failed',
        `Contents aren't saved: diagram at index ${targetDiagramIndex} missing after save`,
      );
    }
    const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
    if (normalize(block.content) !== normalize(expectedTargetDiagramContent)) {
      throw new JobError(
        'verify-failed',
        `Contents aren't saved: diagram at index ${targetDiagramIndex} content does not match saved diagram`,
      );
    }
  }
}

export async function runMarkdownSaveJob(
  args: MarkdownSaveJobArgs,
  deps: MarkdownSaveDeps,
): Promise<MarkdownSaveResult> {
  let disk: string;
  let version: string;
  try {
    const read = await deps.readFileVersion(args.filePath);
    disk = read.content;
    version = read.version;
  } catch (err) {
    // A coded storage failure (e.g. the file was deleted between enqueue and
    // run) keeps its code; anything else is today's read-failed.
    if (isStorageError(err)) throw new JobError(err.code, err.message);
    throw new JobError('read-failed', `Could not read ${args.filePath}`);
  }

  const blocks = extractMermaidBlocks(disk);
  const block = blocks[args.index];
  if (!block) {
    throw new JobError(
      'not-found',
      `No mermaid diagram at index ${args.index} (${blocks.length} found)`,
    );
  }

  if (block.content !== args.expectedContent) {
    throw new JobError(
      'conflict',
      'The markdown file changed on disk since the diagram was loaded; reload it before saving',
    );
  }

  const updated = replaceMermaidBlock(disk, args.index, args.content);
  assertOnlyMermaidBlockChanged(disk, updated, args.index, args.content);

  try {
    // True CAS: the backend rejects the write if the file's version changed
    // since the read above (an external write landing between job-read and
    // job-write is no longer lost silently).
    await deps.writeFile(args.filePath, updated, { ifMatchVersion: version });
  } catch (err) {
    if (isStorageError(err)) throw new JobError(err.code, err.message);
    throw err;
  }

  let readBack: string;
  try {
    readBack = (await deps.readFileVersion(args.filePath)).content;
  } catch {
    throw new JobError(
      'verify-failed',
      `Contents aren't saved: could not read ${args.filePath} back after saving`,
    );
  }

  verifyMarkdownFileAndDiagrams(readBack, updated, args.index, args.content);

  return { status: 'done', bytesWritten: updated.length };
}
