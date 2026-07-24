import type { PoolClient } from 'pg';
import { query, withClient } from './db/pool';
import { nextSequenceId } from './db/sequence';
import { writeAudit } from './services/audit';

const ROSTERING_CHAT_TYPE = 'Rostering Chat';
const ROSTERING_ROLE_ID = 1000012;
const REQUEST_STATUS_OPEN = 1000000;
const REQUEST_GROUP_ID = 1000003;
const REQUEST_CATEGORY_ID = 1000031;

export type PathwaysSendInput = {
  workerAdUserId: number;
  workerBPartnerId: number;
  shiftId: number;
  message: string;
  adClientId: number;
};

export type PathwaysSendResult = {
  sent: boolean;
  requestId: number | null;
  responseLogId: number | null;
  createdChat: boolean;
  message: string;
};

async function resolveOfficerUserId(client: PoolClient): Promise<number> {
  // Prefer a named officer; fall back to any Rostering Officer role user; else SuperUser.
  const preferred = await client.query<{ ad_user_id: number }>(
    `SELECT u.ad_user_id
     FROM adempiere.ad_user u
     JOIN adempiere.ad_user_roles ur
       ON ur.ad_user_id = u.ad_user_id AND ur.isactive = 'Y'
     WHERE ur.ad_role_id = $1
       AND u.isactive = 'Y'
       AND u.name ILIKE 'Adam%'
     ORDER BY u.ad_user_id
     LIMIT 1`,
    [ROSTERING_ROLE_ID],
  );
  if (preferred.rows[0]) return Number(preferred.rows[0].ad_user_id);

  const anyOfficer = await client.query<{ ad_user_id: number }>(
    `SELECT u.ad_user_id
     FROM adempiere.ad_user u
     JOIN adempiere.ad_user_roles ur
       ON ur.ad_user_id = u.ad_user_id AND ur.isactive = 'Y'
     WHERE ur.ad_role_id = $1 AND u.isactive = 'Y'
     ORDER BY CASE WHEN u.ad_user_id = 100 THEN 0 ELSE 1 END, u.ad_user_id
     LIMIT 1`,
    [ROSTERING_ROLE_ID],
  );
  if (anyOfficer.rows[0]) return Number(anyOfficer.rows[0].ad_user_id);
  return 100;
}

async function findOpenChat(
  client: PoolClient,
  workerAdUserId: number,
): Promise<number | null> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT r.r_request_id AS id
     FROM adempiere.r_request r
     JOIN adempiere.r_requesttype rt
       ON rt.r_requesttype_id = r.r_requesttype_id
     LEFT JOIN adempiere.r_status rs
       ON rs.r_status_id = r.r_status_id
     WHERE r.isactive = 'Y'
       AND rt.name = $1
       AND r.ad_user_id = $2
       AND COALESCE(rs.isclosed, 'N') = 'N'
     ORDER BY r.updated DESC NULLS LAST, r.r_request_id DESC
     LIMIT 1`,
    [ROSTERING_CHAT_TYPE, workerAdUserId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function createChat(
  client: PoolClient,
  opts: {
    workerAdUserId: number;
    workerBPartnerId: number;
    adClientId: number;
    officerId: number;
    message: string;
  },
): Promise<number> {
  const requestId = await nextSequenceId(client, 'R_Request', 'adempiere.r_request', 'r_request_id');
  const message = opts.message.slice(0, 2000);

  await client.query(
    `INSERT INTO adempiere.r_request (
        r_request_id, ad_client_id, ad_org_id, isactive,
        created, createdby, updated, updatedby,
        documentno, r_requesttype_id, r_group_id, r_category_id, r_status_id,
        summary, priority, duetype, nextaction, confidentialtype, confidentialtypeentry,
        isselfservice, processed,
        ad_user_id, c_bpartner_id, ad_role_id, salesrep_id,
        datelastaction, lastresult
     ) VALUES (
        $1, $2, 0, 'Y',
        NOW(), $3, NOW(), $3,
        $4,
        (SELECT r_requesttype_id FROM adempiere.r_requesttype WHERE name = $5 AND isactive = 'Y' LIMIT 1),
        $6, $7, $8,
        'Rostering Chat', '5', '7', 'F', 'A', 'A',
        'Y', 'N',
        $9, $10, 0, $3,
        NOW(), $11
     )`,
    [
      requestId,
      opts.adClientId,
      opts.officerId,
      String(requestId),
      ROSTERING_CHAT_TYPE,
      REQUEST_GROUP_ID,
      REQUEST_CATEGORY_ID,
      REQUEST_STATUS_OPEN,
      opts.workerAdUserId,
      opts.workerBPartnerId,
      message,
    ],
  );

  return requestId;
}

async function postToChat(
  client: PoolClient,
  requestId: number,
  officerId: number,
  message: string,
): Promise<void> {
  // Officer path: update lastresult → Rostering Chat trigger writes Public R_RequestUpdate
  // and queues ad_role_id = 0 (awaiting worker). Avoid bumping updated/updatedby when possible.
  await client.query(
    `UPDATE adempiere.r_request
     SET lastresult = $2,
         ad_role_id = 0,
         datelastaction = NOW(),
         salesrep_id = COALESCE(salesrep_id, $3)
     WHERE r_request_id = $1`,
    [requestId, message.slice(0, 2000), officerId],
  );
}

async function writeResponseLog(
  client: PoolClient,
  opts: {
    workerAdUserId: number;
    shiftId: number;
    adClientId: number;
    officerId: number;
  },
): Promise<number> {
  const id = await nextSequenceId(
    client,
    'AbERP_RosteredResponseLog',
    'adempiere.aberp_rosteredresponselog',
    'aberp_rosteredresponselog_id',
  );

  await client.query(
    `INSERT INTO adempiere.aberp_rosteredresponselog (
        aberp_rosteredresponselog_id, ad_client_id, ad_org_id, isactive,
        created, createdby, updated, updatedby,
        aberp_rosteredresponselog_uu,
        aberp_user_contact_id, aberp_rosteredresponse, aberp_rostered_shift_id,
        issuperseded, isreviewed, aberp_acceptshiftrequest
     ) VALUES (
        $1, $2, 0, 'Y',
        NOW(), $3, NOW(), $3,
        uuid_generate_v4()::varchar,
        $4, 'MSG', $5,
        'N', 'Y', NULL
     )`,
    [id, opts.adClientId, opts.officerId, opts.workerAdUserId, opts.shiftId],
  );

  return id;
}

/**
 * Notify a worker via Pathways = Rostering Chat (PWA Chat tab) + response-log MSG marker.
 */
export async function sendPathwaysMessage(input: PathwaysSendInput): Promise<PathwaysSendResult> {
  const message = input.message.trim();
  if (!message) {
    return {
      sent: false,
      requestId: null,
      responseLogId: null,
      createdChat: false,
      message: 'empty message',
    };
  }

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const officerId = await resolveOfficerUserId(client);
      let requestId = await findOpenChat(client, input.workerAdUserId);
      let createdChat = false;

      if (requestId == null) {
        requestId = await createChat(client, {
          workerAdUserId: input.workerAdUserId,
          workerBPartnerId: input.workerBPartnerId,
          adClientId: input.adClientId,
          officerId,
          message,
        });
        createdChat = true;
      } else {
        await postToChat(client, requestId, officerId, message);
      }

      const responseLogId = await writeResponseLog(client, {
        workerAdUserId: input.workerAdUserId,
        shiftId: input.shiftId,
        adClientId: input.adClientId,
        officerId,
      });

      await client.query('COMMIT');

      await writeAudit({
        agentType: 'system',
        action: 'message_sent',
        shiftId: input.shiftId,
        workerId: input.workerBPartnerId,
        notes: `Pathways message via request #${requestId}${createdChat ? ' (new chat)' : ''}: ${message.slice(0, 180)}`,
      });

      return {
        sent: true,
        requestId,
        responseLogId,
        createdChat,
        message,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

function fmtAu(d: Date): string {
  return d.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Australia/Adelaide',
  });
}

