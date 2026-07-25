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
    return NextResponse.json(
      { error: 'db_unavailable', message: errorMessage(err) },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? 'run').trim().toLowerCase();
    if (action !== 'run') {
      return NextResponse.json(
        { error: 'invalid_body', message: 'action=run required' },
        { status: 400 },
      );
    }
    const reviewedBy = String(body?.reviewedBy ?? 'api').trim() || 'api';
    const summary = await runResponseReviewCycle(reviewedBy);
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    return NextResponse.json(
      { error: 'response_review_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
