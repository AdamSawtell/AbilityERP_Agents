import { query } from '../db/pool';
import {
  buildConfirmReminderMessage,
  resolveWorkerUserId,
  sendPathwaysMessage,
} from '../pathways';
import { writeAudit } from './audit';
import { getConfig } from './configStore';

export type ConfirmationRow = {
  id: number;
  shift_id: number;
  shift_name: string | null;
  worker_id: number;
  worker_name: string | null;
  staff_line_id: number | null;
  status: string;
  requested_at: Date;
  responded_at: Date | null;
  escalated_at: Date | null;
  pathways_request_id: number | null;
  shift_start: Date | null;
  notes: string | null;
};

export type UpcomingAssignment = {
  staff_line_id: number;
  shift_id: number;
  shift_name: string;
  worker_id: number;
  worker_name: string;
  ad_client_id: number;
  start_ts: Date;
  end_ts: Date;
  location_name: string | null;
  hours_until: number;
};

export async function listUpcomingAssignments(withinHours: number): Promise<UpcomingAssignment[]> {
  const { rows } = await query<{
    staff_line_id: number;
    shift_id: number;
    shift_name: string;
    worker_id: number;
    worker_name: string;
    ad_client_id: number;
    start_ts: Date;
    end_ts: Date;
    location_name: string | null;
    hours_until: string;
  }>(
    `SELECT
        ss.aberp_rostered_shiftstaff_id AS staff_line_id,
        s.aberp_rostered_shift_id AS shift_id,
        s.name AS shift_name,
        ss.c_bpartner_staff_id AS worker_id,
        bp.name AS worker_name,
        s.ad_client_id,
        COALESCE(s.starttime, s.startdate) AS start_ts,
        COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) AS end_ts,
        ml.name AS location_name,
        (EXTRACT(EPOCH FROM (COALESCE(s.starttime, s.startdate) - NOW())) / 3600)::text AS hours_until
     FROM adempiere.aberp_rostered_shiftstaff ss
     JOIN adempiere.aberp_rostered_shift s
       ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
     JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = ss.c_bpartner_staff_id
     LEFT JOIN adempiere.aberp_masterlocation ml
       ON ml.aberp_masterlocation_id = s.aberp_masterlocation_id
     WHERE ss.isactive = 'Y'
       AND ss.c_bpartner_staff_id IS NOT NULL
       AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
       AND COALESCE(ss.aberp_requestshift, 'N') <> 'Y'
       AND COALESCE(s.starttime, s.startdate) > NOW() + interval '30 minutes'
       AND COALESCE(s.starttime, s.startdate) <= NOW() + make_interval(hours => $1::int)
       AND NOT EXISTS (
         SELECT 1 FROM adempiere.rostering_agent_confirmations c
         WHERE c.staff_line_id = ss.aberp_rostered_shiftstaff_id
           AND c.status IN ('pending', 'confirmed', 'declined', 'escalated')
       )
     ORDER BY COALESCE(s.starttime, s.startdate)
     LIMIT 100`,
    [withinHours],
  );

  return rows.map((r) => ({
    staff_line_id: Number(r.staff_line_id),
    shift_id: Number(r.shift_id),
    shift_name: r.shift_name,
    worker_id: Number(r.worker_id),
    worker_name: r.worker_name,
    ad_client_id: Number(r.ad_client_id),
    start_ts: new Date(r.start_ts),
    end_ts: new Date(r.end_ts),
    location_name: r.location_name,
    hours_until: Number(r.hours_until),
  }));
}

