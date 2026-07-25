import { query } from '../db/pool';
import type { MatchCandidate } from '../engine/types';
import { rosteredShiftZoomUrl } from '../idempiere/zoom';

export async function expireStaleProposals(maxAgeHours = 2): Promise<number> {
  const { rowCount } = await query(
    `UPDATE adempiere.rostering_agent_proposals
     SET status = 'expired',
         reviewed_at = NOW(),
         notes = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE ' | ' END || 'auto-expired'
     WHERE status = 'pending'
       AND proposed_at < NOW() - make_interval(hours => $1::int)`,
    [maxAgeHours],
  );
  return rowCount ?? 0;
}

export async function upsertProposalsForShift(opts: {
  shiftId: number;
  shiftName: string;
  candidates: MatchCandidate[];
}): Promise<number> {
  // Supersede prior pending proposals for this shift
  await query(
    `UPDATE adempiere.rostering_agent_proposals
     SET status = 'expired',
         reviewed_at = NOW(),
         notes = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE ' | ' END || 'superseded by new scan'
     WHERE shift_id = $1 AND status = 'pending'`,
    [opts.shiftId],
  );

  let written = 0;
  for (const c of opts.candidates) {
    await query(
      `INSERT INTO adempiere.rostering_agent_proposals (
          shift_id, shift_name, worker_id, worker_name, score,
          rules_passed, rules_failed, status
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'pending')`,
      [
        opts.shiftId,
        opts.shiftName,
        c.workerId,
        c.workerName,
        c.score,
        JSON.stringify({
          hard: c.hardRules,
          soft: c.softRules,
          breakdown: c.scoreBreakdown,
          isAutoApproved: c.isAutoApproved,
          reason: c.reason,
        }),
        JSON.stringify(c.hardRules.filter((r) => !r.pass)),
      ],
    );
    written += 1;
  }
  return written;
}

export async function getProposal(id: number) {
  const { rows } = await query(
    `SELECT id, shift_id, shift_name, worker_id, worker_name, score,
            rules_passed, rules_failed, proposed_at, status, reviewed_by,
            reviewed_at, notes, created
     FROM adempiere.rostering_agent_proposals
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function markProposalStatus(opts: {
  id: number;
  status: 'approved' | 'rejected';
  reviewedBy: string;
  notes?: string | null;
}) {
  const { rows } = await query(
    `UPDATE adempiere.rostering_agent_proposals
     SET status = $2,
         reviewed_by = $3,
         reviewed_at = NOW(),
         notes = CASE
           WHEN $4::text IS NULL OR $4 = '' THEN notes
           WHEN notes IS NULL OR notes = '' THEN $4
           ELSE notes || ' | ' || $4
         END
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [opts.id, opts.status, opts.reviewedBy, opts.notes ?? null],
  );
  return rows[0] ?? null;
}

function urgencyFromHours(hours: number | null): 'critical' | 'high' | 'normal' | null {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours < 4) return 'critical';
  if (hours < 24) return 'high';
  return 'normal';
}

function mapProposalRow(r: {
  id: number | string;
  shift_id: number | string;
  shift_name: string | null;
  worker_id: number | string;
  worker_name: string | null;
  score: number | string;
  rules_passed: unknown;
  rules_failed: unknown;
  proposed_at: Date | string;
  status: string;
  shift_start?: Date | string | null;
  shift_end?: Date | string | null;
  location_name?: string | null;
  client_names?: string | null;
  required_staff?: number | string | null;
  assigned_staff?: number | string | null;
  shift_uu?: string | null;
}) {
  const start =
    r.shift_start != null ? new Date(r.shift_start) : null;
  const end = r.shift_end != null ? new Date(r.shift_end) : null;
  const hoursUntil =
    start && !Number.isNaN(start.getTime())
      ? Math.round(((start.getTime() - Date.now()) / 3_600_000) * 10) / 10
      : null;
  const shiftId = Number(r.shift_id);
  const shiftUu = r.shift_uu != null && String(r.shift_uu).trim() ? String(r.shift_uu).trim() : null;

  return {
    id: Number(r.id),
    shiftId,
    shiftName: r.shift_name ?? '',
    workerId: Number(r.worker_id),
    workerName: r.worker_name ?? '',
    score: Number(r.score),
    isAutoApproved: Boolean(
      (r.rules_passed as { isAutoApproved?: boolean } | null)?.isAutoApproved,
    ),
    proposedAt:
      typeof r.proposed_at === 'string'
        ? r.proposed_at
        : r.proposed_at?.toISOString?.() ?? String(r.proposed_at),
    status: r.status,
    shift: {
      startTime: start && !Number.isNaN(start.getTime()) ? start.toISOString() : null,
      endTime: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
      location: r.location_name ?? null,
      clients: r.client_names ?? null,
      requiredStaff:
        r.required_staff != null && Number.isFinite(Number(r.required_staff))
          ? Number(r.required_staff)
          : null,
      assignedStaff:
        r.assigned_staff != null && Number.isFinite(Number(r.assigned_staff))
          ? Number(r.assigned_staff)
          : null,
      urgency: urgencyFromHours(hoursUntil),
      hoursUntilShift: hoursUntil,
      shiftUu,
      erpUrl: rosteredShiftZoomUrl({ shiftId, shiftUu }),
    },
    rulesPassed: r.rules_passed as {
      reason?: string;
      hard?: { rule: string; pass: boolean; detail?: string }[];
      soft?: { rule: string; pass: boolean; weight: number; earned: number }[];
    } | undefined,
    rulesFailed: r.rules_failed,
  };
}

