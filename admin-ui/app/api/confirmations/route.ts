import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const limit = url.searchParams.get('limit') || '50';
    const qs = new URLSearchParams({ limit });
    if (status) qs.set('status', status);
    const data = await rossFetch(`/api/v1/confirmations?${qs}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
