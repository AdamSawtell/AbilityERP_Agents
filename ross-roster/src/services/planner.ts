import { query } from '../db/pool';
import { writeAudit } from './audit';

export type TrainingGapAgg = {
  credentialId: number | null;
  credentialName: string;
  blockedShifts: number;
  openGaps: number;
  trainingRequested: number;
};

export type CredentialExpiryBucket = {
  within7Days: number;
  within14Days: number;
  within30Days: number;
  workers: { workerId: number; workerName: string; credentialName: string; expiryDate: string }[];
};

export type HiringSignal = {
  dayOfWeek: string;
  band: string;
  vacantSlots: number;
  sampleDays: number;
  detail: string;
};

export type UtilisationRow = {
  workerId: number;
  workerName: string;
  assignedShifts: number;
  hoursApprox: number;
};

export type PlannerBriefing = {
  generatedAt: string;
  period: { start: string; end: string; label: string };
  priorPeriod: { start: string; end: string; label: string };
  fillRate: {
    thisPeriod: number;
    lastPeriod: number;
    delta: number;
    vacantSlots: number;
    requiredSlots: number;
    assignedSlots: number;
    urgentVacant: number;
  };
  trainingGaps: TrainingGapAgg[];
  credentialExpiry: CredentialExpiryBucket;
  hiringSignals: HiringSignal[];
  utilisation: {
    busiest: UtilisationRow[];
    lightest: UtilisationRow[];
  };
  forecastNext: {
    period: { start: string; end: string };
    fillRate: number;
    vacantSlots: number;
    requiredSlots: number;
  };
  recommendations: string[];
  summaryText: string;
};

function periodWindow(daysOffset: number, lengthDays: number): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + daysOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + lengthDays);
  return { start, end };
}

async function fillForWindow(start: Date, end: Date): Promise<{
  required: number;
  assigned: number;
  vacant: number;
  fillRate: number;
  urgentVacant: number;
}> {
  const { rows } = await query<{
    required: string;
    assigned: string;
    urgent_vacant: string;
  }>(
    `WITH shift_rows AS (
       SELECT
         s.aberp_rostered_shift_id,
         GREATEST(COALESCE(s.aberp_no_of_staff, 1), 1)::int AS required,
         COALESCE((
           SELECT COUNT(*)::int
           FROM adempiere.aberp_rostered_shiftstaff ss
           WHERE ss.aberp_rostered_shift_id = s.aberp_rostered_shift_id
             AND ss.isactive = 'Y'
             AND ss.c_bpartner_staff_id IS NOT NULL
             AND COALESCE(ss.aberp_requestshift, 'N') <> 'Y'
             AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
         ), 0) AS assigned,
         COALESCE(s.starttime, s.startdate) AS start_ts
       FROM adempiere.aberp_rostered_shift s
       WHERE s.isactive = 'Y'
         AND COALESCE(s.iscancelled, 'N') = 'N'
         AND COALESCE(s.aberp_isshiftrosteredtemplate, 'N') = 'N'
         AND COALESCE(s.starttime, s.startdate) >= $1::timestamp
         AND COALESCE(s.starttime, s.startdate) <= $2::timestamp
     )
     SELECT
       COALESCE(SUM(required), 0)::text AS required,
       COALESCE(SUM(LEAST(assigned, required)), 0)::text AS assigned,
       COALESCE(SUM(CASE
         WHEN required > assigned
          AND start_ts < NOW() + interval '24 hours'
         THEN required - assigned ELSE 0 END), 0)::text AS urgent_vacant
     FROM shift_rows`,
    [start, end],
  );

  const required = Number(rows[0]?.required ?? 0);
  const assigned = Number(rows[0]?.assigned ?? 0);
  const vacant = Math.max(required - assigned, 0);
  const urgentVacant = Number(rows[0]?.urgent_vacant ?? 0);
  const fillRate = required > 0 ? Math.round((assigned / required) * 100) : 100;
  return { required, assigned, vacant, fillRate, urgentVacant };
}

