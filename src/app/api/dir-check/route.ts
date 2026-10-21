import { NextResponse } from 'next/server';
import { getStorageBackend, resolveStorageDir } from '@/lib/storage';

// Existence probe for a user-supplied directory. Unlike /api/files this never
// creates the directory, so the client can tell "gone" apart from "empty".
// Semantics per backend (see storage/validate.ts and the README): fs stats the
// path; memory checks whether the namespace exists; s3 reports whether the
// bucket is reachable and the prefix holds at least one object (an empty S3
// prefix cannot "exist" — documented divergence).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const dirParam = url.searchParams.get('dir');
  if (!dirParam) {
    return NextResponse.json({ exists: false });
  }
  try {
    const backend = getStorageBackend();
    const dir = resolveStorageDir(request);
    const exists = await backend.dirExists(dir);
    return NextResponse.json({ exists });
  } catch {
    // Unreachable/misconfigured backend or invalid dir: indistinguishable
    // from "gone" for the client's purposes.
    return NextResponse.json({ exists: false });
  }
}

export const dynamic = 'force-dynamic';
