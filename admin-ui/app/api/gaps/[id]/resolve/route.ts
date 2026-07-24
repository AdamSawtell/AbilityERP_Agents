import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const data = await rossFetch(`/api/v1/gaps/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        resolvedBy: body.resolvedBy || process.env.REVIEWER_NAME || 'Rostering Officer',
        resolutionNotes: body.resolutionNotes || body.notes,
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
