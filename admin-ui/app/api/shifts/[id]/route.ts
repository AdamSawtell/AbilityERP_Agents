import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { getShiftDetail } from '@/lib/db/queries/profiles';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  try {
    const { id: raw } = await context.params;
    const shiftId = Number(raw);
    if (!Number.isFinite(shiftId)) {
      return NextResponse.json({ error: 'invalid_shift_id' }, { status: 400 });
    }
    const shift = await getShiftDetail(shiftId);
    if (!shift) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ shift });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
