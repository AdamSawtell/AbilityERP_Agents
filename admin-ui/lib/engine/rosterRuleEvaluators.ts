/**
 * SAW049 — Matching-side evaluators for configurable roster rules.
 * Built-in hard filters stay in matcher.ts; these cover rest / hours / consecutive days.
 */
import { query } from '../db/pool';
import {
  normalizeRosterRuleParameters,
  type MaxConsecutiveDaysParameters,
  type MaxShiftHoursParameters,
  type MaxWeeklyHoursParameters,
  type MinBreakBetweenShiftsParameters,
  type RosterRuleRecord,
  type RuleEvaluationResult,
} from './rosterRules';
import type { ShiftContext, WorkerRow } from './types';

function pass(rule: RosterRuleRecord): RuleEvaluationResult {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.ruleType,
    enforcement: rule.enforcement,
    verdict: 'pass',
    message: '',
    parametersSnapshot: rule.parameters,
  };
}

function fail(rule: RosterRuleRecord, message: string): RuleEvaluationResult {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.ruleType,
    enforcement: rule.enforcement,
    verdict: 'fail',
    message,
    parametersSnapshot: rule.parameters,
  };
}

function warn(rule: RosterRuleRecord, message: string): RuleEvaluationResult {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.ruleType,
    enforcement: rule.enforcement,
    verdict: 'warning',
    message,
    parametersSnapshot: rule.parameters,
  };
}

