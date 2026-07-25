/** SAW049 — Configurable roster matching rules (AbilityAPP AB-0046 pattern). */

export const ROSTER_RULE_TYPES = [
  'not_excluded',
  'not_on_leave',
  'no_time_clash',
  'credentials_held',
  'gender_preference',
  'min_break_between_shifts',
  'max_weekly_hours',
  'max_consecutive_days',
  'max_shift_hours',
] as const;

export type RosterRuleType = (typeof ROSTER_RULE_TYPES)[number];

export type RosterRuleEnforcement = 'warning' | 'blocking';

export type MinBreakBetweenShiftsParameters = {
  minBreakHours: number;
  sleepoverReducedBreakHours: number;
};

export type MaxWeeklyHoursParameters = {
  maxWeeklyHours: number;
  maxFortnightlyHours: number;
  maxFourWeeklyHours: number;
};

export type MaxConsecutiveDaysParameters = {
  maxConsecutiveDays: number;
  minDaysOffPerWeek: number;
};

export type MaxShiftHoursParameters = {
  standardMaxHours: number;
  extendedMaxHours: number;
  requiresWrittenAgreement: boolean;
  absoluteMaxHours: number;
};

export type EmptyParameters = Record<string, never>;

export type RosterRuleParameters =
  | EmptyParameters
  | MinBreakBetweenShiftsParameters
  | MaxWeeklyHoursParameters
  | MaxConsecutiveDaysParameters
  | MaxShiftHoursParameters;

export type RosterRuleRecord = {
  id: string;
  ruleType: RosterRuleType;
  name: string;
  description: string;
  enabled: boolean;
  enforcement: RosterRuleEnforcement;
  priority: number;
  parameters: RosterRuleParameters;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  created: string | null;
  deletedAt: string | null;
};

export type RuleEvalVerdict = 'pass' | 'warning' | 'fail';

export type RuleEvaluationResult = {
  ruleId: string;
  ruleName: string;
  ruleType: RosterRuleType;
  enforcement: RosterRuleEnforcement;
  verdict: RuleEvalVerdict;
  message: string;
  parametersSnapshot: RosterRuleParameters;
};

export const ROSTER_RULE_TYPE_LABELS: Record<RosterRuleType, string> = {
  not_excluded: 'Not excluded',
  not_on_leave: 'Not on leave',
  no_time_clash: 'No time clash',
  credentials_held: 'Credentials held',
  gender_preference: 'Gender preference',
  min_break_between_shifts: 'Min break between shifts',
  max_weekly_hours: 'Max weekly / fortnightly hours',
  max_consecutive_days: 'Max consecutive days',
  max_shift_hours: 'Max shift hours',
};

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeRosterRuleType(value: unknown): RosterRuleType {
  const v = String(value ?? '').trim() as RosterRuleType;
  return ROSTER_RULE_TYPES.includes(v) ? v : 'no_time_clash';
}

export function normalizeRosterRuleEnforcement(value: unknown): RosterRuleEnforcement {
  return String(value ?? '').trim().toLowerCase() === 'warning' ? 'warning' : 'blocking';
}

export function normalizeRosterRuleParameters(
  ruleType: RosterRuleType,
  raw: unknown,
): RosterRuleParameters {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (ruleType) {
    case 'min_break_between_shifts':
      return {
        minBreakHours: num(p.minBreakHours, 10),
        sleepoverReducedBreakHours: num(p.sleepoverReducedBreakHours, 8),
      };
    case 'max_weekly_hours':
      return {
        maxWeeklyHours: num(p.maxWeeklyHours, 38),
        maxFortnightlyHours: num(p.maxFortnightlyHours, 76),
        maxFourWeeklyHours: num(p.maxFourWeeklyHours, 152),
      };
    case 'max_consecutive_days':
      return {
        maxConsecutiveDays: num(p.maxConsecutiveDays, 6),
        minDaysOffPerWeek: num(p.minDaysOffPerWeek, 2),
      };
    case 'max_shift_hours':
      return {
        standardMaxHours: num(p.standardMaxHours, 8),
        extendedMaxHours: num(p.extendedMaxHours, 10),
        requiresWrittenAgreement: Boolean(p.requiresWrittenAgreement ?? true),
        absoluteMaxHours: num(p.absoluteMaxHours, 12),
      };
    default:
      return {};
  }
}

