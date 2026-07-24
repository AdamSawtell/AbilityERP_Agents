import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const data = await rossFetch(`/api/v1/proposals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        approvedBy: body.approvedBy || process.env.REVIEWER_NAME || 'Rostering Officer',
        notes: body.notes ?? null,
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
