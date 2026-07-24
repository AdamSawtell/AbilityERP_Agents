import { NextResponse } from 'next/server';
import { rossFetch } from '@/lib/ross';

export async function GET() {
  try {
    const data = await rossFetch('/api/v1/config');
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const data = await rossFetch('/api/v1/config', {
      method: 'PUT',
      body: JSON.stringify({
        ...body,
        updatedBy: body.updatedBy || process.env.REVIEWER_NAME || 'Rostering Officer',
      }),
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }
}