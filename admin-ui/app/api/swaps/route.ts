import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { createManualSwap, listSwaps } from '@/lib/services/swaps';
import { getLastSwapCycle } from '@/lib/worker/swap';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const swaps = await listSwaps({ status, limit });
    return NextResponse.json({ swaps, lastCycle: getLastSwapCycle() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const shiftAId = Number(body?.shiftAId);
    const shiftBId = Number(body?.shiftBId);
    if (!Number.isFinite(shiftAId) || !Number.isFinite(shiftBId)) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'shiftAId and shiftBId required' },
        { status: 400 },
      );
    }
    const id = await createManualSwap({
      shiftAId,
      shiftBId,
      source: 'manual',
      notify: body?.notify !== false,
    });
    const swaps = await listSwaps({ status: 'proposed', limit: 50 });
    return NextResponse.json(
      { success: true, id, swap: swaps.find((s) => s.id === id) },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
