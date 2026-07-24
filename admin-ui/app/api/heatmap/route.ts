import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const horizon = url.searchParams.get('horizon') || 'period';
    const data = await rossFetch(`/api/v1/coverage?horizon=${encodeURIComponent(horizon)}`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
