import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { listAudit } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const opts = {
      limit: Math.min(Number(url.searchParams.get('limit')) || 50, 500),
      offset: Math.max(Number(url.searchParams.get('offset')) || 0, 0),
      agentType: url.searchParams.get('agent_type') ?? undefined,
      action: url.searchParams.get('action') ?? undefined,
      since: url.searchParams.get('since') ?? undefined,
      until: url.searchParams.get('until') ?? undefined,
    };
    const rows = await listAudit(opts);
    return NextResponse.json({ entries: rows, ...opts });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