async function aggregateTrainingGaps(): Promise<TrainingGapAgg[]> {
  const { rows } = await query<{
    credential_id: number | null;
    credential_name: string | null;
    blocked: string;
    open_gaps: string;
    training_requested: string;
  }>(
    `SELECT
       credential_id,
       COALESCE(NULLIF(credential_name, ''), reason, 'Unspecified') AS credential_name,
       COALESCE(SUM(COALESCE(blocked_count, 1)), 0)::text AS blocked,
       COUNT(*) FILTER (WHERE resolved = FALSE)::text AS open_gaps,
       COUNT(*) FILTER (WHERE training_requested = TRUE)::text AS training_requested
     FROM adempiere.rostering_agent_gaps
     WHERE resolved = FALSE
     GROUP BY credential_id, COALESCE(NULLIF(credential_name, ''), reason, 'Unspecified')
     ORDER BY SUM(COALESCE(blocked_count, 1)) DESC
     LIMIT 12`,
  );

  return rows.map((r) => ({
    credentialId: r.credential_id != null ? Number(r.credential_id) : null,
    credentialName: r.credential_name || 'Unspecified',
    blockedShifts: Number(r.blocked),
    openGaps: Number(r.open_gaps),
    trainingRequested: Number(r.training_requested),
  }));
}

async function scanCredentialExpiry(): Promise<CredentialExpiryBucket> {
  const { rows } = await query<{
    worker_id: number;
    worker_name: string;
    credential_name: string;
    expiry: Date;
    days_left: string;
  }>(
    `SELECT
       bp.c_bpartner_id AS worker_id,
       bp.name AS worker_name,
       c.name AS credential_name,
       ca.aberp_expirydate AS expiry,
       (EXTRACT(EPOCH FROM (ca.aberp_expirydate - NOW())) / 86400)::text AS days_left
     FROM adempiere.aberp_credentialassignment ca
     JOIN adempiere.aberp_credentials c
       ON c.aberp_credentials_id = ca.aberp_credentials_id
     JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = ca.c_bpartner_staff_id
     WHERE ca.isactive = 'Y'
       AND ca.aberp_expirydate IS NOT NULL
       AND ca.aberp_expirydate >= NOW()
       AND ca.aberp_expirydate <= NOW() + interval '30 days'
     ORDER BY ca.aberp_expirydate ASC
     LIMIT 100`,
  );

  const workers = rows.map((r) => ({
    workerId: Number(r.worker_id),
    workerName: r.worker_name,
    credentialName: r.credential_name,
    expiryDate: new Date(r.expiry).toISOString().slice(0, 10),
  }));

  let within7Days = 0;
  let within14Days = 0;
  let within30Days = 0;
  for (const r of rows) {
    const d = Number(r.days_left);
    if (d <= 7) within7Days += 1;
    if (d <= 14) within14Days += 1;
    if (d <= 30) within30Days += 1;
  }

  return { within7Days, within14Days, within30Days, workers: workers.slice(0, 20) };
}

async function detectHiringSignals(): Promise<HiringSignal[]> {
  const { rows } = await query<{
    dow: string;
    band: string;
    vacant: string;
    sample_days: string;
  }>(
    `WITH shift_rows AS (
       SELECT
         to_char(timezone('Australia/Adelaide', COALESCE(s.starttime, s.startdate)), 'Dy') AS dow,
         CASE
           WHEN EXTRACT(HOUR FROM timezone('Australia/Adelaide', COALESCE(s.starttime, s.startdate))) < 12
             THEN 'morning'
           WHEN EXTRACT(HOUR FROM timezone('Australia/Adelaide', COALESCE(s.starttime, s.startdate))) < 17
             THEN 'afternoon'
           ELSE 'evening'
         END AS band,
         to_char(timezone('Australia/Adelaide', COALESCE(s.starttime, s.startdate)), 'YYYY-MM-DD') AS day,
         GREATEST(COALESCE(s.aberp_no_of_staff, 1), 1)::int AS required,
         COALESCE((
           SELECT COUNT(*)::int
           FROM adempiere.aberp_rostered_shiftstaff ss
           WHERE ss.aberp_rostered_shift_id = s.aberp_rostered_shift_id
             AND ss.isactive = 'Y'
             AND ss.c_bpartner_staff_id IS NOT NULL
             AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
         ), 0) AS assigned
       FROM adempiere.aberp_rostered_shift s
       WHERE s.isactive = 'Y'
         AND COALESCE(s.iscancelled, 'N') = 'N'
         AND COALESCE(s.aberp_isshiftrosteredtemplate, 'N') = 'N'
         AND COALESCE(s.starttime, s.startdate) >= NOW() - interval '28 days'
         AND COALESCE(s.starttime, s.startdate) <= NOW() + interval '14 days'
     ),
     vacant_rows AS (
       SELECT dow, band, day, GREATEST(required - assigned, 0) AS vacant
       FROM shift_rows
       WHERE required > assigned
     )
     SELECT
       dow,
       band,
       SUM(vacant)::text AS vacant,
       COUNT(DISTINCT day)::text AS sample_days
     FROM vacant_rows
     GROUP BY dow, band
     HAVING SUM(vacant) >= 3
     ORDER BY SUM(vacant) DESC
     LIMIT 8`,
  );

  return rows.map((r) => ({
    dayOfWeek: r.dow,
    band: r.band,
    vacantSlots: Number(r.vacant),
    sampleDays: Number(r.sample_days),
    detail: `${r.dow} ${r.band} — ${r.vacant} vacant slots across ${r.sample_days} day(s)`,
  }));
}