export function normalizeRosterRule(raw: Partial<RosterRuleRecord> & Record<string, unknown>): RosterRuleRecord {
  const ruleType = normalizeRosterRuleType(raw.ruleType ?? raw.rule_type);
  const parameters = normalizeRosterRuleParameters(ruleType, raw.parameters);
  return {
    id: String(raw.id ?? '').trim(),
    ruleType,
    name: String(raw.name ?? '').trim(),
    description: String(raw.description ?? '').trim(),
    enabled: Boolean(raw.enabled),
    enforcement: normalizeRosterRuleEnforcement(raw.enforcement),
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 100,
    parameters,
    effectiveFrom: raw.effectiveFrom
      ? String(raw.effectiveFrom).slice(0, 10)
      : raw.effective_from
        ? String(raw.effective_from).slice(0, 10)
        : null,
    effectiveTo: raw.effectiveTo
      ? String(raw.effectiveTo).slice(0, 10)
      : raw.effective_to
        ? String(raw.effective_to).slice(0, 10)
        : null,
    updatedBy: raw.updatedBy != null ? String(raw.updatedBy) : raw.updated_by != null ? String(raw.updated_by) : null,
    updatedAt: raw.updatedAt != null ? String(raw.updatedAt) : raw.updated_at != null ? String(raw.updated_at) : null,
    created: raw.created != null ? String(raw.created) : null,
    deletedAt: raw.deletedAt != null ? String(raw.deletedAt) : raw.deleted_at != null ? String(raw.deleted_at) : null,
  };
}

export function isRosterRuleEffectiveOnDate(rule: RosterRuleRecord, date: string): boolean {
  if (!rule.enabled || rule.deletedAt) return false;
  const day = date.slice(0, 10);
  if (rule.effectiveFrom && day < rule.effectiveFrom) return false;
  if (rule.effectiveTo && day > rule.effectiveTo) return false;
  return true;
}

export function ruleBlocksMatch(result: RuleEvaluationResult): boolean {
  return result.verdict === 'fail' && result.enforcement === 'blocking';
}

export function parameterFieldDefs(ruleType: RosterRuleType): Array<{
  key: string;
  label: string;
  kind: 'number' | 'boolean';
  step?: number;
  hint?: string;
}> {
  switch (ruleType) {
    case 'min_break_between_shifts':
      return [
        { key: 'minBreakHours', label: 'Min break hours', kind: 'number', step: 0.5, hint: 'Rest required between adjacent shifts.' },
        { key: 'sleepoverReducedBreakHours', label: 'Sleepover reduced break hours', kind: 'number', step: 0.5 },
      ];
    case 'max_weekly_hours':
      return [
        { key: 'maxWeeklyHours', label: 'Max weekly hours', kind: 'number', step: 0.5 },
        { key: 'maxFortnightlyHours', label: 'Max fortnightly hours', kind: 'number', step: 0.5 },
        { key: 'maxFourWeeklyHours', label: 'Max four-weekly hours', kind: 'number', step: 0.5 },
      ];
    case 'max_consecutive_days':
      return [
        { key: 'maxConsecutiveDays', label: 'Max consecutive days', kind: 'number', step: 1 },
        { key: 'minDaysOffPerWeek', label: 'Min days off per week', kind: 'number', step: 1 },
      ];
    case 'max_shift_hours':
      return [
        { key: 'standardMaxHours', label: 'Standard max hours', kind: 'number', step: 0.5 },
        { key: 'extendedMaxHours', label: 'Extended max hours', kind: 'number', step: 0.5 },
        { key: 'absoluteMaxHours', label: 'Absolute max hours', kind: 'number', step: 0.5 },
        { key: 'requiresWrittenAgreement', label: 'Requires written agreement for extended', kind: 'boolean' },
      ];
    default:
      return [];
  }
}
