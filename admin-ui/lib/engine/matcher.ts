import { query } from '../db/pool';
import { loadShiftContext } from '../db/queries/shifts';
import { getConfig } from '../services/configStore';
import { listActiveRosterRules } from '../services/rosterRulesStore';
import { DEFAULT_SOFT_WEIGHTS, getSoftWeights } from '../services/skills';
import { evaluateConfigurableSafetyRules } from './rosterRuleEvaluators';
import {
  ruleBlocksMatch,
  type RosterRuleRecord,
  type RosterRuleType,
} from './rosterRules';
import type {
  HardRuleResult,
  MatchBlocker,
  MatchCandidate,
  MatchResult,
  SoftRuleResult,
  WorkerRow,
} from './types';

const SAFETY_TYPES: RosterRuleType[] = [
  'min_break_between_shifts',
  'max_weekly_hours',
  'max_consecutive_days',
  'max_shift_hours',
];

function rulesByType(rules: RosterRuleRecord[]): Map<RosterRuleType, RosterRuleRecord> {
  const map = new Map<RosterRuleType, RosterRuleRecord>();
  for (const rule of rules) {
    if (!map.has(rule.ruleType)) map.set(rule.ruleType, rule);
  }
  return map;
}

function isBuiltinEnabled(
  map: Map<RosterRuleType, RosterRuleRecord>,
  type: RosterRuleType,
): boolean {
  const rule = map.get(type);
  // Missing catalogue row → keep legacy behaviour (enabled).
  return rule ? rule.enabled : true;
}

function scaleEarned(raw: number, defaultMax: number, weight: number): number {
  if (defaultMax <= 0 || weight <= 0) return 0;
  return Math.min(weight, Math.round((raw / defaultMax) * weight));
}

type FailBucket = Record<string, number>;

async function loadCandidateWorkers(shiftId: number): Promise<WorkerRow[]> {
  const { rows } = await query<WorkerRow>(
    `SELECT
        bp.c_bpartner_id AS worker_id,
        bp.name AS worker_name,
        au.ad_user_id,
        bp.aberp_gender_id AS gender_id,
        COALESCE(hr.hr_exclude, 'N') AS hr_exclude,
        ec.aberp_contract_hrs AS contract_hrs,
        ec.aberp_max_contract_hrs AS max_contract_hrs,
        ec.aberp_masterlocation_id AS contract_location_id
     FROM adempiere.c_bpartner bp
     JOIN adempiere.ad_user au
       ON au.c_bpartner_id = bp.c_bpartner_id
      AND au.isactive = 'Y'
     LEFT JOIN adempiere.hr_employee hr
       ON hr.c_bpartner_id = bp.c_bpartner_id
     LEFT JOIN LATERAL (
       SELECT aberp_contract_hrs, aberp_max_contract_hrs, aberp_masterlocation_id
       FROM adempiere.aberp_employee_contract
       WHERE aberp_user_contact_id = au.ad_user_id
         AND isactive = 'Y'
       ORDER BY updated DESC NULLS LAST
       LIMIT 1
     ) ec ON TRUE
     WHERE bp.isactive = 'Y'
       AND EXISTS (
         SELECT 1
         FROM adempiere.aberp_employee_contract ec2
         WHERE ec2.aberp_user_contact_id = au.ad_user_id
           AND ec2.isactive = 'Y'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM adempiere.aberp_rostered_shiftstaff ss
         WHERE ss.aberp_rostered_shift_id = $1
           AND ss.isactive = 'Y'
           AND ss.c_bpartner_staff_id = bp.c_bpartner_id
           AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
       )
     ORDER BY bp.name`,
    [shiftId],
  );
  return rows.map((r) => ({
    ...r,
    worker_id: Number(r.worker_id),
    ad_user_id: Number(r.ad_user_id),
    gender_id: r.gender_id != null ? Number(r.gender_id) : null,
    contract_hrs: r.contract_hrs != null ? Number(r.contract_hrs) : null,
    max_contract_hrs: r.max_contract_hrs != null ? Number(r.max_contract_hrs) : null,
    contract_location_id:
      r.contract_location_id != null ? Number(r.contract_location_id) : null,
  }));
}