async function utilisationSnapshot(): Promise<{
  busiest: UtilisationRow[];
  lightest: UtilisationRow[];
}> {
  const { rows } = await query<{
    worker_id: number;
    worker_name: string;
    assigned_shifts: string;
    hours_approx: string;
  }>(
    `SELECT
       bp.c_bpartner_id AS worker_id,
       bp.name AS worker_name,
       COUNT(*)::text AS assigned_shifts,
       COALESCE(SUM(
         EXTRACT(EPOCH FROM (
           COALESCE(s.endtime, s.enddate, s.starttime, s.startdate)
           - COALESCE(s.starttime, s.startdate)
         )) / 3600
       ), 0)::text AS hours_approx
     FROM adempiere.aberp_rostered_shiftstaff ss
     JOIN adempiere.aberp_rostered_shift s
       ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
     JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = ss.c_bpartner_staff_id
     WHERE ss.isactive = 'Y'
       AND ss.c_bpartner_staff_id IS NOT NULL
       AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
       AND COALESCE(s.starttime, s.startdate) >= NOW()
       AND COALESCE(s.starttime, s.startdate) <= NOW() + interval '14 days'
     GROUP BY bp.c_bpartner_id, bp.name
     ORDER BY COUNT(*) DESC, bp.name
     LIMIT 40`,
  );

  const mapped = rows.map((r) => ({
    workerId: Number(r.worker_id),
    workerName: r.worker_name,
    assignedShifts: Number(r.assigned_shifts),
    hoursApprox: Math.round(Number(r.hours_approx) * 10) / 10,
  }));

  return {
    busiest: mapped.slice(0, 5),
    lightest: [...mapped].sort((a, b) => a.assignedShifts - b.assignedShifts).slice(0, 5),
  };
}

function buildRecommendations(b: Omit<PlannerBriefing, 'recommendations' | 'summaryText'>): string[] {
  const recs: string[] = [];
  const topGap = b.trainingGaps[0];
  if (topGap && topGap.blockedShifts > 0) {
    recs.push(
      `Schedule ${topGap.credentialName} training — blocks ${topGap.blockedShifts} shift slot(s) (${topGap.openGaps} open gaps).`,
    );
  }
  if (b.credentialExpiry.within7Days > 0) {
    recs.push(
      `Bulk remind ${b.credentialExpiry.within7Days} credential(s) expiring within 7 days.`,
    );
  } else if (b.credentialExpiry.within30Days > 0) {
    recs.push(
      `Review ${b.credentialExpiry.within30Days} credential(s) due within 30 days.`,
    );
  }
  const signal = b.hiringSignals[0];
  if (signal) {
    recs.push(`Hiring signal: ${signal.detail}. Consider casual coverage.`);
  }
  if (b.fillRate.urgentVacant > 0) {
    recs.push(
      `${b.fillRate.urgentVacant} urgent vacant slot(s) in the next 24h — run Emergency scan.`,
    );
  }
  if (b.fillRate.delta < -5) {
    recs.push(
      `Fill rate down ${Math.abs(b.fillRate.delta)} pts vs prior period — investigate recurring gaps.`,
    );
  }
  if (recs.length === 0) {
    recs.push('Coverage looks steady — keep Emergency scan on and watch Confirms for near-term declines.');
  }
  return recs.slice(0, 5);
}

