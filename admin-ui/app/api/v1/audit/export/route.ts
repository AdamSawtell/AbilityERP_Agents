import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { auditRowsToCsv, listAudit } from '@/lib/services/audit';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const opts = {
      limit: Math.min(Number(url.searchParams.get('limit')) || 500, 2000),
      offset: 0,
      agentType: url.searchParams.get('agent_type') ?? undefined,
      action: url.searchParams.get('action') ?? undefined,
      since: url.searchParams.get('since') ?? undefined,
      until: url.searchParams.get('until') ?? undefined,
    };
    const rows = await listAudit(opts);
    const csv = auditRowsToCsv(rows as Array<Record<string, unknown>>);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ross-audit-${stamp}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'export_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
