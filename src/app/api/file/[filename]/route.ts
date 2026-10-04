import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getDiagramsDir } from '@/lib/config';

export async function GET(request: Request, { params }: { params: { filename: string } }) {
  const diagramsDir = getDiagramsDir(request);
  try {
    const filePath = path.join(diagramsDir, params.filename);
    const content = await fs.readFile(filePath, 'utf-8');
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ error: 'Failed to read file' }, { status: 404 });
  }
}

export const dynamic = 'force-dynamic';