export async function createConfirmation(opts: {
  assignment: UpcomingAssignment;
  pathwaysRequestId: number | null;
  responseLogId: number | null;
}): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO adempiere.rostering_agent_confirmations (
        shift_id, shift_name, worker_id, worker_name, staff_line_id,
        status, pathways_request_id, response_log_id, shift_start, notes
     ) VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9)
     RETURNING id`,
    [
      opts.assignment.shift_id,
      opts.assignment.shift_name,
      opts.assignment.worker_id,
      opts.assignment.worker_name,
      opts.assignment.staff_line_id,
      opts.pathwaysRequestId,
      opts.responseLogId,
      opts.assignment.start_ts,
      'Pre-shift confirm request sent',
    ],
  );
  return Number(rows[0].id);
}

export async function listConfirmations(opts: {
  status?: string;
  limit?: number;
}): Promise<ConfirmationRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  if (opts.status === 'all') {
    const { rows } = await query<ConfirmationRow>(
      `SELECT * FROM adempiere.rostering_agent_confirmations
       ORDER BY COALESCE(shift_start, requested_at) DESC
       LIMIT $1`,
      [limit],
    );
    return rows;
  }
  if (opts.status) {
    const { rows } = await query<ConfirmationRow>(
      `SELECT * FROM adempiere.rostering_agent_confirmations
       WHERE status = $1
       ORDER BY COALESCE(shift_start, requested_at) ASC
       LIMIT $2`,
      [opts.status, limit],
    );
    return rows;
  }
  const { rows } = await query<ConfirmationRow>(
    `SELECT * FROM adempiere.rostering_agent_confirmations
     WHERE status IN ('pending', 'escalated')
     ORDER BY CASE status WHEN 'escalated' THEN 0 ELSE 1 END,
              COALESCE(shift_start, requested_at) ASC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function getConfirmation(id: number): Promise<ConfirmationRow | null> {
  const { rows } = await query<ConfirmationRow>(
    `SELECT * FROM adempiere.rostering_agent_confirmations WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function markConfirmation(
  id: number,
  status: 'confirmed' | 'declined' | 'escalated' | 'expired',
  notes?: string | null,
): Promise<ConfirmationRow | null> {
  const { rows } = await query<ConfirmationRow>(
    `UPDATE adempiere.rostering_agent_confirmations
     SET status = $2::varchar,
         responded_at = CASE
           WHEN $2::text IN ('confirmed','declined') THEN NOW()
           ELSE responded_at
         END,
         escalated_at = CASE
           WHEN $2::text = 'escalated' THEN NOW()
           ELSE escalated_at
         END,
         notes = CASE
           WHEN $3::text IS NULL OR $3::text = '' THEN notes
           WHEN notes IS NULL OR notes = '' THEN $3::text
           ELSE notes || ' | ' || $3::text
         END
     WHERE id = $1
     RETURNING *`,
    [id, status, notes ?? null],
  );
  return rows[0] ?? null;
}

/** Poll Pathways response log for REQ (confirm) / DEC (decline) after request. */
export async function pollWorkerResponse(opts: {
  workerId: number;
  shiftId: number;
  since: Date;
}): Promise<'confirmed' | 'declined' | null> {
  const userId = await resolveWorkerUserId(opts.workerId);
  if (userId == null) return null;

  const { rows } = await query<{ response: string }>(
    `SELECT aberp_rosteredresponse AS response
     FROM adempiere.aberp_rosteredresponselog
     WHERE aberp_user_contact_id = $1
       AND aberp_rostered_shift_id = $2
       AND aberp_rosteredresponse IN ('REQ', 'DEC')
       AND created > $3
       AND COALESCE(issuperseded, 'N') = 'N'
     ORDER BY created DESC
     LIMIT 1`,
    [userId, opts.shiftId, opts.since],
  );

  const r = rows[0]?.response;
  if (r === 'REQ') return 'confirmed';
  if (r === 'DEC') return 'declined';
  return null;
}

export async function vacateStaffLine(staffLineId: number): Promise<void> {
  await query(
    `UPDATE adempiere.aberp_rostered_shiftstaff
     SET c_bpartner_staff_id = NULL,
         aberp_user_contact_id = NULL,
         aberp_declineshift = 'Y',
         updated = NOW(),
         updatedby = 100
     WHERE aberp_rostered_shiftstaff_id = $1`,
    [staffLineId],
  );
}

export async function sendConfirmations(): Promise<{
  sent: number;
  errors: string[];
}> {
  const config = await getConfig();
  const assignments = await listUpcomingAssignments(config.pre_shift_confirm_hours);
  let sent = 0;
  const errors: string[] = [];

  for (const a of assignments) {
    try {
      const userId = await resolveWorkerUserId(a.worker_id);
      if (userId == null) {
        errors.push(`shift ${a.shift_id}: no AD_User for worker ${a.worker_id}`);
        continue;
      }

      const message = await buildConfirmReminderMessage({
        workerName: a.worker_name,
        shiftName: a.shift_name,
        startTs: a.start_ts,
        endTs: a.end_ts,
        locationName: a.location_name,
      });

      const result = await sendPathwaysMessage({
        workerAdUserId: userId,
        workerBPartnerId: a.worker_id,
        shiftId: a.shift_id,
        message,
        adClientId: a.ad_client_id,
      });

      const id = await createConfirmation({
        assignment: a,
        pathwaysRequestId: result.requestId,
        responseLogId: result.responseLogId,
      });

      await writeAudit({
        agentType: 'system',
        action: 'pre_shift_sent',
        shiftId: a.shift_id,
        workerId: a.worker_id,
        notes: `confirmation #${id}; Pathways=${result.sent}`,
      });
      sent += 1;
    } catch (err) {
      errors.push(
        `shift ${a.shift_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { sent, errors };
}

export async function processPendingResponses(): Promise<{
  confirmed: number;
  declined: number;
  escalated: number;
}> {
  const config = await getConfig();
  const pending = await listConfirmations({ status: 'pending', limit: 100 });
  let confirmed = 0;
  let declined = 0;
  let escalated = 0;

  for (const row of pending) {
    const since = new Date(row.requested_at);
    const response = await pollWorkerResponse({
      workerId: Number(row.worker_id),
      shiftId: Number(row.shift_id),
      since,
    });

    if (response === 'confirmed') {
      await markConfirmation(Number(row.id), 'confirmed', 'Worker REQ via Pathways');
      await writeAudit({
        agentType: 'system',
        action: 'pre_shift_confirmed',
        shiftId: Number(row.shift_id),
        workerId: Number(row.worker_id),
        notes: `confirmation #${row.id}`,
      });
      confirmed += 1;
      continue;
    }

    if (response === 'declined') {
      await markConfirmation(Number(row.id), 'declined', 'Worker DEC via Pathways');
      if (row.staff_line_id != null) {
        await vacateStaffLine(Number(row.staff_line_id));
      }
      await writeAudit({
        agentType: 'system',
        action: 'pre_shift_cancelled',
        shiftId: Number(row.shift_id),
        workerId: Number(row.worker_id),
        notes: `confirmation #${row.id}; staff line vacated`,
      });
      declined += 1;
      continue;
    }

    // Escalate if within escalation window and still pending
    const start = row.shift_start ? new Date(row.shift_start).getTime() : null;
    if (start != null) {
      const hoursUntil = (start - Date.now()) / 3_600_000;
      if (hoursUntil <= config.escalation_hours_before_shift && hoursUntil > 0) {
        await markConfirmation(
          Number(row.id),
          'escalated',
          `No response with ${hoursUntil.toFixed(1)}h until shift`,
        );
        await writeAudit({
          agentType: 'system',
          action: 'pre_shift_escalated',
          shiftId: Number(row.shift_id),
          workerId: Number(row.worker_id),
          notes: `confirmation #${row.id}; ${hoursUntil.toFixed(1)}h left`,
        });
        escalated += 1;
      }
    }
  }

  return { confirmed, declined, escalated };
}

export async function applyManualResponse(
  id: number,
  response: 'confirmed' | 'declined',
  by: string,
): Promise<ConfirmationRow | null> {
  const row = await getConfirmation(id);
  if (!row || (row.status !== 'pending' && row.status !== 'escalated')) {
    return null;
  }

  const marked = await markConfirmation(
    id,
    response,
    `Manual ${response} by ${by} (no-Entra test / admin)`,
  );

  if (response === 'confirmed') {
    await writeAudit({
      agentType: 'system',
      action: 'pre_shift_confirmed',
      shiftId: Number(row.shift_id),
      workerId: Number(row.worker_id),
      approvedBy: by,
      notes: `confirmation #${id} (manual)`,
    });
  } else {
    if (row.staff_line_id != null) {
      await vacateStaffLine(Number(row.staff_line_id));
    }
    await writeAudit({
      agentType: 'system',
      action: 'pre_shift_cancelled',
      shiftId: Number(row.shift_id),
      workerId: Number(row.worker_id),
      approvedBy: by,
      notes: `confirmation #${id} (manual); staff line vacated`,
    });
  }

  return marked;
}
