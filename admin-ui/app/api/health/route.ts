import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function GET() {
  try {
    const data = await rossFetch('/health');
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { status: 'down', error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}
