import { NextResponse } from 'next/server';
import { getStorageBackend, resolveStorageDir, storageErrorToResponse } from '@/lib/storage';

export async function GET(request: Request) {
  try {
    const backend = getStorageBackend();
    const dir = resolveStorageDir(request);
    const { files, markdownFiles } = await backend.listFiles(dir);
    // `backend` is additive: the client uses it to surface the in-memory
    // volatility banner.
    return NextResponse.json({ files, markdownFiles, backend: backend.name });
  } catch (err) {
    return storageErrorToResponse(err);
  }
}

export const dynamic = 'force-dynamic';