export async function buildAssignmentMessage(opts: {
  workerName: string;
  shiftName: string;
  startTs: Date;
  endTs: Date;
  locationName: string | null;
}): Promise<string> {
  const firstName = opts.workerName.split(' ')[0] || opts.workerName;
  const loc = opts.locationName ? `\n📍 ${opts.locationName}` : '';

  return (
    `${firstName}, you've been rostered for ${opts.shiftName}\n` +
    `${fmtAu(opts.startTs)} — ${fmtAu(opts.endTs)}${loc}\n\n` +
    `Reply here if you can't make it.`
  );
}

/** Pre-shift check-in (Phase 3b). Workers reply via Pathways; Ross polls REQ/DEC. */
export async function buildConfirmReminderMessage(opts: {
  workerName: string;
  shiftName: string;
  startTs: Date;
  endTs: Date;
  locationName: string | null;
}): Promise<string> {
  const firstName = opts.workerName.split(' ')[0] || opts.workerName;
  const loc = opts.locationName ? `\n📍 ${opts.locationName}` : '';

  return (
    `Reminder: ${opts.shiftName}\n` +
    `${fmtAu(opts.startTs)} — ${fmtAu(opts.endTs)}${loc}\n\n` +
    `Hi ${firstName} — please confirm you can make this shift.\n` +
    `Accept the shift request in the app (REQ) or decline (DEC) if you can't.`
  );
}

/** Phase 3c — propose a two-shift exchange to one party. */
export async function buildSwapProposeMessage(opts: {
  toName: string;
  otherName: string;
  giveShiftName: string;
  giveStart: Date;
  takeShiftName: string;
  takeStart: Date;
  perspective: 'requester' | 'partner';
}): Promise<string> {
  const first = opts.toName.split(' ')[0] || opts.toName;
  const otherFirst = opts.otherName.split(' ')[0] || opts.otherName;
  const lead =
    opts.perspective === 'requester'
      ? `${otherFirst} can take your ${opts.giveShiftName} (${fmtAu(opts.giveStart)})`
      : `${otherFirst} wants to swap — you'd take ${opts.takeShiftName} (${fmtAu(opts.takeStart)})`;

  return (
    `Hi ${first} — swap proposal\n` +
    `${lead}\n` +
    `and you'd take ${opts.takeShiftName} (${fmtAu(opts.takeStart)}).\n\n` +
    `Ask your Rostering Officer to approve, or reply in chat if you can't.`
  );
}

/** Resolve worker AD_User for a C_BPartner staff id. */
export async function resolveWorkerUserId(workerBPartnerId: number): Promise<number | null> {
  const { rows } = await query<{ ad_user_id: number }>(
    `SELECT ad_user_id
     FROM adempiere.ad_user
     WHERE c_bpartner_id = $1 AND isactive = 'Y'
     ORDER BY ad_user_id
     LIMIT 1`,
    [workerBPartnerId],
  );
  return rows[0] ? Number(rows[0].ad_user_id) : null;
}
