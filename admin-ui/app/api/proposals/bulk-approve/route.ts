import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const data = await rossFetch('/api/v1/proposals/bulk-approve', {
      method: 'POST',
      body: JSON.stringify({
        approvedBy: body.approvedBy || process.env.REVIEWER_NAME || 'Rostering Officer',
        minScore: body.minScore,
        notifyWorker: body.notifyWorker !== false,
      }),
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
