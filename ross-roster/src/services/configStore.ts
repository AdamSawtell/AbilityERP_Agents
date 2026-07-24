import { env } from '../config';
import { query } from '../db/pool';

export type AgentConfig = {
  auto_approve_threshold: number;
  scan_interval_minutes: number;
  pre_shift_confirm_hours: number;
  escalation_hours_before_shift: number;
  max_safe_matches_per_scan: number;
  employee_no_auto_approve: number[];
};

const DEFAULTS: AgentConfig = {
  auto_approve_threshold: env.defaults.autoApproveThreshold,
  scan_interval_minutes: env.defaults.scanIntervalMinutes,
  pre_shift_confirm_hours: env.defaults.preShiftConfirmHours,
  escalation_hours_before_shift: env.defaults.escalationHoursBeforeShift,
  max_safe_matches_per_scan: 3,
  employee_no_auto_approve: [],
};

function parseValue(key: keyof AgentConfig, raw: string): AgentConfig[keyof AgentConfig] {
  if (key === 'employee_no_auto_approve') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
    } catch {
      return [];
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULTS[key];
}

export async function getConfig(): Promise<AgentConfig> {
  try {
    const { rows } = await query<{ key: string; value: string }>(
      'SELECT key, value FROM adempiere.rostering_agent_config',
    );
    const config: AgentConfig = { ...DEFAULTS };
    for (const row of rows) {
      if (row.key in config) {
        const key = row.key as keyof AgentConfig;
        (config as Record<string, unknown>)[key] = parseValue(key, row.value);
      }
    }
    return config;
  } catch {
    return { ...DEFAULTS };
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export type ConfigPatch = Partial<{
  auto_approve_threshold: number;
  scan_interval_minutes: number;
  pre_shift_confirm_hours: number;
  escalation_hours_before_shift: number;
  max_safe_matches_per_scan: number;
  employee_no_auto_approve: number[];
}>;

export async function updateConfig(
  patch: ConfigPatch,
  updatedBy: string,
): Promise<AgentConfig> {
  const current = await getConfig();
  const next: AgentConfig = {
    ...current,
    auto_approve_threshold: clampInt(
      patch.auto_approve_threshold ?? current.auto_approve_threshold,
      0,
      100,
      current.auto_approve_threshold,
    ),
    scan_interval_minutes: clampInt(
      patch.scan_interval_minutes ?? current.scan_interval_minutes,
      1,
      1440,
      current.scan_interval_minutes,
    ),
    pre_shift_confirm_hours: clampInt(
      patch.pre_shift_confirm_hours ?? current.pre_shift_confirm_hours,
      1,
      168,
      current.pre_shift_confirm_hours,
    ),
    escalation_hours_before_shift: clampInt(
      patch.escalation_hours_before_shift ?? current.escalation_hours_before_shift,
      1,
      72,
      current.escalation_hours_before_shift,
    ),
    max_safe_matches_per_scan: clampInt(
      patch.max_safe_matches_per_scan ?? current.max_safe_matches_per_scan,
      1,
      10,
      current.max_safe_matches_per_scan,
    ),
    employee_no_auto_approve: Array.isArray(patch.employee_no_auto_approve)
      ? patch.employee_no_auto_approve.map(Number).filter(Number.isFinite)
      : current.employee_no_auto_approve,
  };

  const entries: Array<[keyof AgentConfig, string]> = [
    ['auto_approve_threshold', String(next.auto_approve_threshold)],
    ['scan_interval_minutes', String(next.scan_interval_minutes)],
    ['pre_shift_confirm_hours', String(next.pre_shift_confirm_hours)],
    ['escalation_hours_before_shift', String(next.escalation_hours_before_shift)],
    ['max_safe_matches_per_scan', String(next.max_safe_matches_per_scan)],
    ['employee_no_auto_approve', JSON.stringify(next.employee_no_auto_approve)],
  ];

  for (const [key, value] of entries) {
    await query(
      `INSERT INTO adempiere.rostering_agent_config (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
      [key, value, updatedBy],
    );
  }

  return next;
}
