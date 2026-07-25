import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { matchShift } from '@/lib/engine/matcher';

type Ctx = { params: Promise<{ shiftId: string }> };

export async function GET(_request: Request, context: Ctx) {
  try {
    const { shiftId: raw } = await context.params;
    const shiftId = Number(raw);
    if (!Number.isFinite(shiftId)) {
      return NextResponse.json({ error: 'invalid_shift_id' }, { status: 400 });
    }
    const result = await matchShift(shiftId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'match_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
