import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { writeAudit } from '@/lib/services/audit';
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
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const updatedBy = String(body?.updatedBy ?? 'admin-ui').trim() || 'admin-ui';
    const action = String(body?.action ?? '').trim().toLowerCase();

    if (action === 'seed-defaults') {
      const result = await seedDefaultRosterRules(updatedBy);
      await writeAudit({
        agentType: 'system',
        action: 'rules_seeded',
        approvedBy: updatedBy,
        notes: JSON.stringify({ inserted: result.inserted }),
      });
      return NextResponse.json({ success: true, ...result });
    }

    if (!body?.name || !body?.ruleType) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'name and ruleType required (or action=seed-defaults)' },
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
    await writeAudit({
      agentType: 'system',
      action: 'rule_created',
      approvedBy: updatedBy,
      notes: JSON.stringify({ id: rule.id, ruleType: rule.ruleType }),
    });
    return NextResponse.json({ success: true, rule }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
