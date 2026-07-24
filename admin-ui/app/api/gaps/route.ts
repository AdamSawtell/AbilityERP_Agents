import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const resolved = url.searchParams.get('resolved') ?? 'false';
    const limit = url.searchParams.get('limit') || '50';
    const data = await rossFetch(
      `/api/v1/gaps?resolved=${encodeURIComponent(resolved)}&limit=${encodeURIComponent(limit)}`,
    );
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
