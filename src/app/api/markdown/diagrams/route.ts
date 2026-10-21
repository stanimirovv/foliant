import { NextResponse } from 'next/server';
import {
  getStorageBackend,
  resolveStorageDir,
  storageErrorToResponse,
  validateDiagramFileName,
} from '@/lib/storage';
import { extractMermaidBlocks } from '@/lib/markdown';

// GET /api/markdown/diagrams?file=notes.md[&dir=...]
// Lists the mermaid diagrams embedded in a markdown file (menu metadata).
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
  try {
    validateDiagramFileName(file);
  } catch (err) {
    return storageErrorToResponse(err);
  }
  try {
    const content = await backend.readFile(dir, file);
    const diagrams = extractMermaidBlocks(content).map(b => ({
      index: b.index,
      title: b.title,
      startLine: b.startLine,
      endLine: b.endLine,
    }));
    return NextResponse.json({ file, diagrams });
  } catch (err) {
    return storageErrorToResponse(err);
  }
}

export const dynamic = 'force-dynamic';
