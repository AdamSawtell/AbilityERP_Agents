import { NextResponse } from 'next/server';

const baseUrl = process.env.ROSS_API_URL ?? 'http://127.0.0.1:3002';
const apiKey = process.env.ROSS_API_KEY ?? '';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const qs = new URLSearchParams();
    for (const key of ['limit', 'agent_type', 'action', 'since', 'until']) {
      const v = url.searchParams.get(key);
      if (v) qs.set(key, v);
    }
    if (!qs.has('limit')) qs.set('limit', '500');

    const res = await fetch(`${baseUrl}/api/v1/audit/export?${qs}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: body?.message || body?.error || `export ${res.status}` },
        { status: 502 },
      );
    }
    const csv = await res.text();
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
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
