import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { listAudit } from '@/lib/services/audit';

function parseAuditQuery(url: URL) {
  return {
    limit: Math.min(Number(url.searchParams.get('limit')) || 50, 500),
    offset: Math.max(Number(url.searchParams.get('offset')) || 0, 0),
    agentType: url.searchParams.get('agent_type') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    since: url.searchParams.get('since') ?? undefined,
    until: url.searchParams.get('until') ?? undefined,
  };
}

export async function GET(request: Request) {
  try {
    const opts = parseAuditQuery(new URL(request.url));
    const rows = await listAudit(opts);
    return NextResponse.json({ entries: rows, ...opts });
  } catch (err) {
    return NextResponse.json(
      { error: 'db_unavailable', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