async function evaluateHardRules(
  worker: WorkerRow,
  shift: NonNullable<Awaited<ReturnType<typeof loadShiftContext>>>,
  activeRules: RosterRuleRecord[],
): Promise<{ pass: boolean; results: HardRuleResult[]; failReason?: string }> {
  const results: HardRuleResult[] = [];
  const byType = rulesByType(activeRules);

  // 1. Not excluded
  if (isBuiltinEnabled(byType, 'not_excluded')) {
    const excluded = (worker.hr_exclude ?? 'N') === 'Y';
    results.push({
      rule: 'not_excluded',
      pass: !excluded,
      detail: excluded ? 'hr_exclude=Y' : undefined,
    });
    if (excluded) return { pass: false, results, failReason: 'excluded' };
  }

  // 2. Not on approved leave overlapping shift window (SAW003: ApproverStatus AP)
  if (isBuiltinEnabled(byType, 'not_on_leave')) {
    const leave = await query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM adempiere.aberp_unavailability_leave ul
       WHERE ul.isactive = 'Y'
         AND ul.aberp_approverstatus = 'AP'
         AND (
           ul.aberp_user_contact_id = $1
           OR ul.c_bpartner_staff_id = $2
         )
         AND ul.startdate <= $4::timestamp
         AND ul.enddate >= $3::timestamp
       LIMIT 1`,
      [worker.ad_user_id, worker.worker_id, shift.startTs, shift.endTs],
    );
    const onLeave = leave.rows.length > 0;
    results.push({
      rule: 'not_on_leave',
      pass: !onLeave,
    });
    if (onLeave) return { pass: false, results, failReason: 'leave_block' };
  }

  // 3. No shift clash (merged timestamps; exclude templates + this shift)
  if (isBuiltinEnabled(byType, 'no_time_clash')) {
    const clash = await query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM adempiere.aberp_rostered_shiftstaff ss
       JOIN adempiere.aberp_rostered_shift s2
         ON s2.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
       WHERE ss.isactive = 'Y'
         AND (
           ss.c_bpartner_staff_id = $1
           OR ss.aberp_user_contact_id = $2
         )
         AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
         AND s2.isactive = 'Y'
         AND COALESCE(s2.iscancelled, 'N') = 'N'
         AND COALESCE(s2.aberp_isshiftrosteredtemplate, 'N') = 'N'
         AND s2.aberp_rostered_shift_id <> $3
         AND COALESCE(s2.starttime, s2.startdate) < $5::timestamp
         AND COALESCE(s2.endtime, s2.enddate, s2.starttime, s2.startdate) > $4::timestamp
       LIMIT 1`,
      [worker.worker_id, worker.ad_user_id, shift.shiftId, shift.startTs, shift.endTs],
    );
    const hasClash = clash.rows.length > 0;
    results.push({ rule: 'no_time_clash', pass: !hasClash });
    if (hasClash) return { pass: false, results, failReason: 'time_clash' };
  }

  // 4. All required credentials held and covering shift window
  if (isBuiltinEnabled(byType, 'credentials_held')) {
    if (shift.credentialIds.length > 0) {
      const held = await query<{ cnt: string }>(
        `SELECT COUNT(DISTINCT ca.aberp_credentials_id)::text AS cnt
         FROM adempiere.aberp_credentialassignment ca
         WHERE ca.isactive = 'Y'
           AND ca.aberp_credentials_id = ANY($1::numeric[])
           AND (
             ca.aberp_user_contact_id = $2
             OR ca.c_bpartner_staff_id = $3
           )
           AND (ca.startdate IS NULL OR ca.startdate <= $4::timestamp)
           AND (ca.aberp_expirydate IS NULL OR ca.aberp_expirydate >= $5::timestamp)`,
        [
          shift.credentialIds,
          worker.ad_user_id,
          worker.worker_id,
          shift.startTs,
          shift.endTs,
        ],
      );
      const count = Number(held.rows[0]?.cnt ?? 0);
      const pass = count >= shift.credentialIds.length;
      results.push({
        rule: 'credentials_held',
        pass,
        detail: pass
          ? undefined
          : `held ${count}/${shift.credentialIds.length}: ${shift.credentialNames.join(', ')}`,
      });
      if (!pass) return { pass: false, results, failReason: 'missing_credential' };
    } else {
      results.push({ rule: 'credentials_held', pass: true, detail: 'no credentials required' });
    }
  }

  // 5. Gender preference (hard; override only at assign time)
  if (isBuiltinEnabled(byType, 'gender_preference')) {
    if (shift.genderIds.length > 0) {
      const workerGender = worker.gender_id ?? 0;
      const pass = shift.genderIds.every((g) => workerGender === g);
      results.push({
        rule: 'gender_preference',
        pass,
        detail: pass
          ? undefined
          : `worker gender ${workerGender} vs required ${shift.genderIds.join(',')}`,
      });
      if (!pass) return { pass: false, results, failReason: 'gender_pref' };
    } else {
      results.push({ rule: 'gender_preference', pass: true, detail: 'no gender preference' });
    }
  }

  // 6–9. Configurable safety rules (AbilityAPP-style)
  const safetyRules = activeRules.filter(
    (r) => r.enabled && SAFETY_TYPES.includes(r.ruleType),
  );
  if (safetyRules.length > 0) {
    const safety = await evaluateConfigurableSafetyRules(safetyRules, worker, shift);
    for (const evalResult of safety) {
      const ok = evalResult.verdict === 'pass';
      results.push({
        rule: evalResult.ruleType,
        pass: ok || evalResult.enforcement === 'warning',
        detail: ok ? undefined : evalResult.message,
      });
      if (ruleBlocksMatch(evalResult)) {
        return {
          pass: false,
          results,
          failReason: evalResult.ruleType,
        };
      }
    }
  }

  return { pass: true, results };
}

