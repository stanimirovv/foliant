import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { getDiagramsDir, resolveDiagramFilePath } from '@/lib/config';
import { extractMermaidBlocks } from '@/lib/markdown';

// GET /api/markdown/diagrams?file=notes.md[&dir=...]
// Lists the mermaid diagrams embedded in a markdown file (menu metadata).
export async function GET(request: Request) {
  const diagramsDir = getDiagramsDir(request);
  const url = new URL(request.url);
  const file = url.searchParams.get('file') || '';
  let filePath: string;
  try {
    filePath = resolveDiagramFilePath(diagramsDir, file);
  } catch {
    return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });
  }
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const diagrams = extractMermaidBlocks(content).map(b => ({
      index: b.index,
      title: b.title,
      startLine: b.startLine,
      endLine: b.endLine,
    }));
    return NextResponse.json({ file, diagrams });
  } catch {
    return NextResponse.json({ error: 'Failed to read file' }, { status: 404 });
  }
}

export const dynamic = 'force-dynamic';
