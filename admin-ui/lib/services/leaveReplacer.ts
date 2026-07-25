import { assignWorker } from '../db/queries/assign';
import { loadShiftContext } from '../db/queries/shifts';
import { matchShift } from '../engine/matcher';
import { query } from '../db/pool';
import {
  notifyRosterOfficer,
  resolveWorkerUserId,
  sendPathwaysMessage,
} from '../pathways';
import { writeAudit } from './audit';
import { getConfig } from './configStore';
import { vacateStaffLine } from './confirmations';
import { logGapFromMatch } from './gapWriter';
import { upsertProposalsForShift } from './proposals';
import { isSkillChainEnabled } from './skills';

export type LeaveOverlap = {
  leave_id: number;
  leave_start: Date;
  leave_end: Date;
  worker_id: number;
  worker_name: string;
  ad_user_id: number | null;
  ad_client_id: number;
  staff_line_id: number;
  shift_id: number;
  shift_name: string;
  shift_start: Date;
  shift_end: Date;
  location_name: string | null;
};

export type LeaveReplacementRow = {
  id: number;
  leave_id: number;
  shift_id: number;
  staff_line_id: number | null;
  original_worker_id: number | null;
  original_worker_name: string | null;
  replacement_worker_id: number | null;
  replacement_worker_name: string | null;
  score: number | null;
  status: string;
  notes: string | null;
  processed_at: Date;
};

export type LeaveCycleSummary = {
  startedAt: string;
  finishedAt: string;
  leavesScanned: number;
  overlapsFound: number;
  vacated: number;
  assigned: number;
  proposed: number;
  failed: number;
  skipped: number;
  errors: string[];
};

