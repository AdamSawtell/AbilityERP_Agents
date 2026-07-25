/**
 * SAW052 — AbilityERP response-log review queue.
 * Shift flag: AbERP_IsResponseLogReviewRequired
 * Row stamp: IsReviewed (same as SAW011 Accept Shift Request)
 */
import { assignWorker } from '../db/queries/assign';
import { query, withClient } from '../db/pool';
import { rosteredShiftZoomUrl } from '../idempiere/zoom';
import { writeAudit } from './audit';
import { getSkill } from './skills';

export type OpenResponseItem = {
  responseLogId: number;
  responseLogUu: string | null;
  shiftId: number;
  shiftName: string;
  shiftUu: string | null;
  erpUrl: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  reviewRequired: boolean;
  response: 'REQ' | 'DEC' | string;
  workerUserId: number;
  workerId: number | null;
  workerName: string;
  createdAt: string;
  vacantSlots: number;
  alreadyOnShift: boolean;
};

type DbRow = {
  response_log_id: number;
  response_log_uu: string | null;
  shift_id: number;
  shift_name: string | null;
  shift_uu: string | null;
  start_ts: Date | string | null;
  end_ts: Date | string | null;
  location_name: string | null;
  review_required: string | null;
  response: string;
  worker_user_id: number;
  worker_id: number | null;
  worker_name: string | null;
  created_at: Date | string;
  vacant_slots: number | string;
  already_on_shift: boolean | string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function mapRow(r: DbRow): OpenResponseItem {
  const shiftId = Number(r.shift_id);
  const shiftUu = r.shift_uu != null && String(r.shift_uu).trim() ? String(r.shift_uu).trim() : null;
  return {
    responseLogId: Number(r.response_log_id),
    responseLogUu: r.response_log_uu,
    shiftId,
    shiftName: r.shift_name ?? `Shift ${shiftId}`,
    shiftUu,
    erpUrl: rosteredShiftZoomUrl({ shiftId, shiftUu }),
    startTime: iso(r.start_ts),
    endTime: iso(r.end_ts),
    location: r.location_name,
    reviewRequired: (r.review_required ?? 'N') === 'Y',
    response: String(r.response ?? ''),
    workerUserId: Number(r.worker_user_id),
    workerId: r.worker_id != null ? Number(r.worker_id) : null,
    workerName: r.worker_name ?? `User ${r.worker_user_id}`,
    createdAt: iso(r.created_at) ?? new Date().toISOString(),
    vacantSlots: Number(r.vacant_slots ?? 0),
    alreadyOnShift: r.already_on_shift === true || r.already_on_shift === 't' || r.already_on_shift === 'Y',
  };
}

/** Open REQ/DEC rows needing review (shift flag Y or still unreviewed). */
export async function listOpenResponseReviews(limit = 100): Promise<OpenResponseItem[]> {
  const { rows } = await query<DbRow>(
    `SELECT
        l.aberp_rosteredresponselog_id AS response_log_id,
        NULLIF(TRIM(l.aberp_rosteredresponselog_uu), '') AS response_log_uu,
        s.aberp_rostered_shift_id AS shift_id,
        s.name AS shift_name,
        NULLIF(TRIM(s.aberp_rostered_shift_uu), '') AS shift_uu,
        COALESCE(s.starttime, s.startdate) AS start_ts,
        COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) AS end_ts,
        ml.name AS location_name,
        COALESCE(s.aberp_isresponselogreviewrequired, 'N') AS review_required,
        l.aberp_rosteredresponse AS response,
        l.aberp_user_contact_id AS worker_user_id,
        au.c_bpartner_id AS worker_id,
        COALESCE(bp.name, au.name) AS worker_name,
        l.created AS created_at,
        GREATEST(
          COALESCE(s.aberp_no_of_staff, 1)
            - COALESCE((
                SELECT COUNT(*)::int
                FROM adempiere.aberp_rostered_shiftstaff ss
                WHERE ss.aberp_rostered_shift_id = s.aberp_rostered_shift_id
                  AND ss.isactive = 'Y'
                  AND ss.c_bpartner_staff_id IS NOT NULL
                  AND COALESCE(ss.aberp_requestshift, 'N') <> 'Y'
                  AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
              ), 0),
          0
        ) AS vacant_slots,
        EXISTS (
          SELECT 1
          FROM adempiere.aberp_rostered_shiftstaff ss
          WHERE ss.aberp_rostered_shift_id = s.aberp_rostered_shift_id
            AND ss.isactive = 'Y'
            AND COALESCE(ss.aberp_user_contact_id, 0) > 0
            AND (
              ss.aberp_user_contact_id = l.aberp_user_contact_id
              OR ss.c_bpartner_staff_id = au.c_bpartner_id
            )
        ) AS already_on_shift
     FROM adempiere.aberp_rosteredresponselog l
     JOIN adempiere.aberp_rostered_shift s
       ON s.aberp_rostered_shift_id = l.aberp_rostered_shift_id
     LEFT JOIN adempiere.aberp_masterlocation ml
       ON ml.aberp_masterlocation_id = s.aberp_masterlocation_id
     LEFT JOIN adempiere.ad_user au
       ON au.ad_user_id = l.aberp_user_contact_id
     LEFT JOIN adempiere.c_bpartner bp
       ON bp.c_bpartner_id = au.c_bpartner_id
     WHERE l.isactive = 'Y'
       AND s.isactive = 'Y'
       AND COALESCE(s.iscancelled, 'N') = 'N'
       AND COALESCE(l.isreviewed, 'N') = 'N'
       AND COALESCE(l.issuperseded, 'N') = 'N'
       AND l.aberp_rosteredresponse IN ('REQ', 'DEC')
     ORDER BY
       CASE WHEN COALESCE(s.aberp_isresponselogreviewrequired, 'N') = 'Y' THEN 0 ELSE 1 END,
       COALESCE(s.starttime, s.startdate) ASC NULLS LAST,
       l.created ASC
     LIMIT $1`,
    [limit],
  );
  return rows.map(mapRow);
}

/** Recompute shift flag from remaining open REQ/DEC rows. */
export async function refreshResponseLogReviewRequired(shiftId: number): Promise<'Y' | 'N'> {
  const { rows } = await query<{ flag: string }>(
    `UPDATE adempiere.aberp_rostered_shift s
     SET aberp_isresponselogreviewrequired = CASE
           WHEN EXISTS (
             SELECT 1
             FROM adempiere.aberp_rosteredresponselog l
             WHERE l.aberp_rostered_shift_id = s.aberp_rostered_shift_id
               AND l.isactive = 'Y'
               AND COALESCE(l.isreviewed, 'N') = 'N'
               AND COALESCE(l.issuperseded, 'N') = 'N'
               AND l.aberp_rosteredresponse IN ('REQ', 'DEC')
           ) THEN 'Y'
           ELSE 'N'
         END,
         updated = NOW(),
         updatedby = 100
     WHERE s.aberp_rostered_shift_id = $1
     RETURNING aberp_isresponselogreviewrequired AS flag`,
    [shiftId],
  );
  return (rows[0]?.flag === 'Y' ? 'Y' : 'N') as 'Y' | 'N';
}

async function markResponseReviewed(responseLogId: number): Promise<void> {
  const { rowCount } = await query(
    `UPDATE adempiere.aberp_rosteredresponselog
     SET isreviewed = 'Y',
         updated = NOW(),
         updatedby = 100
     WHERE aberp_rosteredresponselog_id = $1
       AND COALESCE(isreviewed, 'N') = 'N'`,
    [responseLogId],
  );
  if ((rowCount ?? 0) === 0) {
    throw new Error('response_already_reviewed_or_missing');
  }
}

async function resolvePublishedStatusId(): Promise<number | null> {
  const { rows } = await query<{ id: number }>(
    `SELECT rs.r_status_id AS id
     FROM adempiere.r_status rs
     JOIN adempiere.r_statuscategory c ON c.r_statuscategory_id = rs.r_statuscategory_id
     WHERE rs.isactive = 'Y'
       AND c.isactive = 'Y'
       AND c.name = 'Shift Status'
       AND rs.name = 'Published'
     ORDER BY rs.r_status_id ASC
     LIMIT 1`,
  );
  if (rows[0]) return Number(rows[0].id);
  const fallback = await query<{ id: number }>(
    `SELECT r_status_id AS id
     FROM adempiere.r_status
     WHERE isactive = 'Y' AND name = 'Published'
     ORDER BY r_status_id ASC
     LIMIT 1`,
  );
  return fallback.rows[0] ? Number(fallback.rows[0].id) : null;
}

async function finalizeShiftAfterAccept(shiftId: number): Promise<void> {
  const publishedId = await resolvePublishedStatusId();
  await query(
    `UPDATE adempiere.aberp_rostered_shift
     SET aberp_isshowingasavailable = CASE
           WHEN aberp_isshowingasavailable IS NULL THEN NULL
           ELSE 'N'
         END,
         r_status_id = COALESCE($2::numeric, r_status_id),
         updated = NOW(),
         updatedby = 100
     WHERE aberp_rostered_shift_id = $1`,
    [shiftId, publishedId],
  );
}

export async function acceptResponseRequest(
  responseLogId: number,
  reviewedBy: string,
): Promise<{ shiftId: number; workerId: number; assignmentId: number | null }> {
  const { rows } = await query<{
    response: string;
    isreviewed: string | null;
    issuperseded: string | null;
    shift_id: number;
    worker_user_id: number;
    worker_id: number | null;
  }>(
    `SELECT
        l.aberp_rosteredresponse AS response,
        l.isreviewed,
        l.issuperseded,
        l.aberp_rostered_shift_id AS shift_id,
        l.aberp_user_contact_id AS worker_user_id,
        au.c_bpartner_id AS worker_id
     FROM adempiere.aberp_rosteredresponselog l
     LEFT JOIN adempiere.ad_user au ON au.ad_user_id = l.aberp_user_contact_id
     WHERE l.aberp_rosteredresponselog_id = $1
       AND l.isactive = 'Y'`,
    [responseLogId],
  );
  const row = rows[0];
  if (!row) throw new Error('not_found');
  if (String(row.response) !== 'REQ') throw new Error('not_a_request');
  if ((row.issuperseded ?? 'N') === 'Y') throw new Error('superseded');
  if ((row.isreviewed ?? 'N') === 'Y') throw new Error('already_reviewed');
  if (row.worker_id == null) throw new Error('worker_missing_bpartner');

  const shiftId = Number(row.shift_id);
  const workerId = Number(row.worker_id);

  // Already on shift → just mark reviewed (SAW011 parity)
  const onShift = await query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM adempiere.aberp_rostered_shiftstaff ss
     WHERE ss.aberp_rostered_shift_id = $1
       AND ss.isactive = 'Y'
       AND COALESCE(ss.aberp_user_contact_id, 0) > 0
       AND (
         ss.aberp_user_contact_id = $2
         OR ss.c_bpartner_staff_id = $3
       )
     LIMIT 1`,
    [shiftId, Number(row.worker_user_id), workerId],
  );

  let assignmentId: number | null = null;
  if (onShift.rows.length === 0) {
    const assigned = await assignWorker({
      shiftId,
      workerId,
      approvedBy: reviewedBy,
      notes: `Accepted REQ response log #${responseLogId}`,
      notifyWorker: true,
    });
    assignmentId = assigned.assignmentId;
  }

  await markResponseReviewed(responseLogId);
  await finalizeShiftAfterAccept(shiftId);
  await refreshResponseLogReviewRequired(shiftId);

  await writeAudit({
    agentType: 'system',
    action: 'response_accepted',
    shiftId,
    workerId,
    approvedBy: reviewedBy,
    notes: `response_log #${responseLogId}; assignment=${assignmentId ?? 'already_on_shift'}`,
  });

  return { shiftId, workerId, assignmentId };
}

