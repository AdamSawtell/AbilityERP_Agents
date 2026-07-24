import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

type Ctx = { params: Promise<{ key: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { key } = await ctx.params;
    const data = await rossFetch(`/api/v1/skills/${encodeURIComponent(key)}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { key } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const data = await rossFetch(`/api/v1/skills/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...body,
        updatedBy: body.updatedBy || process.env.REVIEWER_NAME || 'Rostering Officer',
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
