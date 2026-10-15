import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { resolveDiagramFilePath, getDiagramsDir } from '@/lib/config';
import { diskWriteQueue, writeFileVerified, writeMarkdownFileVerified } from '@/lib/fileStore';

export async function GET(request: Request, { params }: { params: { filename: string } }) {
  const diagramsDir = getDiagramsDir(request);
  try {
    const filePath = resolveDiagramFilePath(diagramsDir, params.filename);
    const content = await fs.readFile(filePath, 'utf-8');
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ error: 'Failed to read file' }, { status: 404 });
  }
}

export async function POST(request: Request, { params }: { params: { filename: string } }) {
  const diagramsDir = getDiagramsDir(request);
  let filePath: string;
  try {
    filePath = resolveDiagramFilePath(diagramsDir, params.filename);
  } catch {
    return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });
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
    await diskWriteQueue.run(async () => {
      if (/\.(md|markdown)$/i.test(params.filename)) {
        await writeMarkdownFileVerified(filePath, content);
      } else {
        await writeFileVerified(filePath, content);
      }
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error = message.includes("Contents aren't saved")
      ? message
      : `Contents aren't saved: ${message}`;
    return NextResponse.json({ error }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
