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
       AND COALESCE((rules_passed->>'isAutoApproved')::boolean, false) = true
       AND proposed_at::date = CURRENT_DATE`,
  );

  return {
    proposals: rows.map((r) => ({
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
    })),
    pendingCount: Number(countRes.rows[0]?.cnt ?? 0),
    autoApprovedFlaggedToday: Number(autoRes.rows[0]?.cnt ?? 0),
    limit,
    offset,
  };
}
