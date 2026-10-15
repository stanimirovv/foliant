import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { getDiagramsDir, resolveDiagramFilePath } from '@/lib/config';
import { defaultJobQueue } from '@/lib/jobQueue';
import { runMarkdownSaveJob } from '@/lib/markdownSave';
import { diskWriteQueue, writeFileAtomic } from '@/lib/fileStore';

// POST /api/markdown/save[&dir=...]
// Body: { file, index, content, expectedContent }
//
// Enqueues a background save job and returns its id immediately (202), so the
// caller (the editor's auto-save) never waits for the file write. The job
// re-reads the markdown file, verifies the target block still matches
// `expectedContent` (compare-and-swap), splices the new diagram in by AST
// offsets, verifies that nothing else changed, and writes the file atomically.
// Poll GET /api/jobs/[id] for the outcome.
export async function POST(request: Request) {
  const diagramsDir = getDiagramsDir(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { file, index, content, expectedContent } = (body ?? {}) as {
    file?: unknown;
    index?: unknown;
    content?: unknown;
    expectedContent?: unknown;
  };

  if (
    typeof file !== 'string' ||
    typeof index !== 'number' || !Number.isInteger(index) || index < 0 ||
    typeof content !== 'string' ||
    typeof expectedContent !== 'string'
  ) {
    return NextResponse.json({ error: 'Invalid save request' }, { status: 400 });
  }

  let filePath: string;
  try {
    filePath = resolveDiagramFilePath(diagramsDir, file);
  } catch {
    return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });
  }

  const jobId = defaultJobQueue.enqueue(() =>
    diskWriteQueue.run(() =>
      runMarkdownSaveJob(
        { filePath, index, content, expectedContent },
        {
          readFile: p => fs.readFile(p, 'utf-8'),
          writeFileAtomic: (p, c) => writeFileAtomic(p, c),
        },
      ),
    ),
  );

  return NextResponse.json({ jobId }, { status: 202 });
}

export const dynamic = 'force-dynamic';
