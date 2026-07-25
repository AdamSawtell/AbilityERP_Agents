import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { buildNextPeriodForecast } from '@/lib/services/forecast';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const forecast = await buildNextPeriodForecast();
    return NextResponse.json({ forecast });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