export async function listPendingOverlaps(limit = 50): Promise<LeaveOverlap[]> {
  const { rows } = await query<{
    leave_id: number;
    leave_start: Date;
    leave_end: Date;
    worker_id: number;
    worker_name: string;
    ad_user_id: number | null;
    ad_client_id: number;
    staff_line_id: number;
    shift_id: number;
    shift_name: string;
    shift_start: Date;
    shift_end: Date;
    location_name: string | null;
  }>(
    `SELECT
        ul.aberp_unavailability_leave_id AS leave_id,
        ul.startdate AS leave_start,
        ul.enddate AS leave_end,
        ul.c_bpartner_staff_id AS worker_id,
        bp.name AS worker_name,
        ul.aberp_user_contact_id AS ad_user_id,
        ul.ad_client_id,
        ss.aberp_rostered_shiftstaff_id AS staff_line_id,
        s.aberp_rostered_shift_id AS shift_id,
        s.name AS shift_name,
        COALESCE(s.starttime, s.startdate) AS shift_start,
        COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) AS shift_end,
        ml.name AS location_name
     FROM adempiere.aberp_unavailability_leave ul
     JOIN adempiere.c_bpartner bp ON bp.c_bpartner_id = ul.c_bpartner_staff_id
     JOIN adempiere.aberp_rostered_shiftstaff ss
       ON ss.isactive = 'Y'
      AND ss.c_bpartner_staff_id = ul.c_bpartner_staff_id
      AND COALESCE(ss.aberp_declineshift, 'N') <> 'Y'
     JOIN adempiere.aberp_rostered_shift s
       ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
      AND s.isactive = 'Y'
     LEFT JOIN adempiere.aberp_masterlocation ml
       ON ml.aberp_masterlocation_id = s.aberp_masterlocation_id
     WHERE ul.isactive = 'Y'
       AND ul.aberp_approverstatus = 'AP'
       AND ul.c_bpartner_staff_id IS NOT NULL
       AND ul.enddate >= NOW() - interval '1 day'
       AND COALESCE(s.starttime, s.startdate) > NOW() - interval '1 hour'
       AND COALESCE(s.starttime, s.startdate) <= ul.enddate
       AND COALESCE(s.endtime, s.enddate, s.starttime, s.startdate) >= ul.startdate
       AND NOT EXISTS (
         SELECT 1 FROM adempiere.rostering_agent_leave_replacements lr
         WHERE lr.leave_id = ul.aberp_unavailability_leave_id
           AND lr.shift_id = s.aberp_rostered_shift_id
       )
     ORDER BY COALESCE(s.starttime, s.startdate) ASC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    ...r,
    leave_id: Number(r.leave_id),
    worker_id: Number(r.worker_id),
    ad_user_id: r.ad_user_id != null ? Number(r.ad_user_id) : null,
    ad_client_id: Number(r.ad_client_id),
    staff_line_id: Number(r.staff_line_id),
    shift_id: Number(r.shift_id),
  }));
}

export async function listLeaveReplacements(
  limit = 50,
  status?: string,
): Promise<LeaveReplacementRow[]> {
  if (status) {
    const { rows } = await query<LeaveReplacementRow>(
      `SELECT id, leave_id, shift_id, staff_line_id, original_worker_id,
              original_worker_name, replacement_worker_id, replacement_worker_name,
              score, status, notes, processed_at
       FROM adempiere.rostering_agent_leave_replacements
       WHERE status = $1
       ORDER BY processed_at DESC
       LIMIT $2`,
      [status, limit],
    );
    return rows;
  }
  const { rows } = await query<LeaveReplacementRow>(
    `SELECT id, leave_id, shift_id, staff_line_id, original_worker_id,
            original_worker_name, replacement_worker_id, replacement_worker_name,
            score, status, notes, processed_at
     FROM adempiere.rostering_agent_leave_replacements
     ORDER BY processed_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

async function recordReplacement(opts: {
  leaveId: number;
  shiftId: number;
  staffLineId: number;
  originalWorkerId: number;
  originalWorkerName: string;
  replacementWorkerId?: number | null;
  replacementWorkerName?: string | null;
  score?: number | null;
  status: 'vacated' | 'proposed' | 'assigned' | 'failed';
  notes?: string;
}): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO adempiere.rostering_agent_leave_replacements (
        leave_id, shift_id, staff_line_id, original_worker_id, original_worker_name,
        replacement_worker_id, replacement_worker_name, score, status, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (leave_id, shift_id) DO UPDATE
       SET status = EXCLUDED.status,
           replacement_worker_id = EXCLUDED.replacement_worker_id,
           replacement_worker_name = EXCLUDED.replacement_worker_name,
           score = EXCLUDED.score,
           notes = EXCLUDED.notes,
           processed_at = NOW()
     RETURNING id`,
    [
      opts.leaveId,
      opts.shiftId,
      opts.staffLineId,
      opts.originalWorkerId,
      opts.originalWorkerName,
      opts.replacementWorkerId ?? null,
      opts.replacementWorkerName ?? null,
      opts.score ?? null,
      opts.status,
      opts.notes ?? null,
    ],
  );
  return Number(rows[0].id);
}

export async function runLeaveReplacementCycle(
  trigger: 'cron' | 'manual' = 'manual',
): Promise<LeaveCycleSummary> {
  const startedAt = new Date().toISOString();
  const summary: LeaveCycleSummary = {
    startedAt,
    finishedAt: '',
    leavesScanned: 0,
    overlapsFound: 0,
    vacated: 0,
    assigned: 0,
    proposed: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const overlaps = await listPendingOverlaps(40);
  summary.overlapsFound = overlaps.length;
  summary.leavesScanned = new Set(overlaps.map((o) => o.leave_id)).size;

  if (overlaps.length === 0) {
    summary.finishedAt = new Date().toISOString();
    await writeAudit({
      agentType: 'system',
      action: 'leave_replacement',
      notes: JSON.stringify({ trigger, ...summary }),
    });
    return summary;
  }

  const config = await getConfig();
  const pathwaysOk = await isSkillChainEnabled('pathways_message');
  const matchingOn = await isSkillChainEnabled('worker_matching');
  const gapsOn = await isSkillChainEnabled('gap_detector');

  for (const o of overlaps) {
    try {
      await vacateStaffLine(o.staff_line_id);
      summary.vacated += 1;

      if (!matchingOn) {
        await recordReplacement({
          leaveId: o.leave_id,
          shiftId: o.shift_id,
          staffLineId: o.staff_line_id,
          originalWorkerId: o.worker_id,
          originalWorkerName: o.worker_name,
          status: 'vacated',
          notes: 'Vacated only — worker_matching off',
        });
        summary.skipped += 1;
        continue;
      }

      const match = await matchShift(o.shift_id);
      const best = match.candidates[0];

      if (!best) {
        if (gapsOn) {
          await logGapFromMatch(match).catch(() => null);
        }
        await recordReplacement({
          leaveId: o.leave_id,
          shiftId: o.shift_id,
          staffLineId: o.staff_line_id,
          originalWorkerId: o.worker_id,
          originalWorkerName: o.worker_name,
          status: 'failed',
          notes: 'No eligible replacement',
        });
        summary.failed += 1;

        if (pathwaysOk) {
          await notifyRosterOfficer({
            shiftId: o.shift_id,
            adClientId: o.ad_client_id,
            message:
              `⚠️ Leave replacement failed for ${o.worker_name} — ${o.shift_name}.\n` +
              `No eligible workers available. Manual intervention needed.`,
          }).catch((err) => {
            summary.errors.push(
              `officer notify ${o.shift_id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }

        await writeAudit({
          agentType: 'system',
          action: 'leave_replacement',
          shiftId: o.shift_id,
          workerId: o.worker_id,
          notes: JSON.stringify({
            leaveId: o.leave_id,
            status: 'failed',
            trigger,
          }),
        });
        continue;
      }

      const blocked = config.employee_no_auto_approve.includes(best.workerId);
      const canAuto =
        config.auto_assign_enabled &&
        best.score >= config.auto_approve_threshold &&
        !blocked;

      if (canAuto) {
        const assignResult = await assignWorker({
          shiftId: o.shift_id,
          workerId: best.workerId,
          approvedBy: 'Ross Leave Replacer',
          notes: `Leave #${o.leave_id} replacement for ${o.worker_name} (score ${best.score})`,
          notifyWorker: pathwaysOk,
        });

        await recordReplacement({
          leaveId: o.leave_id,
          shiftId: o.shift_id,
          staffLineId: o.staff_line_id,
          originalWorkerId: o.worker_id,
          originalWorkerName: o.worker_name,
          replacementWorkerId: best.workerId,
          replacementWorkerName: best.workerName,
          score: best.score,
          status: 'assigned',
          notes: `assignment ${assignResult.assignmentId}`,
        });
        summary.assigned += 1;

        if (pathwaysOk) {
          const origUserId =
            o.ad_user_id ?? (await resolveWorkerUserId(o.worker_id));
          if (origUserId != null) {
            await sendPathwaysMessage({
              workerAdUserId: origUserId,
              workerBPartnerId: o.worker_id,
              shiftId: o.shift_id,
              adClientId: o.ad_client_id,
              message:
                `Your leave has been processed.\n` +
                `${best.workerName} has been assigned to your ${o.shift_name}.\n` +
                `No action needed from you.`,
            }).catch(() => null);
          }
        }

        await writeAudit({
          agentType: 'system',
          action: 'leave_replacement',
          shiftId: o.shift_id,
          workerId: best.workerId,
          score: best.score,
          approvedBy: 'Ross Leave Replacer',
          notes: JSON.stringify({
            leaveId: o.leave_id,
            status: 'assigned',
            originalWorkerId: o.worker_id,
            trigger,
          }),
        });
      } else {
        const ctx = await loadShiftContext(o.shift_id);
        const written = await upsertProposalsForShift({
          shiftId: o.shift_id,
          shiftName: ctx?.name ?? o.shift_name,
          candidates: match.candidates,
        });

        await recordReplacement({
          leaveId: o.leave_id,
          shiftId: o.shift_id,
          staffLineId: o.staff_line_id,
          originalWorkerId: o.worker_id,
          originalWorkerName: o.worker_name,
          replacementWorkerId: best.workerId,
          replacementWorkerName: best.workerName,
          score: best.score,
          status: 'proposed',
          notes: `${written} proposal(s); best ${best.score}`,
        });
        summary.proposed += 1;

        if (pathwaysOk) {
          await notifyRosterOfficer({
            shiftId: o.shift_id,
            adClientId: o.ad_client_id,
            message:
              `📋 Leave coverage needed: ${o.worker_name} off — ${o.shift_name}.\n` +
              `Best match: ${best.workerName} (${best.score}%). Review proposals in Ross Admin.`,
          }).catch(() => null);
        }

        await writeAudit({
          agentType: 'system',
          action: 'leave_replacement',
          shiftId: o.shift_id,
          workerId: o.worker_id,
          score: best.score,
          notes: JSON.stringify({
            leaveId: o.leave_id,
            status: 'proposed',
            bestWorkerId: best.workerId,
            trigger,
          }),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`leave ${o.leave_id} shift ${o.shift_id}: ${message}`);
      console.error('[ross] leave replacement failed', o.leave_id, o.shift_id, err);
    }
  }

  summary.finishedAt = new Date().toISOString();
  await writeAudit({
    agentType: 'system',
    action: 'leave_replacement',
    notes: JSON.stringify({ trigger, cycle: true, ...summary }),
  });

  console.log(
    `[ross] leave cycle (${trigger}): overlaps=${summary.overlapsFound} vacated=${summary.vacated} assigned=${summary.assigned} proposed=${summary.proposed} failed=${summary.failed}`,
  );
  return summary;
}
