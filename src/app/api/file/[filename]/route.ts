import { NextResponse } from 'next/server';
import {
  getStorageBackend,
  resolveStorageDir,
  storageWriteQueue,
  storageErrorToResponse,
  validateDiagramFileName,
} from '@/lib/storage';
import { verifyMarkdownFileAndDiagrams } from '@/lib/markdownSave';
import { isReadOnlyFile } from '@/lib/readOnlyFiles';

export async function GET(request: Request, { params }: { params: { filename: string } }) {
  try {
    const backend = getStorageBackend();
    const dir = resolveStorageDir(request);
    validateDiagramFileName(params.filename);
    const content = await backend.readFile(dir, params.filename);
    return NextResponse.json({ content });
  } catch (err) {
    return storageErrorToResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: { filename: string } }) {
  let backend: ReturnType<typeof getStorageBackend>;
  let dir: string;
  try {
    backend = getStorageBackend();
    dir = resolveStorageDir(request);
    validateDiagramFileName(params.filename);
  } catch (err) {
    return storageErrorToResponse(err);
  }

  // Read-only files (e.g. the shipped tutorial) must never be overwritten.
  if (isReadOnlyFile(params.filename)) {
    return NextResponse.json(
      { error: 'This file is read-only and cannot be modified.' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { content } = (body ?? {}) as { content?: unknown };
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'Invalid file content' }, { status: 400 });
  }

  try {
    await storageWriteQueue.run(async () => {
      // Atomic + read-back verified write on every backend.
      await backend.writeFile(dir, params.filename, content);
      if (/\.(md|markdown)$/i.test(params.filename)) {
        const onDisk = await backend.readFile(dir, params.filename);
        verifyMarkdownFileAndDiagrams(onDisk, content);
      }
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return storageErrorToResponse(err);
  }
}

export const dynamic = 'force-dynamic';
