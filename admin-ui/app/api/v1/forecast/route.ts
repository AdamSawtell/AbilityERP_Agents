import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { buildNextPeriodForecast } from '@/lib/services/forecast';

export async function GET() {
  try {
    const forecast = await buildNextPeriodForecast();
    return NextResponse.json({ forecast });
  } catch (err) {
    return NextResponse.json(
      { error: 'forecast_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