async function scoreSoftRules(
  worker: WorkerRow,
  shift: NonNullable<Awaited<ReturnType<typeof loadShiftContext>>>,
  weights: Record<string, number>,
): Promise<{ score: number; softRules: SoftRuleResult[]; breakdown: MatchCandidate['scoreBreakdown'] }> {
  const softRules: SoftRuleResult[] = [];
  const breakdown: MatchCandidate['scoreBreakdown'] = [];
  const w = (key: keyof typeof DEFAULT_SOFT_WEIGHTS) =>
    weights[key] ?? DEFAULT_SOFT_WEIGHTS[key];

  // Continuity of care
  const continuityMax = DEFAULT_SOFT_WEIGHTS.continuity_of_care;
  let continuityRaw = 5;
  if (shift.receiverIds.length > 0) {
    const { rows } = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM adempiere.aberp_rostered_shiftstaff ss
       JOIN adempiere.aberp_rostered_shift s
         ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
       JOIN adempiere.aberp_rostered_shiftreceiver sr
         ON sr.aberp_rostered_shift_id = s.aberp_rostered_shift_id
       WHERE ss.c_bpartner_staff_id = $1
         AND ss.isactive = 'Y'
         AND sr.isactive = 'Y'
         AND sr.c_bpartner_id = ANY($2::numeric[])`,
      [worker.worker_id, shift.receiverIds],
    );
    const cnt = Number(rows[0]?.cnt ?? 0);
    if (cnt >= 5) continuityRaw = 25;
    else if (cnt >= 3) continuityRaw = 20;
    else if (cnt >= 1) continuityRaw = 15;
    else continuityRaw = 5;
  }
  const continuityWeight = w('continuity_of_care');
  const continuityEarned = scaleEarned(continuityRaw, continuityMax, continuityWeight);
  softRules.push({
    rule: 'continuity_of_care',
    pass: continuityRaw >= 15,
    weight: continuityWeight,
    earned: continuityEarned,
  });
  breakdown.push({
    category: 'continuity_of_care',
    weight: continuityWeight,
    earned: continuityEarned,
  });

  // Location proximity
  const locationMax = DEFAULT_SOFT_WEIGHTS.location_proximity;
  let locationRaw = 5;
  if (shift.locationId != null && worker.contract_location_id != null) {
    if (worker.contract_location_id === shift.locationId) locationRaw = 20;
    else locationRaw = 5;
  } else if (shift.locationId == null) {
    locationRaw = 10;
  }
  const locationWeight = w('location_proximity');
  const locationEarned = scaleEarned(locationRaw, locationMax, locationWeight);
  softRules.push({
    rule: 'location_proximity',
    pass: locationRaw >= 10,
    weight: locationWeight,
    earned: locationEarned,
  });
  breakdown.push({
    category: 'location_proximity',
    weight: locationWeight,
    earned: locationEarned,
  });

  // Availability pattern
  const dayOfWeek = shift.startTs.getUTCDay();
  const ongoing = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM adempiere.aberp_ongoingunavailability ou
     JOIN adempiere.aberp_unavailabledays ud
       ON ud.aberp_ongoingunavailability_id = ou.aberp_ongoingunavailability_id
     WHERE ou.isactive = 'Y'
       AND COALESCE(ou.aberp_approverstatus, 'AP') = 'AP'
       AND ou.aberp_user_contact_id = $1
       AND (ou.startdate IS NULL OR ou.startdate <= $2::date)
       AND (ou.enddate IS NULL OR ou.enddate >= $2::date)
       AND ud.isactive = 'Y'
       AND ud.aberp_rosterstartday IS NOT NULL
       AND ud.aberp_rosterendday IS NOT NULL
       AND EXTRACT(ISODOW FROM $2::date) BETWEEN
         LEAST(ud.aberp_rosterstartday, ud.aberp_rosterendday)
         AND GREATEST(ud.aberp_rosterstartday, ud.aberp_rosterendday)
     LIMIT 1`,
    [worker.ad_user_id, shift.shiftDate],
  ).catch(() => ({ rows: [] as { ok: number }[] }));

  const blockedByPattern = ongoing.rows.length > 0;
  const availabilityMax = DEFAULT_SOFT_WEIGHTS.availability_pattern;
  const availabilityRaw = blockedByPattern ? 0 : 20;
  const availabilityWeight = w('availability_pattern');
  const availabilityEarned = scaleEarned(availabilityRaw, availabilityMax, availabilityWeight);
  softRules.push({
    rule: 'availability_pattern',
    pass: !blockedByPattern,
    weight: availabilityWeight,
    earned: availabilityEarned,
  });
  breakdown.push({
    category: 'availability_pattern',
    weight: availabilityWeight,
    earned: availabilityEarned,
  });
  void dayOfWeek;

  // Contract capacity
  const contractMax = DEFAULT_SOFT_WEIGHTS.contract_capacity;
  let contractRaw = 15;
  const max = worker.max_contract_hrs;
  const used = worker.contract_hrs;
  if (max != null && max > 0 && used != null) {
    const ratio = used / max;
    if (ratio >= 1) contractRaw = 0;
    else if (ratio >= 0.9) contractRaw = 5;
    else if (ratio >= 0.8) contractRaw = 10;
    else contractRaw = 15;
  }
  const contractWeight = w('contract_capacity');
  const contractEarned = scaleEarned(contractRaw, contractMax, contractWeight);
  softRules.push({
    rule: 'contract_capacity',
    pass: contractRaw > 0,
    weight: contractWeight,
    earned: contractEarned,
  });
  breakdown.push({
    category: 'contract_capacity',
    weight: contractWeight,
    earned: contractEarned,
  });

  // Transport match
  const transportMax = DEFAULT_SOFT_WEIGHTS.transport_match;
  let transportRaw = 10;
  if (shift.transportRequired) {
    const licence = await query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM adempiere.aberp_credentialassignment ca
       JOIN adempiere.aberp_credentials c
         ON c.aberp_credentials_id = ca.aberp_credentials_id
       WHERE ca.isactive = 'Y'
         AND (
           ca.aberp_user_contact_id = $1
           OR ca.c_bpartner_staff_id = $2
         )
         AND (
           c.name ILIKE '%driver%'
           OR c.name ILIKE '%licence%'
           OR c.name ILIKE '%license%'
         )
         AND (ca.aberp_expirydate IS NULL OR ca.aberp_expirydate >= $3::timestamp)
       LIMIT 1`,
      [worker.ad_user_id, worker.worker_id, shift.startTs],
    );
    transportRaw = licence.rows.length > 0 ? 10 : 0;
  }
  const transportWeight = w('transport_match');
  const transportEarned = scaleEarned(transportRaw, transportMax, transportWeight);
  softRules.push({
    rule: 'transport_match',
    pass: transportRaw > 0 || !shift.transportRequired,
    weight: transportWeight,
    earned: transportEarned,
  });
  breakdown.push({
    category: 'transport_match',
    weight: transportWeight,
    earned: transportEarned,
  });

  // Response history
  const responseMax = DEFAULT_SOFT_WEIGHTS.response_history;
  let responseRaw = 5;
  const hist = await query<{ resp: string | null }>(
    `SELECT aberp_rosteredresponse AS resp
     FROM adempiere.aberp_rosteredresponselog
     WHERE aberp_user_contact_id = $1
       AND aberp_rostered_shift_id = $2
       AND isactive = 'Y'
     ORDER BY created DESC
     LIMIT 1`,
    [worker.ad_user_id, shift.shiftId],
  ).catch(() => ({ rows: [] as { resp: string | null }[] }));

  const resp = hist.rows[0]?.resp;
  if (resp === 'REQ' || resp === 'ACC') responseRaw = 10;
  else if (resp === 'DEC') responseRaw = 0;
  else responseRaw = 5;

  const responseWeight = w('response_history');
  const responseEarned = scaleEarned(responseRaw, responseMax, responseWeight);
  softRules.push({
    rule: 'response_history',
    pass: responseRaw > 0,
    weight: responseWeight,
    earned: responseEarned,
  });
  breakdown.push({
    category: 'response_history',
    weight: responseWeight,
    earned: responseEarned,
  });

  const score = Math.min(
    100,
    softRules.reduce((sum, r) => sum + r.earned, 0),
  );
  return { score, softRules, breakdown };
}

function buildBlocker(fails: FailBucket, totalConsidered: number): MatchBlocker {
  const entries = Object.entries(fails).sort((a, b) => b[1] - a[1]);
  const [reason, count] = entries[0] ?? ['unknown', totalConsidered];
  const suggested =
    reason === 'missing_credential'
      ? 'train_workers'
      : reason === 'gender_pref'
        ? 'relax_filter'
        : reason === 'no_workers_in_zone' || reason === 'leave_block'
          ? 'escalate'
          : 'escalate';

  return {
    reason,
    detail: `Dominant blocker: ${reason} (${count}/${totalConsidered} workers)`,
    affectedWorkers: count,
    suggestedAction: suggested,
  };
}

function summarize(candidate: Omit<MatchCandidate, 'reason'>): string {
  const top = [...candidate.scoreBreakdown]
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 2)
    .map((b) => `${b.category}=${b.earned}`)
    .join(', ');
  return `${candidate.workerName} scored ${candidate.score}/100 (${top})`;
}

export async function matchShift(shiftId: number): Promise<MatchResult> {
  const shift = await loadShiftContext(shiftId);
  if (!shift) {
    return {
      shiftId,
      candidates: [],
      hasHardRules: false,
      totalEligible: 0,
      totalConsidered: 0,
      blocker: {
        reason: 'unknown',
        detail: 'Shift not found or inactive',
        affectedWorkers: 0,
        suggestedAction: 'escalate',
      },
      scanTimestamp: new Date().toISOString(),
    };
  }

  const config = await getConfig();
  const softWeights = await getSoftWeights();
  let activeRules: RosterRuleRecord[] = [];
  try {
    activeRules = await listActiveRosterRules(shift.shiftDate);
  } catch {
    // Table missing pre-migration — fall back to built-in-only behaviour.
    activeRules = [];
  }
  const workers = await loadCandidateWorkers(shiftId);
  const fails: FailBucket = {};
  const candidates: MatchCandidate[] = [];

  for (const worker of workers) {
    const hard = await evaluateHardRules(worker, shift, activeRules);
    if (!hard.pass) {
      const reason = hard.failReason ?? 'unknown';
      fails[reason] = (fails[reason] ?? 0) + 1;
      continue;
    }

    const soft = await scoreSoftRules(worker, shift, softWeights);
    const partial = {
      workerId: worker.worker_id,
      workerName: worker.worker_name,
      adUserId: worker.ad_user_id,
      score: soft.score,
      scoreBreakdown: soft.breakdown,
      hardRules: hard.results,
      softRules: soft.softRules,
      isAutoApproved: soft.score >= config.auto_approve_threshold,
    };
    candidates.push({
      ...partial,
      reason: summarize(partial),
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.workerName.localeCompare(b.workerName));
  const top = candidates.slice(0, config.max_safe_matches_per_scan);

  return {
    shiftId,
    candidates: top,
    hasHardRules: true,
    totalEligible: candidates.length,
    totalConsidered: workers.length,
    blocker:
      top.length === 0
        ? workers.length === 0
          ? {
              reason: 'no_workers_in_zone',
              detail: 'No active contracted workers found',
              affectedWorkers: 0,
              suggestedAction: 'escalate',
            }
          : buildBlocker(fails, workers.length)
        : undefined,
    scanTimestamp: new Date().toISOString(),
  };
}
