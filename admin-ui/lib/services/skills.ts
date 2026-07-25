import { query } from '../db/pool';

export type SkillStatus = 'on' | 'paused' | 'off';

export type SkillRow = {
  skill_key: string;
  name: string;
  purpose: string;
  status: SkillStatus;
  trigger_label: string;
  depends_on: string[];
  sort_order: number;
  config_json: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string | null;
  last_run_at: string | null;
  last_run_action: string | null;
};

type DbSkill = {
  skill_key: string;
  name: string;
  purpose: string;
  status: SkillStatus;
  trigger_label: string;
  depends_on: unknown;
  sort_order: number;
  config_json: unknown;
  updated_by: string | null;
  updated_at: Date | string | null;
};

const LAST_RUN_ACTIONS: Record<string, string[]> = {
  shift_scanner: ['scan_run'],
  worker_matching: ['scan_run', 'match_auto_assigned', 'match_approved'],
  response_review: [
    'response_review_cycle',
    'response_accepted',
    'response_dismissed',
  ],
  pathways_message: ['message_sent', 'cred_remind', 'training_requested'],
  gap_detector: ['gap_logged'],
  pre_shift_confirm: ['confirm_cycle'],
  swap_handler: ['swap_proposed', 'swap_approved'],
  planner_briefing: ['daily_plan'],
  credential_watch: ['cred_remind'],
  leave_replacer: ['leave_replacement'],
};

const DEFAULT_SOFT_WEIGHTS: Record<string, number> = {
  continuity_of_care: 25,
  location_proximity: 20,
  availability_pattern: 20,
  contract_capacity: 15,
  transport_match: 10,
  response_history: 10,
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function mapSkill(row: DbSkill, last?: { timestamp: Date | string; action: string } | null): SkillRow {
  return {
    skill_key: row.skill_key,
    name: row.name,
    purpose: row.purpose,
    status: row.status,
    trigger_label: row.trigger_label,
    depends_on: asStringArray(row.depends_on),
    sort_order: Number(row.sort_order),
    config_json: asObject(row.config_json),
    updated_by: row.updated_by,
    updated_at: iso(row.updated_at),
    last_run_at: last ? iso(last.timestamp) : null,
    last_run_action: last?.action ?? null,
  };
}

async function lastRunsBySkill(): Promise<
  Map<string, { timestamp: Date | string; action: string }>
> {
  const map = new Map<string, { timestamp: Date | string; action: string }>();
  const allActions = [...new Set(Object.values(LAST_RUN_ACTIONS).flat())];
  if (allActions.length === 0) return map;

  const { rows } = await query<{ action: string; timestamp: Date | string }>(
    `SELECT DISTINCT ON (action) action, timestamp
     FROM adempiere.rostering_agent_audit_log
     WHERE action = ANY($1::text[])
     ORDER BY action, timestamp DESC`,
    [allActions],
  );

  const byAction = new Map(rows.map((r) => [r.action, r]));
  for (const [key, actions] of Object.entries(LAST_RUN_ACTIONS)) {
    let best: { timestamp: Date | string; action: string } | null = null;
    for (const action of actions) {
      const hit = byAction.get(action);
      if (!hit) continue;
      if (!best || new Date(hit.timestamp).getTime() > new Date(best.timestamp).getTime()) {
        best = { timestamp: hit.timestamp, action };
      }
    }
    if (best) map.set(key, best);
  }
  return map;
}

export async function listSkills(): Promise<SkillRow[]> {
  const { rows } = await query<DbSkill>(
    `SELECT skill_key, name, purpose, status, trigger_label, depends_on,
            sort_order, config_json, updated_by, updated_at
     FROM adempiere.rostering_agent_skills
     ORDER BY sort_order ASC, name ASC`,
  );
  const lasts = await lastRunsBySkill();
  return rows.map((r) => mapSkill(r, lasts.get(r.skill_key) ?? null));
}

export async function getSkill(skillKey: string): Promise<SkillRow | null> {
  const { rows } = await query<DbSkill>(
    `SELECT skill_key, name, purpose, status, trigger_label, depends_on,
            sort_order, config_json, updated_by, updated_at
     FROM adempiere.rostering_agent_skills
     WHERE skill_key = $1`,
    [skillKey],
  );
  if (!rows[0]) return null;
  const lasts = await lastRunsBySkill();
  return mapSkill(rows[0], lasts.get(skillKey) ?? null);
}

export async function getSkillStatus(skillKey: string): Promise<SkillStatus | null> {
  const { rows } = await query<{ status: SkillStatus }>(
    `SELECT status FROM adempiere.rostering_agent_skills WHERE skill_key = $1`,
    [skillKey],
  );
  return rows[0]?.status ?? null;
}

/** True when skill may run automatically (cron). */
export async function isSkillAutoEnabled(skillKey: string): Promise<boolean> {
  try {
    const status = await getSkillStatus(skillKey);
    if (status == null) return true; // fail-open if table missing / unseeded
    return status === 'on';
  } catch {
    return true;
  }
}

/**
 * True when event/chain effects may fire.
 * Off blocks; On and Paused still allow (Paused only stops that skill's cron).
 */
export async function isSkillChainEnabled(skillKey: string): Promise<boolean> {
  try {
    const status = await getSkillStatus(skillKey);
    if (status == null) return true;
    return status !== 'off';
  } catch {
    return true;
  }
}

/** True when manual Run Now is allowed (on or paused). */
export async function isSkillRunnable(skillKey: string): Promise<boolean> {
  try {
    const status = await getSkillStatus(skillKey);
    if (status == null) return true;
    return status === 'on' || status === 'paused';
  } catch {
    return true;
  }
}

const STATUS_CYCLE: SkillStatus[] = ['on', 'paused', 'off'];

export function nextStatus(current: SkillStatus): SkillStatus {
  const i = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length] ?? 'on';
}

