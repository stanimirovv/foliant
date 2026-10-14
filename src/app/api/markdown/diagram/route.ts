import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { getDiagramsDir, resolveDiagramFilePath } from '@/lib/config';
import { extractMermaidBlocks } from '@/lib/markdown';

// GET /api/markdown/diagram?file=notes.md&index=0[&dir=...]
// Returns the full source of one embedded diagram (the fenced block's content,
// including the %% CONFIG comment as its first line) for editing.
export async function GET(request: Request) {
  const diagramsDir = getDiagramsDir(request);
  const url = new URL(request.url);
  const file = url.searchParams.get('file') || '';
  const indexParam = url.searchParams.get('index') || '';
  const index = Number(indexParam);
  if (!/^\d+$/.test(indexParam) || !Number.isInteger(index)) {
    return NextResponse.json({ error: 'Invalid diagram index' }, { status: 400 });
  }
  let filePath: string;
  try {
    filePath = resolveDiagramFilePath(diagramsDir, file);
  } catch {
    return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });
  }
  try {
    const content = await fs.readFile(filePath, 'utf-8');
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
  } catch {
    return NextResponse.json({ error: 'Failed to read file' }, { status: 404 });
  }
}

export const dynamic = 'force-dynamic';
