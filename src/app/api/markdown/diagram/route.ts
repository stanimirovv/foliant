import { NextResponse } from 'next/server';
import {
  getStorageBackend,
  resolveStorageDir,
  storageErrorToResponse,
  validateDiagramFileName,
} from '@/lib/storage';
import { extractMermaidBlocks } from '@/lib/markdown';

// GET /api/markdown/diagram?file=notes.md&index=0[&dir=...]
// Returns the full source of one embedded diagram (the fenced block's content,
// including the %% CONFIG comment as its first line) for editing.
export async function GET(request: Request) {
  let dir: string;
  let backend: ReturnType<typeof getStorageBackend>;
  try {
    backend = getStorageBackend();
    dir = resolveStorageDir(request);
  } catch (err) {
    return storageErrorToResponse(err);
  }
  const url = new URL(request.url);
  const file = url.searchParams.get('file') || '';
  const indexParam = url.searchParams.get('index') || '';
  const index = Number(indexParam);
  if (!/^\d+$/.test(indexParam) || !Number.isInteger(index)) {
    return NextResponse.json({ error: 'Invalid diagram index' }, { status: 400 });
  }
  try {
    validateDiagramFileName(file);
  } catch (err) {
    return storageErrorToResponse(err);
  }
  try {
    const content = await backend.readFile(dir, file);
    const block = extractMermaidBlocks(content)[index];
    if (!block) {
      return NextResponse.json({ error: 'Diagram index out of range' }, { status: 404 });
    }
    return NextResponse.json({
      file,
      index,
      content: block.content,
      diagram: {
        index: block.index,
        title: block.title,
        startLine: block.startLine,
        endLine: block.endLine,
      },
    });
  } catch (err) {
    return storageErrorToResponse(err);
  }
}

export const dynamic = 'force-dynamic';
