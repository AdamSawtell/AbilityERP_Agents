import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const qs = new URLSearchParams();
    for (const key of ['limit', 'offset', 'agent_type', 'action', 'since', 'until']) {
      const v = url.searchParams.get(key);
      if (v) qs.set(key, v);
    }
    if (!qs.has('limit')) qs.set('limit', '50');
    const data = await rossFetch(`/api/v1/audit?${qs}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
