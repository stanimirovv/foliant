import { NextResponse } from 'next/server';
import {
  getStorageBackend,
  resolveStorageDir,
  storageWriteQueue,
  storageErrorToResponse,
  validateDiagramFileName,
} from '@/lib/storage';
import { resolveDiagramFilePath } from '@/lib/config';
import { defaultJobQueue } from '@/lib/jobQueue';
import { runMarkdownSaveJob } from '@/lib/markdownSave';
import { isReadOnlyFile } from '@/lib/readOnlyFiles';

// POST /api/markdown/save[&dir=...]
// Body: { file, index, content, expectedContent }
//
// Enqueues a background save job and returns its id immediately (202), so the
// caller (the editor's auto-save) never waits for the file write. The job
// re-reads the markdown file through the active storage backend, verifies the
// target block still matches `expectedContent` (compare-and-swap), splices the
// new diagram in by AST offsets, verifies that nothing else changed, and
// writes the file through the backend with true version-based CAS (an
// external write landing between the job's read and write fails the job with
// code 'conflict' instead of being lost). Poll GET /api/jobs/[id] for the
// outcome.
export async function POST(request: Request) {
  let backend: ReturnType<typeof getStorageBackend>;
  let dir: string;
  try {
    backend = getStorageBackend();
    dir = resolveStorageDir(request);
  } catch (err) {
    return storageErrorToResponse(err);
  }

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

  try {
    validateDiagramFileName(file);
  } catch (err) {
    return storageErrorToResponse(err);
  }

  // Read-only files (e.g. the shipped tutorial) must never be overwritten.
  if (isReadOnlyFile(file)) {
    return NextResponse.json(
      { error: 'This file is read-only and cannot be modified.' },
      { status: 403 },
    );
  }

  // filePath is only used in job error messages; the job's storage operations
  // go through the active backend, keyed by (dir, file).
  const filePath = resolveDiagramFilePath(dir, file);

  const jobId = defaultJobQueue.enqueue(() =>
    storageWriteQueue.run(() =>
      runMarkdownSaveJob(
        { filePath, index, content, expectedContent },
        {
          readFileVersion: () => backend.readFileVersion(dir, file),
          writeFile: (_p, c, opts) => backend.writeFile(dir, file, c, opts),
        },
      ),
    ),
  );

  return NextResponse.json({ jobId }, { status: 202 });
}

export const dynamic = 'force-dynamic';
