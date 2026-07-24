import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const horizon = searchParams.get('horizon') || 'today';
    const data = await rossFetch(`/api/v1/shifts/vacant?horizon=${encodeURIComponent(horizon)}&limit=20`);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
