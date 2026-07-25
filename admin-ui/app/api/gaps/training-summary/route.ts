import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { listTrainingGapSummaries } from '@/lib/services/gaps';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const summaries = await listTrainingGapSummaries();
    return NextResponse.json({ summaries });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