/** Mark DEC (or unwanted REQ) reviewed without assigning. */
export async function dismissResponseReview(
  responseLogId: number,
  reviewedBy: string,
  notes?: string,
): Promise<void> {
  const { rows } = await query<{
    response: string;
    shift_id: number;
    worker_id: number | null;
    worker_user_id: number;
    isreviewed: string | null;
  }>(
    `SELECT
        l.aberp_rosteredresponse AS response,
        l.aberp_rostered_shift_id AS shift_id,
        l.aberp_user_contact_id AS worker_user_id,
        l.isreviewed,
        au.c_bpartner_id AS worker_id
     FROM adempiere.aberp_rosteredresponselog l
     LEFT JOIN adempiere.ad_user au ON au.ad_user_id = l.aberp_user_contact_id
     WHERE l.aberp_rosteredresponselog_id = $1 AND l.isactive = 'Y'`,
    [responseLogId],
  );
  const row = rows[0];
  if (!row) throw new Error('not_found');
  if ((row.isreviewed ?? 'N') === 'Y') throw new Error('already_reviewed');

  const shiftId = Number(row.shift_id);
  const response = String(row.response);

  // DEC while still on staff → vacate that line
  if (response === 'DEC' && row.worker_id != null) {
    await withClient(async (client) => {
      await client.query(
        `UPDATE adempiere.aberp_rostered_shiftstaff
         SET c_bpartner_staff_id = NULL,
             aberp_user_contact_id = NULL,
             aberp_declineshift = 'Y',
             updated = NOW(),
             updatedby = 100
         WHERE aberp_rostered_shift_id = $1
           AND isactive = 'Y'
           AND (
             aberp_user_contact_id = $2
             OR c_bpartner_staff_id = $3
           )`,
        [shiftId, Number(row.worker_user_id), Number(row.worker_id)],
      );
    });
  }

  await markResponseReviewed(responseLogId);
  await refreshResponseLogReviewRequired(shiftId);

  await writeAudit({
    agentType: 'system',
    action: 'response_dismissed',
    shiftId,
    workerId: row.worker_id != null ? Number(row.worker_id) : null,
    approvedBy: reviewedBy,
    notes: `response_log #${responseLogId} ${response}${notes ? `; ${notes}` : ''}`,
  });
}

