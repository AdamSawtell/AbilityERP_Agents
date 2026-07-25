import { NextResponse } from 'next/server';
import { resolveActor } from '@/lib/actor';
import { errorMessage } from '@/lib/db/pool';
import { bulkRemindCredentials } from '@/lib/services/credentials';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const remindedBy = resolveActor(body, 'remindedBy', 'approvedBy');
    const credentialId =
      body?.credentialId != null && body.credentialId !== ''
        ? Number(body.credentialId)
        : null;
    const assignmentIds = Array.isArray(body?.assignmentIds)
      ? body.assignmentIds.map(Number).filter(Number.isFinite)
      : undefined;
    const result = await bulkRemindCredentials({
      remindedBy,
      withinDays: Number(body?.withinDays) || 30,
      credentialId: Number.isFinite(credentialId as number) ? credentialId : null,
      assignmentIds,
      limit: Number(body?.limit) || 50,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
