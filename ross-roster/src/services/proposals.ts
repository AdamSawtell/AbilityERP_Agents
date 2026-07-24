import { query } from '../db/pool';
import type { MatchCandidate } from '../engine/types';

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
}) {
  return {
    id: Number(r.id),
    shiftId: Number(r.shift_id),
    shiftName: r.shift_name,
    workerId: Number(r.worker_id),
    workerName: r.worker_name,
    score: Number(r.score),
    isAutoApproved: Boolean(
      (r.rules_passed as { isAutoApproved?: boolean } | null)?.isAutoApproved,
    ),
    proposedAt: r.proposed_at,
    status: r.status,
    rulesPassed: r.rules_passed,
    rulesFailed: r.rules_failed,
  };
}

export async function listPendingProposals(limit = 50, offset = 0) {
  const { rows } = await query(
    `SELECT id, shift_id, shift_name, worker_id, worker_name, score,
            rules_passed, rules_failed, proposed_at, status, reviewed_by,
            reviewed_at, notes, created
     FROM adempiere.rostering_agent_proposals
     WHERE status = 'pending'
     ORDER BY proposed_at DESC
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
