import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { applyManualResponse } from '@/lib/services/confirmations';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const { id: raw } = await context.params;
    const id = Number(raw);
    const body = await request.json().catch(() => ({}));
    const response = String(body?.response ?? '').toLowerCase();
    const by = String(body?.respondedBy ?? body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !by) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'respondedBy required' },
        { status: 400 },
      );
    }
    if (response !== 'confirmed' && response !== 'declined') {
      return NextResponse.json(
        { error: 'invalid_body', message: "response must be 'confirmed' or 'declined'" },
        { status: 400 },
      );
    }
    const marked = await applyManualResponse(id, response, by);
    if (!marked) return NextResponse.json({ error: 'not_found_or_not_open' }, { status: 404 });
    return NextResponse.json({
      success: true,
      confirmation: {
        id: Number(marked.id),
        status: marked.status,
        workerId: Number(marked.worker_id),
        shiftId: Number(marked.shift_id),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
