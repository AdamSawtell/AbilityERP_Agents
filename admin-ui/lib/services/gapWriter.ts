import { query } from '../db/pool';
import { writeAudit } from './audit';
import type { MatchBlocker, MatchResult } from '../engine/types';
import { loadShiftContext } from '../db/queries/shifts';
import { getConfig } from './configStore';

function escalationForHours(hoursUntil: number, thresholdHours: number): 'info' | 'warning' | 'critical' {
  if (hoursUntil < thresholdHours) return 'critical';
  if (hoursUntil < 24) return 'warning';
  return 'info';
}

export async function logGapFromMatch(result: MatchResult): Promise<number | null> {
  if (result.candidates.length > 0 || !result.blocker) return null;

  const shift = await loadShiftContext(result.shiftId);
  if (!shift) return null;

  const config = await getConfig();
  const hoursUntil = (shift.startTs.getTime() - Date.now()) / 3_600_000;
  const escalation = escalationForHours(hoursUntil, config.escalation_hours_before_shift);
  const blocker: MatchBlocker = result.blocker;

  const { rows } = await query<{ id: number }>(
    `INSERT INTO adempiere.rostering_agent_gaps (
        shift_id, shift_name, shift_date, shift_time, reason,
        credential_id, credential_name, affected_workers, blocked_count,
        escalation_level, escalated_at
     ) VALUES (
        $1, $2, $3::date, $4, $5,
        $6, $7, $8::jsonb, $9,
        $10, CASE WHEN $10 = 'critical' THEN NOW() ELSE NULL END
     )
     RETURNING id`,
    [
      result.shiftId,
      shift.name,
      shift.shiftDate,
      `${shift.startTimeLabel}-${shift.endTimeLabel}`,
      blocker.reason.slice(0, 30),
      shift.credentialIds[0] ?? null,
      shift.credentialNames[0] ?? null,
      JSON.stringify([
        {
          dominantBlocker: blocker.reason,
          detail: blocker.detail,
          affectedWorkers: blocker.affectedWorkers,
          suggestedAction: blocker.suggestedAction,
          totalConsidered: result.totalConsidered,
        },
      ]),
      blocker.affectedWorkers,
      escalation,
    ],
  );

  const gapId = rows[0]?.id ?? null;
  if (gapId != null) {
    await writeAudit({
      agentType: 'emergency',
      action: 'gap_logged',
      shiftId: result.shiftId,
      notes: `${blocker.reason}: ${blocker.detail} (gap #${gapId}, ${escalation})`,
    });
  }
  return gapId;
}
