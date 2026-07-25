import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { listPendingProposals } from '@/lib/services/proposals';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await listPendingProposals(50, 0);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
