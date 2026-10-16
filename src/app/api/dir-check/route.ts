import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { resolveDirPath } from '@/lib/config';

// Existence probe for a user-supplied directory. Unlike /api/files this never
// creates the directory, so the client can tell "gone" apart from "empty".
export async function GET(request: Request) {
  const url = new URL(request.url);
  const dirParam = url.searchParams.get('dir');
  if (!dirParam) {
    return NextResponse.json({ exists: false });
  }
  try {
    const stat = await fs.stat(resolveDirPath(dirParam));
    return NextResponse.json({ exists: stat.isDirectory() });
  } catch {
    return NextResponse.json({ exists: false });
  }
}

export const dynamic = 'force-dynamic';
