import { withClient } from '../pool';
import { nextSequenceId } from '../sequence';
import { writeAudit } from '../../services/audit';

export type AssignInput = {
  shiftId: number;
  workerId: number;
  approvedBy: string;
  notes?: string | null;
  isOverride?: boolean;
  overrideReason?: string | null;
};

export type AssignResult = {
  success: true;
  assignmentId: number;
  shiftId: number;
  workerId: number;
  pathwaysMessageSent: false;
  auditLogId: number;
  timestamp: string;
  filledExistingLine: boolean;
};

/**
 * Phase 1b: write shiftstaff + audit. Pathways notify is Phase 1d.
 * Prefers filling a vacant staff line (SAW011 Find & Fill pattern).
 */
export async function assignWorker(input: AssignInput): Promise<AssignResult> {
  return withClient(async (client) => {
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

      const userRes = await client.query<{ ad_user_id: number }>(
        `SELECT ad_user_id
         FROM adempiere.ad_user
         WHERE c_bpartner_id = $1 AND isactive = 'Y'
         ORDER BY ad_user_id
         LIMIT 1`,
        [input.workerId],
      );
      const adUserId = userRes.rows[0]?.ad_user_id ?? null;

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
              gen_random_uuid()::varchar, $4, $5, $6, $7, 'N', 'N',
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

      const notes = [
        input.notes,
        input.isOverride ? `OVERRIDE: ${input.overrideReason ?? 'no reason'}` : null,
        filledExistingLine ? 'filled vacant staff line' : 'inserted staff line',
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

      return {
        success: true,
        assignmentId,
        shiftId: input.shiftId,
        workerId: input.workerId,
        pathwaysMessageSent: false,
        auditLogId,
        timestamp: new Date().toISOString(),
        filledExistingLine,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
