import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { getCredentialWatch } from '@/lib/services/credentials';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const withinDays = Math.min(Number(url.searchParams.get('withinDays')) || 30, 90);
    const data = await getCredentialWatch(withinDays);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
