import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

type Ctx = { params: Promise<{ key: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { key } = await ctx.params;
    const data = await rossFetch(`/api/v1/skills/${encodeURIComponent(key)}/run`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