export type ResponseReviewCycleSummary = {
  openCount: number;
  reqCount: number;
  decCount: number;
  autoAccepted: number;
  autoDismissedDec: number;
  flagsRefreshed: number;
  errors: string[];
};

/** Sync flags + optional auto-accept when skill config allows. */
export async function runResponseReviewCycle(
  reviewedBy = 'ross',
): Promise<ResponseReviewCycleSummary> {
  const summary: ResponseReviewCycleSummary = {
    openCount: 0,
    reqCount: 0,
    decCount: 0,
    autoAccepted: 0,
    autoDismissedDec: 0,
    flagsRefreshed: 0,
    errors: [],
  };

  const skill = await getSkill('response_review').catch(() => null);
  if (skill && skill.status !== 'on') {
    await writeAudit({
      agentType: 'system',
      action: 'response_review_cycle',
      notes: JSON.stringify({ skipped: `skill_${skill.status}` }),
    });
    return summary;
  }

  const autoAccept = Boolean(skill?.config_json?.auto_accept_req);
  const autoDismissDec = skill?.config_json?.auto_dismiss_dec !== false; // default true

  const open = await listOpenResponseReviews(200);
  summary.openCount = open.length;
  summary.reqCount = open.filter((i) => i.response === 'REQ').length;
  summary.decCount = open.filter((i) => i.response === 'DEC').length;

  const shiftIds = [...new Set(open.map((i) => i.shiftId))];
  for (const shiftId of shiftIds) {
    await refreshResponseLogReviewRequired(shiftId);
    summary.flagsRefreshed += 1;
  }

  for (const item of open) {
    try {
      if (item.response === 'DEC' && autoDismissDec) {
        await dismissResponseReview(item.responseLogId, reviewedBy, 'auto dismiss DEC');
        summary.autoDismissedDec += 1;
        continue;
      }
      if (
        item.response === 'REQ' &&
        autoAccept &&
        item.workerId != null &&
        item.vacantSlots > 0 &&
        !item.alreadyOnShift
      ) {
        await acceptResponseRequest(item.responseLogId, reviewedBy);
        summary.autoAccepted += 1;
      }
    } catch (err) {
      summary.errors.push(
        `#${item.responseLogId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await writeAudit({
    agentType: 'system',
    action: 'response_review_cycle',
    notes: JSON.stringify(summary),
  });

  return summary;
}
