import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * SAW053 — API gate
 * - /api/v1/* → Bearer (ROSS_API_KEY or ROSTER_BOT_API_KEY) or x-ross-cron
 * - BFF GET/HEAD → open for admin UI reads
 * - BFF mutations → same-origin browser OR API key / cron (blocks anonymous curl POST)
 */
function apiKeys(): string[] {
  return [process.env.ROSS_API_KEY ?? '', process.env.ROSTER_BOT_API_KEY ?? ''].filter(Boolean);
}

function hasApiAuth(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (cronSecret && request.headers.get('x-ross-cron') === cronSecret) {
    return true;
  }
  const key = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (key && apiKeys().includes(key)) return true;
  return false;
}

function isSameOriginBrowser(request: NextRequest): boolean {
  const site = (request.headers.get('sec-fetch-site') ?? '').toLowerCase();
  if (site === 'same-origin' || site === 'same-site') return true;

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const method = request.method.toUpperCase();
  const isV1 = path.startsWith('/api/v1/');
  const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

  if (hasApiAuth(request)) {
    return NextResponse.next();
  }

  // Public health for Amplify / uptime checks
  if (path === '/api/health' || path === '/api/health/') {
    return NextResponse.next();
  }

  // BFF reads stay open for the admin UI
  if (!isV1 && isRead) {
    return NextResponse.next();
  }

  // BFF mutations: same-origin browser only when no API key
  if (!isV1 && !isRead && isSameOriginBrowser(request)) {
    return NextResponse.next();
  }

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export const config = {
  matcher: '/api/:path*',
};