export async function setSkillStatus(
  skillKey: string,
  status: SkillStatus,
  updatedBy: string,
): Promise<SkillRow | null> {
  const { rows } = await query<DbSkill>(
    `UPDATE adempiere.rostering_agent_skills
     SET status = $2, updated_by = $3, updated_at = NOW()
     WHERE skill_key = $1
     RETURNING skill_key, name, purpose, status, trigger_label, depends_on,
               sort_order, config_json, updated_by, updated_at`,
    [skillKey, status, updatedBy],
  );
  if (!rows[0]) return null;
  const lasts = await lastRunsBySkill();
  return mapSkill(rows[0], lasts.get(skillKey) ?? null);
}

export async function cycleSkillStatus(
  skillKey: string,
  updatedBy: string,
): Promise<SkillRow | null> {
  const current = await getSkill(skillKey);
  if (!current) return null;
  return setSkillStatus(skillKey, nextStatus(current.status), updatedBy);
}

export async function updateSkillConfig(
  skillKey: string,
  configJson: Record<string, unknown>,
  updatedBy: string,
): Promise<SkillRow | null> {
  const { rows } = await query<DbSkill>(
    `UPDATE adempiere.rostering_agent_skills
     SET config_json = $2::jsonb, updated_by = $3, updated_at = NOW()
     WHERE skill_key = $1
     RETURNING skill_key, name, purpose, status, trigger_label, depends_on,
               sort_order, config_json, updated_by, updated_at`,
    [skillKey, JSON.stringify(configJson), updatedBy],
  );
  if (!rows[0]) return null;
  const lasts = await lastRunsBySkill();
  return mapSkill(rows[0], lasts.get(skillKey) ?? null);
}

export async function getSoftWeights(): Promise<Record<string, number>> {
  try {
    const skill = await getSkill('worker_matching');
    const raw = skill?.config_json?.soft_weights;
    const out = { ...DEFAULT_SOFT_WEIGHTS };
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n <= 100) out[k] = Math.round(n);
      }
    }
    return out;
  } catch {
    return { ...DEFAULT_SOFT_WEIGHTS };
  }
}

export { DEFAULT_SOFT_WEIGHTS };
