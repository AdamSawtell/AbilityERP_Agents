import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { loadShiftContext } from '@/lib/db/queries/shifts';
import {
  buildAssignmentMessage,
  resolveWorkerUserId,
  sendPathwaysMessage,
} from '@/lib/pathways';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const workerId = Number(body?.workerId);
    const shiftId = Number(body?.shiftId);
    const adClientId = Number(body?.adClientId ?? 1000002);
    let message = typeof body?.message === 'string' ? body.message.trim() : '';

    if (!Number.isFinite(workerId) || !Number.isFinite(shiftId)) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'workerId and shiftId required' },
        { status: 400 },
      );
    }

    const workerAdUserId = await resolveWorkerUserId(workerId);
    if (workerAdUserId == null) {
      return NextResponse.json({ error: 'worker_user_not_found' }, { status: 404 });
    }

    if (!message) {
      const ctx = await loadShiftContext(shiftId);
      message = await buildAssignmentMessage({
        workerName: String(body?.workerName ?? `Worker ${workerId}`),
        shiftName: ctx?.name ?? `Shift ${shiftId}`,
        startTs: ctx?.startTs ?? new Date(),
        endTs: ctx?.endTs ?? new Date(),
        locationName: ctx?.locationName ?? null,
      });
    }

    const result = await sendPathwaysMessage({
      workerAdUserId,
      workerBPartnerId: workerId,
      shiftId,
      message,
      adClientId,
    });

    return NextResponse.json({ success: result.sent, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: 'pathways_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