function shiftHours(shift: ShiftContext): number {
  const ms = shift.endTs.getTime() - shift.startTs.getTime();
  return Math.max(0, Math.round((ms / 3_600_000) * 100) / 100);
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday (ISO) of the week containing date. */
function weekStartMonday(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function loadPeerShifts(
  worker: WorkerRow,
  excludeShiftId: number,
): Promise<Array<{ shift_id: number; start_ts: Date; end_ts: Date; shift_date: string }>> {
  const { rows } = await query<{
    shift_id: number;
    start_ts: Date;
    end_ts: Date;
    shift_date: string;
  }>(
    `SELECT
        s.aberp_rostered_shift_id AS shift_id,
        COALESCE(s.starttime, s.startdate) AS start_ts,
        COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) AS end_ts,
        COALESCE(s.startdate, s.starttime)::date::text AS shift_date
     FROM adempiere.aberp_rostered_shiftstaff ss
     JOIN adempiere.aberp_rostered_shift s
       ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
     WHERE ss.isactive = 'Y'
       AND (
         ss.c_bpartner_staff_id = $1
         OR ss.aberp_user_contact_id = $2
       )
       AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
       AND s.isactive = 'Y'
       AND COALESCE(s.iscancelled, 'N') = 'N'
       AND COALESCE(s.aberp_isshiftrosteredtemplate, 'N') = 'N'
       AND s.aberp_rostered_shift_id <> $3
     ORDER BY start_ts`,
    [worker.worker_id, worker.ad_user_id, excludeShiftId],
  );
  return rows.map((r) => ({
    ...r,
    shift_id: Number(r.shift_id),
    start_ts: new Date(r.start_ts),
    end_ts: new Date(r.end_ts),
    shift_date: String(r.shift_date).slice(0, 10),
  }));
}

export async function evaluateMinBreakBetweenShifts(
  rule: RosterRuleRecord,
  worker: WorkerRow,
  shift: ShiftContext,
): Promise<RuleEvaluationResult> {
  const params = normalizeRosterRuleParameters(
    'min_break_between_shifts',
    rule.parameters,
  ) as MinBreakBetweenShiftsParameters;
  const peers = await loadPeerShifts(worker, shift.shiftId);
  const requiredGap = params.minBreakHours;
  const currentStart = shift.startTs.getTime();
  const currentEnd = shift.endTs.getTime();

  for (const peer of peers) {
    const peerStart = peer.start_ts.getTime();
    const peerEnd = peer.end_ts.getTime();
    if (peerEnd <= currentStart) {
      const gap = (currentStart - peerEnd) / 3_600_000;
      if (gap < requiredGap) {
        return fail(
          rule,
          `Only ${gap.toFixed(1)}h rest since previous shift on ${peer.shift_date} — minimum ${requiredGap}h.`,
        );
      }
    }
    if (currentEnd <= peerStart) {
      const gap = (peerStart - currentEnd) / 3_600_000;
      if (gap < requiredGap) {
        return fail(
          rule,
          `Only ${gap.toFixed(1)}h rest before next shift on ${peer.shift_date} — minimum ${requiredGap}h.`,
        );
      }
    }
  }
  return pass(rule);
}

export async function evaluateMaxWeeklyHours(
  rule: RosterRuleRecord,
  worker: WorkerRow,
  shift: ShiftContext,
): Promise<RuleEvaluationResult> {
  const params = normalizeRosterRuleParameters(
    'max_weekly_hours',
    rule.parameters,
  ) as MaxWeeklyHoursParameters;
  const peers = await loadPeerShifts(worker, shift.shiftId);
  const addHours = shiftHours(shift);

  const weekStart = weekStartMonday(shift.shiftDate);
  const weekEnd = addDaysIso(weekStart, 6);
  const fortnightStart = weekStart;
  const fortnightEnd = addDaysIso(weekStart, 13);
  const fourWeekEnd = addDaysIso(weekStart, 27);

  const sumIn = (from: string, to: string) =>
    peers
      .filter((p) => p.shift_date >= from && p.shift_date <= to)
      .reduce((acc, p) => {
        const h = (p.end_ts.getTime() - p.start_ts.getTime()) / 3_600_000;
        return acc + Math.max(0, h);
      }, 0);

  const weekly = sumIn(weekStart, weekEnd) + addHours;
  if (weekly > params.maxWeeklyHours) {
    return fail(
      rule,
      `Week hours would be ${weekly.toFixed(1)}h (cap ${params.maxWeeklyHours}h).`,
    );
  }
  const fortnightly = sumIn(fortnightStart, fortnightEnd) + addHours;
  if (fortnightly > params.maxFortnightlyHours) {
    return fail(
      rule,
      `Fortnight hours would be ${fortnightly.toFixed(1)}h (cap ${params.maxFortnightlyHours}h).`,
    );
  }
  const fourWeekly = sumIn(weekStart, fourWeekEnd) + addHours;
  if (fourWeekly > params.maxFourWeeklyHours) {
    return fail(
      rule,
      `Four-week hours would be ${fourWeekly.toFixed(1)}h (cap ${params.maxFourWeeklyHours}h).`,
    );
  }
  return pass(rule);
}

export async function evaluateMaxConsecutiveDays(
  rule: RosterRuleRecord,
  worker: WorkerRow,
  shift: ShiftContext,
): Promise<RuleEvaluationResult> {
  const params = normalizeRosterRuleParameters(
    'max_consecutive_days',
    rule.parameters,
  ) as MaxConsecutiveDaysParameters;
  const peers = await loadPeerShifts(worker, shift.shiftId);
  const days = new Set<string>([shift.shiftDate.slice(0, 10)]);
  for (const p of peers) days.add(p.shift_date);

  // Walk backwards and forwards from shift date
  let streak = 1;
  for (let i = 1; i < 40; i += 1) {
    if (days.has(addDaysIso(shift.shiftDate, -i))) streak += 1;
    else break;
  }
  for (let i = 1; i < 40; i += 1) {
    if (days.has(addDaysIso(shift.shiftDate, i))) streak += 1;
    else break;
  }

  if (streak > params.maxConsecutiveDays) {
    const msg = `Would create ${streak} consecutive work days (max ${params.maxConsecutiveDays}).`;
    return rule.enforcement === 'warning' ? warn(rule, msg) : fail(rule, msg);
  }
  return pass(rule);
}

export function evaluateMaxShiftHours(
  rule: RosterRuleRecord,
  shift: ShiftContext,
): RuleEvaluationResult {
  const params = normalizeRosterRuleParameters(
    'max_shift_hours',
    rule.parameters,
  ) as MaxShiftHoursParameters;
  const hours = shiftHours(shift);
  if (hours <= params.standardMaxHours) return pass(rule);
  if (hours <= params.extendedMaxHours) {
    const msg = `Shift is ${hours}h — exceeds standard ${params.standardMaxHours}h${
      params.requiresWrittenAgreement ? ' (written agreement required)' : ''
    }.`;
    return rule.enforcement === 'warning' ? warn(rule, msg) : fail(rule, msg);
  }
  if (hours <= params.absoluteMaxHours) {
    const msg = `Shift is ${hours}h — exceeds extended maximum ${params.extendedMaxHours}h.`;
    return rule.enforcement === 'warning' ? warn(rule, msg) : fail(rule, msg);
  }
  return fail(rule, `Shift is ${hours}h — exceeds absolute maximum ${params.absoluteMaxHours}h.`);
}

export async function evaluateConfigurableSafetyRules(
  rules: RosterRuleRecord[],
  worker: WorkerRow,
  shift: ShiftContext,
): Promise<RuleEvaluationResult[]> {
  const results: RuleEvaluationResult[] = [];
  for (const rule of rules) {
    switch (rule.ruleType) {
      case 'min_break_between_shifts':
        results.push(await evaluateMinBreakBetweenShifts(rule, worker, shift));
        break;
      case 'max_weekly_hours':
        results.push(await evaluateMaxWeeklyHours(rule, worker, shift));
        break;
      case 'max_consecutive_days':
        results.push(await evaluateMaxConsecutiveDays(rule, worker, shift));
        break;
      case 'max_shift_hours':
        results.push(evaluateMaxShiftHours(rule, shift));
        break;
      default:
        break;
    }
  }
  return results;
}
