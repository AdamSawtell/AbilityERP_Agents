import { query } from '../db/pool';
import { notifyRosterOfficer } from '../pathways';

export type GapRow = {
  id: number;
  detected_at: Date;
  shift_id: number | null;
  shift_name: string | null;
  shift_date: Date | null;
  shift_time: string | null;
  reason: string;
  credential_id: number | null;
  credential_name: string | null;
  affected_workers: unknown;
  blocked_count: number | null;
  resolved: boolean;
  training_requested: boolean;
  escalation_level: string;
  escalated_at: Date | null;
  resolved_at: Date | null;
  resolution_notes: string | null;
  created: Date;
};

export type TrainingGapSummary = {
  credentialId: number | null;
  credentialName: string;
  reason: string;
  blockedShifts: number;
  openGaps: number;
  trainingRequested: number;
  highestEscalation: string;
  sampleGapIds: number[];
  shiftNames: string[];
};

export async function listGaps(
  resolved?: boolean,
  limit = 50,
  offset = 0,
): Promise<GapRow[]> {
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

  const { rows } = await query<GapRow>(
    `SELECT id, detected_at, shift_id, shift_name, shift_date, shift_time, reason,
            credential_id, credential_name, affected_workers, blocked_count,
            resolved, training_requested, escalation_level, escalated_at,
            resolved_at, resolution_notes, created
     FROM adempiere.rostering_agent_gaps
     ${where}
     ORDER BY
       CASE escalation_level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       detected_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );
  return rows;
}

export async function getGap(id: number): Promise<GapRow | null> {
  const { rows } = await query<GapRow>(
    `SELECT id, detected_at, shift_id, shift_name, shift_date, shift_time, reason,
            credential_id, credential_name, affected_workers, blocked_count,
            resolved, training_requested, escalation_level, escalated_at,
            resolved_at, resolution_notes, created
     FROM adempiere.rostering_agent_gaps
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listTrainingGapSummaries(): Promise<TrainingGapSummary[]> {
  const { rows } = await query<{
    credential_id: number | null;
    credential_name: string | null;
    reason: string;
    blocked: string;
    open_gaps: string;
    training_requested: string;
    highest: string;
    sample_ids: number[] | null;
    shift_names: string[] | null;
  }>(
    `SELECT
       credential_id,
       credential_name,
       reason,
       COALESCE(SUM(COALESCE(blocked_count, 1)), 0)::text AS blocked,
       COUNT(*)::text AS open_gaps,
       COUNT(*) FILTER (WHERE training_requested = TRUE)::text AS training_requested,
       CASE
         WHEN BOOL_OR(escalation_level = 'critical') THEN 'critical'
         WHEN BOOL_OR(escalation_level = 'warning') THEN 'warning'
         ELSE 'info'
       END AS highest,
       (ARRAY_AGG(id ORDER BY detected_at DESC))[1:5] AS sample_ids,
       (ARRAY_AGG(DISTINCT shift_name ORDER BY shift_name)
          FILTER (WHERE shift_name IS NOT NULL))[1:5] AS shift_names
     FROM adempiere.rostering_agent_gaps
     WHERE resolved = FALSE
     GROUP BY credential_id, credential_name, reason
     ORDER BY SUM(COALESCE(blocked_count, 1)) DESC, COUNT(*) DESC
     LIMIT 30`,
  );

  return rows.map((r) => ({
    credentialId: r.credential_id != null ? Number(r.credential_id) : null,
    credentialName: r.credential_name || r.reason || 'Unspecified',
    reason: r.reason,
    blockedShifts: Number(r.blocked),
    openGaps: Number(r.open_gaps),
    trainingRequested: Number(r.training_requested),
    highestEscalation: r.highest,
    sampleGapIds: (r.sample_ids ?? []).map(Number),
    shiftNames: r.shift_names ?? [],
  }));
}

export async function markTrainingRequested(
  id: number,
  notes?: string,
): Promise<GapRow | null> {
  const { rows } = await query<GapRow>(
    `UPDATE adempiere.rostering_agent_gaps
     SET training_requested = TRUE,
         resolution_notes = CASE
           WHEN $2::text IS NULL OR $2 = '' THEN resolution_notes
           WHEN resolution_notes IS NULL OR resolution_notes = '' THEN $2
           ELSE resolution_notes || ' | ' || $2
         END
     WHERE id = $1
     RETURNING *`,
    [id, notes ?? null],
  );
  return rows[0] ?? null;
}

export async function resolveGap(
  id: number,
  resolutionNotes?: string,
): Promise<GapRow | null> {
  const { rows } = await query<GapRow>(
    `UPDATE adempiere.rostering_agent_gaps
     SET resolved = TRUE,
         resolved_at = NOW(),
         resolution_notes = CASE
           WHEN $2::text IS NULL OR $2 = '' THEN resolution_notes
           WHEN resolution_notes IS NULL OR resolution_notes = '' THEN $2
           ELSE resolution_notes || ' | ' || $2
         END
     WHERE id = $1 AND resolved = FALSE
     RETURNING *`,
    [id, resolutionNotes ?? null],
  );
  return rows[0] ?? null;
}

/** Request training for one gap (or all open gaps sharing the same credential/reason). */
export async function requestTraining(opts: {
  gapId: number;
  requestedBy: string;
  notes?: string;
  bulkSameCredential?: boolean;
}): Promise<{
  gaps: GapRow[];
  pathwaysSent: boolean;
  pathwaysMessage: string;
}> {
  const gap = await getGap(opts.gapId);
  if (!gap || gap.resolved) {
    return { gaps: [], pathwaysSent: false, pathwaysMessage: 'gap_not_found' };
  }

  let targets: GapRow[] = [gap];
  if (opts.bulkSameCredential) {
    const { rows } = await query<GapRow>(
      `SELECT id, detected_at, shift_id, shift_name, shift_date, shift_time, reason,
              credential_id, credential_name, affected_workers, blocked_count,
              resolved, training_requested, escalation_level, escalated_at,
              resolved_at, resolution_notes, created
       FROM adempiere.rostering_agent_gaps
       WHERE resolved = FALSE
         AND (
           ($1::numeric IS NOT NULL AND credential_id = $1)
           OR ($1::numeric IS NULL AND reason = $2 AND credential_id IS NULL)
         )
       ORDER BY id`,
      [gap.credential_id, gap.reason],
    );
    if (rows.length > 0) targets = rows;
  }

  const note =
    opts.notes?.trim() ||
    `Training requested by ${opts.requestedBy}` +
      (opts.bulkSameCredential ? ' (bulk same credential)' : '');

  const updated: GapRow[] = [];
  for (const t of targets) {
    const row = await markTrainingRequested(Number(t.id), note);
    if (row) updated.push(row);
  }

  const cred = gap.credential_name || gap.reason;
  const message =
    `Training request\n` +
    `${cred} — ${updated.length} open gap(s)\n` +
    (gap.shift_name ? `Example shift: ${gap.shift_name}\n` : '') +
    `Requested by ${opts.requestedBy}` +
    (opts.notes ? `\nNotes: ${opts.notes}` : '');

  let pathwaysSent = false;
  let pathwaysMessage = message;
  const shiftId = gap.shift_id != null ? Number(gap.shift_id) : null;
  if (shiftId != null) {
    try {
      const clientIdRes = await query<{ ad_client_id: number }>(
        `SELECT ad_client_id FROM adempiere.aberp_rostered_shift WHERE aberp_rostered_shift_id = $1`,
        [shiftId],
      );
      const result = await notifyRosterOfficer({
        message,
        shiftId,
        adClientId: clientIdRes.rows[0]
          ? Number(clientIdRes.rows[0].ad_client_id)
          : undefined,
      });
      pathwaysSent = result.sent;
      pathwaysMessage = result.message;
    } catch (err) {
      pathwaysMessage = err instanceof Error ? err.message : String(err);
    }
  } else {
    pathwaysMessage = 'no_shift_id_for_pathways';
  }

  return { gaps: updated, pathwaysSent, pathwaysMessage };
}
