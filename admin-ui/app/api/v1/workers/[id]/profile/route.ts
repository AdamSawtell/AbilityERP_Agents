import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { getWorkerProfile } from '@/lib/db/queries/profiles';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  try {
    const { id: raw } = await context.params;
    const workerId = Number(raw);
    if (!Number.isFinite(workerId)) {
      return NextResponse.json({ error: 'invalid_worker_id' }, { status: 400 });
    }
    const profile = await getWorkerProfile(workerId);
    if (!profile) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json(
      { error: 'profile_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
