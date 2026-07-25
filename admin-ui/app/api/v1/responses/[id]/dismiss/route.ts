import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { dismissResponseReview } from '@/lib/services/responseReviews';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id: raw } = await ctx.params;
    const id = Number(raw);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const reviewedBy = String(body?.reviewedBy ?? 'api').trim() || 'api';
    const notes = body?.notes != null ? String(body.notes) : undefined;
    await dismissResponseReview(id, reviewedBy, notes);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: errorMessage(err) },
      { status: 502 },
    );
  }
}
