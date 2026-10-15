// The background job behind POST /api/markdown/save: persist an edited
// mermaid diagram back into its markdown file.
//
// Safety model (deterministic, compare-and-swap):
//  1. Re-read the markdown file from disk at job time (not at request time).
//  2. The target block must still contain exactly the content the editor
//     loaded (`expectedContent`). Any external change -> JobError('conflict'),
//     nothing is written.
//  3. The replacement is spliced by AST offsets (see ./markdown) and verified
//     with assertOnlyMermaidBlockChanged before anything is written.
//  4. The file is written atomically (temp file + rename) via the injected
//     writeFileAtomic, so a crash mid-write cannot leave a truncated file.

import {
  extractMermaidBlocks,
  replaceMermaidBlock,
  assertOnlyMermaidBlockChanged,
} from './markdown';
import { JobError } from './jobQueue';

export interface MarkdownSaveJobArgs {
  filePath: string;
  index: number;
  content: string;          // the full edited diagram source (config line included)
  expectedContent: string;  // the block content the editor originally loaded
}

export interface MarkdownSaveDeps {
  readFile: (filePath: string) => Promise<string>;
  writeFileAtomic: (filePath: string, content: string) => Promise<void>;
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
  try {
    disk = await deps.readFile(args.filePath);
  } catch {
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

  await deps.writeFileAtomic(args.filePath, updated);

  let readBack: string;
  try {
    readBack = await deps.readFile(args.filePath);
  } catch {
    throw new JobError(
      'verify-failed',
      `Contents aren't saved: could not read ${args.filePath} back after saving`,
    );
  }

  verifyMarkdownFileAndDiagrams(readBack, updated, args.index, args.content);

  return { status: 'done', bytesWritten: updated.length };
}
