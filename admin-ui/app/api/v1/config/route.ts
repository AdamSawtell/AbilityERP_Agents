import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { writeAudit } from '@/lib/services/audit';
import { getConfig, updateConfig, type ConfigPatch } from '@/lib/services/configStore';

export async function GET() {
  try {
    const config = await getConfig();
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json(
      { error: 'db_unavailable', message: errorMessage(err) },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const updatedBy = String(body?.updatedBy ?? '').trim();
    if (!updatedBy) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'updatedBy required' },
        { status: 400 },
      );
    }

    const patch: ConfigPatch = {};
    const keys: (keyof ConfigPatch)[] = [
      'auto_approve_threshold',
      'scan_interval_minutes',
      'pre_shift_confirm_hours',
      'escalation_hours_before_shift',
      'max_safe_matches_per_scan',
      'employee_no_auto_approve',
      'auto_assign_enabled',
    ];
    for (const key of keys) {
      if (body?.[key] !== undefined) {
        (patch as Record<string, unknown>)[key] = body[key];
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'no config fields provided' },
        { status: 400 },
      );
    }

    const before = await getConfig();
    const config = await updateConfig(patch, updatedBy);
    await writeAudit({
      agentType: 'system',
      action: 'config_updated',
      approvedBy: updatedBy,
      notes: JSON.stringify({ before, after: config, patch }),
    });

    return NextResponse.json({ success: true, config });
  } catch (err) {
    return NextResponse.json(
      { error: 'config_update_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
