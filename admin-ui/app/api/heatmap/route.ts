import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { getCoverageHeatmap } from '@/lib/services/coverage';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const horizon = url.searchParams.get('horizon') ?? 'period';
    const data = await getCoverageHeatmap(horizon);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
