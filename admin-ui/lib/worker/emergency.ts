import { assignWorker } from '../db/queries/assign';
import { listVacantShifts, loadShiftContext } from '../db/queries/shifts';
import { matchShift } from '../engine/matcher';
import { writeAudit } from '../services/audit';
import { getConfig } from '../services/configStore';
import { logGapFromMatch } from '../services/gapWriter';
import { expireStaleProposals, upsertProposalsForShift } from '../services/proposals';
import {
  runResponseReviewCycle,
  type ResponseReviewCycleSummary,
} from '../services/responseReviews';
import { isSkillAutoEnabled, isSkillChainEnabled } from '../services/skills';

export type ScanSummary = {
  startedAt: string;
  finishedAt: string;
  vacantCount: number;
  proposedShifts: number;
  proposalsWritten: number;
  autoAssigned: number;
  gapsLogged: number;
  expiredProposals: number;
  autoAssignEnabled: boolean;
  responseReview: ResponseReviewCycleSummary | null;
  errors: { shiftId: number; message: string }[];
};

let running = false;
let lastSummary: ScanSummary | null = null;

export function getLastEmergencyScan(): ScanSummary | null {
  return lastSummary;
}

export async function runEmergencyScan(trigger: 'cron' | 'manual' = 'manual'): Promise<ScanSummary> {
  if (running) {
    throw new Error('scan_already_running');
  }
  running = true;

  const startedAt = new Date();
  const summary: ScanSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: '',
    vacantCount: 0,
    proposedShifts: 0,
    proposalsWritten: 0,
    autoAssigned: 0,
    gapsLogged: 0,
    expiredProposals: 0,
    autoAssignEnabled: false,
    responseReview: null,
    errors: [],
  };

  try {
    const config = await getConfig();
    summary.autoAssignEnabled = config.auto_assign_enabled;
    summary.expiredProposals = await expireStaleProposals(2);

    // SAW052 — process AbilityERP response-log queue before vacant matching
    if (await isSkillAutoEnabled('response_review')) {
      try {
        summary.responseReview = await runResponseReviewCycle('Ross scan');
      } catch (err) {
        summary.errors.push({
          shiftId: 0,
          message: `response_review: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    const matchingOn = await isSkillChainEnabled('worker_matching');
    const gapsOn = await isSkillChainEnabled('gap_detector');
    const pathwaysOk = await isSkillChainEnabled('pathways_message');

    const start = new Date();
    const end = new Date(start.getTime() + 48 * 3_600_000);
    const vacant = await listVacantShifts({ start, end, limit: 100 });
    summary.vacantCount = vacant.length;

    if (!matchingOn) {
      summary.finishedAt = new Date().toISOString();
      lastSummary = summary;
      await writeAudit({
        agentType: 'emergency',
        action: 'scan_run',
        notes: JSON.stringify({
          trigger,
          vacantCount: summary.vacantCount,
          skipped: 'worker_matching_off_or_paused',
          expiredProposals: summary.expiredProposals,
        }),
      });
      console.log(
        `[ross] emergency scan (${trigger}): vacant=${summary.vacantCount} — worker_matching not auto-enabled`,
      );
      return summary;
    }

    for (const row of vacant) {
      const shiftId = Number(row.id);
      try {
        const match = await matchShift(shiftId);
        if (match.candidates.length === 0) {
          if (gapsOn) {
            const gapId = await logGapFromMatch(match);
            if (gapId != null) summary.gapsLogged += 1;
          }
          continue;
        }

        const best = match.candidates[0];
        const blocked = config.employee_no_auto_approve.includes(best.workerId);
        const canAuto =
          config.auto_assign_enabled &&
          best.score >= config.auto_approve_threshold &&
          !blocked;

        if (canAuto) {
          const assignResult = await assignWorker({
            shiftId,
            workerId: best.workerId,
            approvedBy: 'Ross Auto-pilot',
            notes: `Auto-assigned (score ${best.score} ≥ ${config.auto_approve_threshold})`,
            notifyWorker: pathwaysOk,
          });
          await writeAudit({
            agentType: 'emergency',
            action: 'match_auto_assigned',
            shiftId,
            workerId: best.workerId,
            score: best.score,
            approvedBy: 'Ross Auto-pilot',
            rulesPassed: {
              hard: best.hardRules,
              soft: best.softRules,
              isAutoApproved: true,
            },
            notes: `assignment ${assignResult.assignmentId}; Pathways=${assignResult.pathwaysMessageSent}`,
          });
          summary.autoAssigned += 1;
          continue;
        }

        const ctx = await loadShiftContext(shiftId);
        const written = await upsertProposalsForShift({
          shiftId,
          shiftName: ctx?.name ?? row.name,
          candidates: match.candidates,
        });
        summary.proposalsWritten += written;
        summary.proposedShifts += 1;

        await writeAudit({
          agentType: 'emergency',
          action: 'match_proposed',
          shiftId,
          workerId: best.workerId,
          score: best.score,
          rulesPassed: match.candidates.map((c) => ({
            workerId: c.workerId,
            score: c.score,
            isAutoApproved: c.isAutoApproved,
          })),
          notes: config.auto_assign_enabled
            ? `${match.candidates.length} candidate(s); best ${best.score} below threshold ${config.auto_approve_threshold}${blocked ? ' or blocked for auto' : ''}`
            : `${match.candidates.length} candidate(s); auto-assign off — human review`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ shiftId, message });
        console.error(`[ross] emergency scan failed for shift ${shiftId}`, err);
      }
    }

    summary.finishedAt = new Date().toISOString();
    lastSummary = summary;

    await writeAudit({
      agentType: 'emergency',
      action: 'scan_run',
      notes: JSON.stringify({
        trigger,
        vacantCount: summary.vacantCount,
        proposedShifts: summary.proposedShifts,
        proposalsWritten: summary.proposalsWritten,
        autoAssigned: summary.autoAssigned,
        gapsLogged: summary.gapsLogged,
        expiredProposals: summary.expiredProposals,
        errorCount: summary.errors.length,
        scanIntervalMinutes: config.scan_interval_minutes,
        autoAssignEnabled: config.auto_assign_enabled,
        autoApproveThreshold: config.auto_approve_threshold,
        responseReview: summary.responseReview,
      }),
    });

    console.log(
      `[ross] emergency scan (${trigger}): vacant=${summary.vacantCount} auto=${summary.autoAssigned} proposals=${summary.proposalsWritten} gaps=${summary.gapsLogged} responses=${summary.responseReview?.openCount ?? 0}`,
    );
    return summary;
  } finally {
    running = false;
  }
}
