import { query } from '../db/pool';

export async function listGaps(resolved?: boolean, limit = 50, offset = 0) {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (resolved !== undefined) {
    params.push(resolved);
    clauses.push(`resolved = $${params.length}`);
  }

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT id, detected_at, shift_id, shift_name, shift_date, shift_time, reason,
            credential_id, credential_name, affected_workers, blocked_count,
            resolved, training_requested, escalation_level, escalated_at,
            resolved_at, resolution_notes, created
     FROM adempiere.rostering_agent_gaps
     ${where}
     ORDER BY detected_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );
  return rows;
}

export async function markTrainingRequested(id: number, notes?: string) {
  const { rows } = await query(
    `UPDATE adempiere.rostering_agent_gaps
     SET training_requested = TRUE,
         resolution_notes = COALESCE($2, resolution_notes)
     WHERE id = $1
     RETURNING *`,
    [id, notes ?? null],
  );
  return rows[0] ?? null;
}
