import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const data = await rossFetch('/api/v1/credentials/bulk-remind', {
      method: 'POST',
      body: JSON.stringify({
        remindedBy: body.remindedBy || process.env.REVIEWER_NAME || 'Rostering Officer',
        withinDays: body.withinDays ?? 30,
        credentialId: body.credentialId,
        assignmentIds: body.assignmentIds,
        limit: body.limit ?? 50,
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
