import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { getCredentialWatch } from '@/lib/services/credentials';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const withinDays = Math.min(Number(url.searchParams.get('withinDays')) || 30, 90);
    const data = await getCredentialWatch(withinDays);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: 'credentials_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
