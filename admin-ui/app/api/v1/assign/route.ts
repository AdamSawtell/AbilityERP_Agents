import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { assignWorker } from '@/lib/db/queries/assign';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const shiftId = Number(body?.shiftId);
    const workerId = Number(body?.workerId);
    const approvedBy = String(body?.approvedBy ?? '').trim();

    if (!Number.isFinite(shiftId) || !Number.isFinite(workerId) || !approvedBy) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'shiftId, workerId, and approvedBy are required' },
        { status: 400 },
      );
    }

    if (body?.isOverride && !body?.overrideReason) {
      return NextResponse.json(
        { error: 'override_reason_required', message: 'overrideReason is required when isOverride=true' },
        { status: 400 },
      );
    }

    const result = await assignWorker({
      shiftId,
      workerId,
      approvedBy,
      notes: typeof body?.notes === 'string' ? body.notes : null,
      isOverride: Boolean(body?.isOverride),
      overrideReason: typeof body?.overrideReason === 'string' ? body.overrideReason : null,
      notifyWorker: body?.notifyWorker !== false,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'shift_not_found' ? 404 : 503;
    return NextResponse.json({ error: 'assign_failed', message }, { status });
  }
}