function buildSummaryText(b: PlannerBriefing): string {
  const gapLine = b.trainingGaps[0]
    ? `${b.trainingGaps[0].credentialName} blocks ${b.trainingGaps[0].blockedShifts}`
    : 'none critical';
  const hire = b.hiringSignals[0]?.detail ?? 'none';
  return (
    `Daily Planner Briefing\n` +
    `Fill rate: ${b.fillRate.thisPeriod}% (${b.fillRate.vacantSlots} vacant` +
    `${b.fillRate.urgentVacant ? `, ${b.fillRate.urgentVacant} urgent` : ''})\n` +
    `vs last period: ${b.fillRate.lastPeriod}% (${b.fillRate.delta >= 0 ? '+' : ''}${b.fillRate.delta} pts)\n` +
    `Training gaps: ${gapLine}\n` +
    `Credential expiry: ${b.credentialExpiry.within30Days} due in 30d` +
    ` (${b.credentialExpiry.within7Days} in 7d)\n` +
    `Hiring signal: ${hire}\n` +
    `Next period forecast: ${b.forecastNext.fillRate}% filled\n\n` +
    `Recommendations:\n` +
    b.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')
  );
}

export async function buildPlannerBriefing(): Promise<PlannerBriefing> {
  const thisWin = periodWindow(0, 14);
  const lastWin = periodWindow(-14, 14);
  const nextWin = periodWindow(14, 14);

  const [thisFill, lastFill, nextFill, trainingGaps, credentialExpiry, hiringSignals, utilisation] =
    await Promise.all([
      fillForWindow(thisWin.start, thisWin.end),
      fillForWindow(lastWin.start, lastWin.end),
      fillForWindow(nextWin.start, nextWin.end),
      aggregateTrainingGaps(),
      scanCredentialExpiry(),
      detectHiringSignals(),
      utilisationSnapshot(),
    ]);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const base = {
    generatedAt: new Date().toISOString(),
    period: {
      start: iso(thisWin.start),
      end: iso(thisWin.end),
      label: 'This period (14d)',
    },
    priorPeriod: {
      start: iso(lastWin.start),
      end: iso(lastWin.end),
      label: 'Prior period (14d)',
    },
    fillRate: {
      thisPeriod: thisFill.fillRate,
      lastPeriod: lastFill.fillRate,
      delta: thisFill.fillRate - lastFill.fillRate,
      vacantSlots: thisFill.vacant,
      requiredSlots: thisFill.required,
      assignedSlots: thisFill.assigned,
      urgentVacant: thisFill.urgentVacant,
    },
    trainingGaps,
    credentialExpiry,
    hiringSignals,
    utilisation,
    forecastNext: {
      period: { start: iso(nextWin.start), end: iso(nextWin.end) },
      fillRate: nextFill.fillRate,
      vacantSlots: nextFill.vacant,
      requiredSlots: nextFill.required,
    },
  };

  const recommendations = buildRecommendations(base);
  const briefing: PlannerBriefing = {
    ...base,
    recommendations,
    summaryText: '',
  };
  briefing.summaryText = buildSummaryText(briefing);
  return briefing;
}

export async function persistDailyPlan(briefing: PlannerBriefing): Promise<number> {
  return writeAudit({
    agentType: 'system',
    action: 'daily_plan',
    notes: JSON.stringify({
      fillRate: briefing.fillRate.thisPeriod,
      vacant: briefing.fillRate.vacantSlots,
      urgent: briefing.fillRate.urgentVacant,
      trainingTop: briefing.trainingGaps[0]?.credentialName ?? null,
      expiry30: briefing.credentialExpiry.within30Days,
      hiring: briefing.hiringSignals[0]?.detail ?? null,
      recommendations: briefing.recommendations,
      summary: briefing.summaryText.slice(0, 1500),
    }),
  });
}
