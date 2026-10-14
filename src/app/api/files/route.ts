import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { getDiagramsDir } from '@/lib/config';

export async function GET(request: Request) {
  const diagramsDir = getDiagramsDir(request);
  try {
    await fs.mkdir(diagramsDir, { recursive: true });
    const files = await fs.readdir(diagramsDir);
    const mmdFiles = files.filter(f => f.endsWith('.mmd'));
    const markdownFiles = files
      .filter(f => f.endsWith('.md') || f.endsWith('.markdown'))
      .sort();
    return NextResponse.json({ files: mmdFiles, markdownFiles });
  } catch {
    return NextResponse.json({ error: 'Failed to read directory' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
