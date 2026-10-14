import { NextResponse } from 'next/server';
import { defaultJobQueue } from '@/lib/jobQueue';

// GET /api/jobs/[id] — poll the status of a background job.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const record = defaultJobQueue.get(params.id);
  if (!record) {
    return NextResponse.json({ error: 'Unknown job' }, { status: 404 });
  }
  return NextResponse.json({
    id: record.id,
    status: record.status,
    code: record.code,
    error: record.error,
  });
}

export const dynamic = 'force-dynamic';