export async function listPendingProposals(limit = 50, offset = 0) {
  const { rows } = await query(
    `SELECT
        p.id, p.shift_id, p.shift_name, p.worker_id, p.worker_name, p.score,
        p.rules_passed, p.rules_failed, p.proposed_at, p.status, p.reviewed_by,
        p.reviewed_at, p.notes, p.created,
        COALESCE(s.starttime, s.startdate) AS shift_start,
        COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) AS shift_end,
        NULLIF(TRIM(s.aberp_rostered_shift_uu), '') AS shift_uu,
        ml.name AS location_name,
        s.aberp_no_of_staff AS required_staff,
        COALESCE(staff_counts.cnt, 0)::int AS assigned_staff,
        clients.client_names
     FROM adempiere.rostering_agent_proposals p
     LEFT JOIN adempiere.aberp_rostered_shift s
       ON s.aberp_rostered_shift_id = p.shift_id
     LEFT JOIN adempiere.aberp_masterlocation ml
       ON ml.aberp_masterlocation_id = s.aberp_masterlocation_id
     LEFT JOIN (
       SELECT aberp_rostered_shift_id, COUNT(*) AS cnt
       FROM adempiere.aberp_rostered_shiftstaff
       WHERE isactive = 'Y'
         AND c_bpartner_staff_id IS NOT NULL
         AND COALESCE(aberp_requestshift, 'N') <> 'Y'
         AND COALESCE(aberp_declineshift, 'N') <> 'Y'
       GROUP BY aberp_rostered_shift_id
     ) staff_counts ON staff_counts.aberp_rostered_shift_id = p.shift_id
     LEFT JOIN LATERAL (
       SELECT string_agg(bp.name, ', ' ORDER BY bp.name) AS client_names
       FROM adempiere.aberp_rostered_shiftreceiver sr
       JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = sr.c_bpartner_id
       WHERE sr.aberp_rostered_shift_id = p.shift_id
         AND sr.isactive = 'Y'
     ) clients ON TRUE
     WHERE p.status = 'pending'
     ORDER BY p.proposed_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  const countRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM adempiere.rostering_agent_proposals
     WHERE status = 'pending'`,
  );

  const autoRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM adempiere.rostering_agent_proposals
     WHERE status = 'pending'
       AND (
         COALESCE((rules_passed->>'isAutoApproved')::boolean, false) = true
         OR score >= (
           SELECT COALESCE(NULLIF(value, '')::int, 90)
           FROM adempiere.rostering_agent_config
           WHERE key = 'auto_approve_threshold'
           LIMIT 1
         )
       )
       AND proposed_at::date = CURRENT_DATE`,
  );

  const exceptionRes = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM adempiere.rostering_agent_proposals
     WHERE status = 'pending'
       AND COALESCE((rules_passed->>'isAutoApproved')::boolean, false) = false
       AND score < (
         SELECT COALESCE(NULLIF(value, '')::int, 90)
         FROM adempiere.rostering_agent_config
         WHERE key = 'auto_approve_threshold'
         LIMIT 1
       )`,
  );

  return {
    proposals: rows.map((r) => mapProposalRow(r as Parameters<typeof mapProposalRow>[0])),
    pendingCount: Number(countRes.rows[0]?.cnt ?? 0),
    autoApprovedFlaggedToday: Number(autoRes.rows[0]?.cnt ?? 0),
    exceptionCount: Number(exceptionRes.rows[0]?.cnt ?? 0),
    limit,
    offset,
  };
}

/** One top pending proposal per shift at/above minScore (for bulk approve). */
export async function listBulkApproveTargets(minScore: number, limit = 50) {
  const { rows } = await query(
    `SELECT DISTINCT ON (shift_id)
        id, shift_id, shift_name, worker_id, worker_name, score,
        rules_passed, rules_failed, proposed_at, status
     FROM adempiere.rostering_agent_proposals
     WHERE status = 'pending'
       AND score >= $1
     ORDER BY shift_id, score DESC, proposed_at ASC
     LIMIT $2`,
    [minScore, limit],
  );
  return rows.map((r) => mapProposalRow(r as Parameters<typeof mapProposalRow>[0]));
}

export async function expireSiblingProposals(shiftId: number, keepId: number): Promise<void> {
  await query(
    `UPDATE adempiere.rostering_agent_proposals
     SET status = 'expired',
         reviewed_at = NOW(),
         notes = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE ' | ' END || 'superseded by bulk approve'
     WHERE shift_id = $1 AND status = 'pending' AND id <> $2`,
    [shiftId, keepId],
  );
}
