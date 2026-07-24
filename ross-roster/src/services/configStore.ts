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
