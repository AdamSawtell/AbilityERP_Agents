import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import {
  createRosterRule,
  listRosterRules,
  seedDefaultRosterRules,
} from '@/lib/services/rosterRulesStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rules = await listRosterRules();
    return NextResponse.json({ rules });
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
    const updatedBy = String(body?.updatedBy ?? 'api').trim() || 'api';
    const action = String(body?.action ?? '').trim().toLowerCase();

    if (action === 'seed-defaults') {
      const result = await seedDefaultRosterRules(updatedBy);
      return NextResponse.json({ success: true, ...result });
    }

    if (!body?.name || !body?.ruleType) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'name and ruleType required' },
        { status: 400 },
      );
    }

    const rule = await createRosterRule(
      {
        id: body.id,
        ruleType: body.ruleType,
        name: body.name,
        description: body.description,
        enabled: body.enabled,
        enforcement: body.enforcement,
        priority: body.priority,
        parameters: body.parameters,
      },
      updatedBy,
    );
    return NextResponse.json({ success: true, rule }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'rules_write_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
