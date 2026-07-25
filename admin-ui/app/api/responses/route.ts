import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import {
  listOpenResponseReviews,
  runResponseReviewCycle,
} from '@/lib/services/responseReviews';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const items = await listOpenResponseReviews(100);
    return NextResponse.json({
      items,
      openCount: items.length,
      reqCount: items.filter((i) => i.response === 'REQ').length,
      decCount: items.filter((i) => i.response === 'DEC').length,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? '').trim().toLowerCase();
    if (action !== 'run') {
      return NextResponse.json(
        { error: 'invalid_body', message: 'action=run required' },
        { status: 400 },
      );
    }
    const reviewedBy = String(body?.reviewedBy ?? 'admin-ui').trim() || 'admin-ui';
    const summary = await runResponseReviewCycle(reviewedBy);
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
