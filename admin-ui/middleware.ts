import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Protect /api/v1/* (Bearer or x-ross-cron).
 * Browser BFF routes (/api/health, /api/proposals, …) stay ungated so the UI works.
 */
export function middleware(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (cronSecret && request.headers.get('x-ross-cron') === cronSecret) {
    return NextResponse.next();
  }

  const key = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!key || key !== (process.env.ROSS_API_KEY ?? '')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/v1/:path*' };
