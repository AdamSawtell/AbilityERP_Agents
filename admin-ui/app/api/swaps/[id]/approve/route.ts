import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { approveSwap } from '@/lib/services/swaps';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const { id: raw } = await context.params;
    const id = Number(raw);
    const body = await request.json().catch(() => ({}));
    const by = String(body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !by) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'approvedBy required' },
        { status: 400 },
      );
    }
    const row = await approveSwap(id, by, body?.notes);
    if (!row) return NextResponse.json({ error: 'not_found_or_not_open' }, { status: 404 });
    return NextResponse.json({
      success: true,
      swap: {
        id: Number(row.id),
        status: row.status,
        requesterId: Number(row.requester_id),
        partnerId: Number(row.partner_id),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
