import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const data = await rossFetch(`/api/v1/confirmations/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify({
        response: body.response,
        respondedBy: body.respondedBy || process.env.REVIEWER_NAME || 'Rostering Officer',
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
