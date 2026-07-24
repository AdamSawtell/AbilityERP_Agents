import { withClient } from '../pool';
import { nextSequenceId } from '../sequence';
import {
  buildAssignmentMessage,
  sendPathwaysMessage,
} from '../../pathways';
import { writeAudit } from '../../services/audit';
import { loadShiftContext } from './shifts';

export type AssignInput = {
  shiftId: number;
  workerId: number;
  approvedBy: string;
  notes?: string | null;
  isOverride?: boolean;
  overrideReason?: string | null;
  notifyWorker?: boolean;
};

export type AssignResult = {
  success: true;
  assignmentId: number;
  shiftId: number;
  workerId: number;
  pathwaysMessageSent: boolean;
  pathwaysRequestId: number | null;
  auditLogId: number;
  timestamp: string;
  filledExistingLine: boolean;
};

/**
 * Write shiftstaff + audit, then optionally Pathways-notify the worker (Phase 1d).
 * Prefers filling a vacant staff line (SAW011 Find & Fill pattern).
 */
export async function assignWorker(input: AssignInput): Promise<AssignResult> {
  const assignCore = await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const shiftRes = await client.query<{
        ad_client_id: number;
        ad_org_id: number;
      }>(
        `SELECT ad_client_id, ad_org_id
         FROM adempiere.aberp_rostered_shift
         WHERE aberp_rostered_shift_id = $1 AND isactive = 'Y'`,
        [input.shiftId],
      );
      if (shiftRes.rows.length === 0) {
        throw new Error('shift_not_found');
      }
      const { ad_client_id, ad_org_id } = shiftRes.rows[0];

      const userRes = await client.query<{ ad_user_id: number; name: string }>(
        `SELECT au.ad_user_id, bp.name
         FROM adempiere.ad_user au
         JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = au.c_bpartner_id
         WHERE au.c_bpartner_id = $1 AND au.isactive = 'Y'
         ORDER BY au.ad_user_id
         LIMIT 1`,
        [input.workerId],
      );
      const adUserId = userRes.rows[0] ? Number(userRes.rows[0].ad_user_id) : null;
      const workerName = userRes.rows[0]?.name ?? `Worker ${input.workerId}`;

      const vacant = await client.query<{ id: number }>(
        `SELECT aberp_rostered_shiftstaff_id AS id
         FROM adempiere.aberp_rostered_shiftstaff
         WHERE aberp_rostered_shift_id = $1
           AND isactive = 'Y'
           AND c_bpartner_staff_id IS NULL
           AND aberp_user_contact_id IS NULL
         ORDER BY line NULLS LAST, aberp_rostered_shiftstaff_id
         LIMIT 1
         FOR UPDATE`,
        [input.shiftId],
      );

      let assignmentId: number;
      let filledExistingLine = false;

      if (vacant.rows[0]) {
        assignmentId = Number(vacant.rows[0].id);
        filledExistingLine = true;
        await client.query(
          `UPDATE adempiere.aberp_rostered_shiftstaff
           SET c_bpartner_staff_id = $2,
               aberp_user_contact_id = $3,
               aberp_requestshift = 'N',
               aberp_declineshift = 'N',
               updated = NOW(),
               updatedby = 100
           WHERE aberp_rostered_shiftstaff_id = $1`,
          [assignmentId, input.workerId, adUserId],
        );
      } else {
        assignmentId = await nextSequenceId(
          client,
          'AbERP_Rostered_ShiftStaff',
          'adempiere.aberp_rostered_shiftstaff',
          'aberp_rostered_shiftstaff_id',
        );

        const lineRes = await client.query<{ line: number }>(
          `SELECT COALESCE(MAX(line), 0) + 10 AS line
           FROM adempiere.aberp_rostered_shiftstaff
           WHERE aberp_rostered_shift_id = $1`,
          [input.shiftId],
        );
        const line = Number(lineRes.rows[0]?.line ?? 10);

        await client.query(
          `INSERT INTO adempiere.aberp_rostered_shiftstaff (
              aberp_rostered_shiftstaff_id,
              ad_client_id,
              ad_org_id,
              isactive,
              created,
              createdby,
              updated,
              updatedby,
              aberp_rostered_shiftstaff_uu,
              aberp_rostered_shift_id,
              c_bpartner_staff_id,
              aberp_user_contact_id,
              line,
              aberp_requestshift,
              aberp_declineshift,
              aberp_units,
              aberp_listprice,
              aberp_estimatedcost,
              aberp_clockin,
              aberp_clockout
           ) VALUES (
              $1, $2, $3, 'Y', NOW(), 100, NOW(), 100,
              uuid_generate_v4()::varchar, $4, $5, $6, $7, 'N', 'N',
              0, 0, 0, 'N', 'N'
           )`,
          [
            assignmentId,
            ad_client_id,
            ad_org_id,
            input.shiftId,
            input.workerId,
            adUserId,
            line,
          ],
        );
      }

      await client.query('COMMIT');

      return {
        assignmentId,
        filledExistingLine,
        adClientId: Number(ad_client_id),
        adUserId,
        workerName,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  const notes = [
    input.notes,
    input.isOverride ? `OVERRIDE: ${input.overrideReason ?? 'no reason'}` : null,
    assignCore.filledExistingLine ? 'filled vacant staff line' : 'inserted staff line',
  ]
    .filter(Boolean)
    .join(' | ');

  const auditLogId = await writeAudit({
    agentType: 'system',
    action: 'shift_assigned',
    shiftId: input.shiftId,
    workerId: input.workerId,
    approvedBy: input.approvedBy,
    notes: notes || null,
  });

  let pathwaysMessageSent = false;
  let pathwaysRequestId: number | null = null;

  const shouldNotify = input.notifyWorker !== false;
  if (shouldNotify && assignCore.adUserId != null) {
    try {
      const ctx = await loadShiftContext(input.shiftId);
      const message = await buildAssignmentMessage({
        workerName: assignCore.workerName,
        shiftName: ctx?.name ?? `Shift ${input.shiftId}`,
        startTs: ctx?.startTs ?? new Date(),
        endTs: ctx?.endTs ?? new Date(),
        locationName: ctx?.locationName ?? null,
      });

      const pathways = await sendPathwaysMessage({
        workerAdUserId: assignCore.adUserId,
        workerBPartnerId: input.workerId,
        shiftId: input.shiftId,
        message,
        adClientId: assignCore.adClientId,
      });
      pathwaysMessageSent = pathways.sent;
      pathwaysRequestId = pathways.requestId;
    } catch (err) {
      console.error('[ross] Pathways notify failed after assign', err);
      await writeAudit({
        agentType: 'system',
        action: 'message_sent',
        shiftId: input.shiftId,
        workerId: input.workerId,
        notes: `Pathways notify FAILED after assign #${assignCore.assignmentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  return {
    success: true,
    assignmentId: assignCore.assignmentId,
    shiftId: input.shiftId,
    workerId: input.workerId,
    pathwaysMessageSent,
    pathwaysRequestId,
    auditLogId,
    timestamp: new Date().toISOString(),
    filledExistingLine: assignCore.filledExistingLine,
  };
}
