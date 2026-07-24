import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const data = await rossFetch(`/api/v1/proposals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({
        rejectedBy: body.rejectedBy || process.env.REVIEWER_NAME || 'Rostering Officer',
        reason: body.reason ?? 'Rejected from Ross admin',
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
