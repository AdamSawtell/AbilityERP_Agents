import cron from 'node-cron';
import { listVacantShifts, loadShiftContext } from '../db/queries/shifts';
import { matchShift } from '../engine/matcher';
import { writeAudit } from '../services/audit';
import { getConfig } from '../services/configStore';
import { logGapFromMatch } from '../services/gapWriter';
import { expireStaleProposals, upsertProposalsForShift } from '../services/proposals';

export type ScanSummary = {
  startedAt: string;
  finishedAt: string;
  vacantCount: number;
  proposedShifts: number;
  proposalsWritten: number;
  gapsLogged: number;
  expiredProposals: number;
  errors: { shiftId: number; message: string }[];
};

let running = false;
let lastSummary: ScanSummary | null = null;
let cronTask: cron.ScheduledTask | null = null;

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
    gapsLogged: 0,
    expiredProposals: 0,
    errors: [],
  };

  try {
    const config = await getConfig();
    summary.expiredProposals = await expireStaleProposals(2);

    const start = new Date();
    const end = new Date(start.getTime() + 48 * 3_600_000);
    const vacant = await listVacantShifts({ start, end, limit: 100 });
    summary.vacantCount = vacant.length;

    for (const row of vacant) {
      const shiftId = Number(row.id);
      try {
        const match = await matchShift(shiftId);
        if (match.candidates.length === 0) {
          const gapId = await logGapFromMatch(match);
          if (gapId != null) summary.gapsLogged += 1;
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
          workerId: match.candidates[0]?.workerId,
          score: match.candidates[0]?.score,
          rulesPassed: match.candidates.map((c) => ({
            workerId: c.workerId,
            score: c.score,
            isAutoApproved: c.isAutoApproved,
          })),
          notes: `${match.candidates.length} candidate(s); auto-assign disabled in Phase 1`,
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
        gapsLogged: summary.gapsLogged,
        expiredProposals: summary.expiredProposals,
        errorCount: summary.errors.length,
        scanIntervalMinutes: config.scan_interval_minutes,
      }),
    });

    console.log(
      `[ross] emergency scan (${trigger}): vacant=${summary.vacantCount} proposals=${summary.proposalsWritten} gaps=${summary.gapsLogged}`,
    );
    return summary;
  } finally {
    running = false;
  }
}

export function startEmergencyCron(): void {
  // Check every minute; honour scan_interval_minutes from config via last-run gating
  if (cronTask) return;

  cronTask = cron.schedule('* * * * *', () => {
    void (async () => {
      try {
        const config = await getConfig();
        const intervalMs = Math.max(1, config.scan_interval_minutes) * 60_000;
        if (lastSummary) {
          const elapsed = Date.now() - Date.parse(lastSummary.finishedAt || lastSummary.startedAt);
          if (elapsed < intervalMs) return;
        }
        await runEmergencyScan('cron');
      } catch (err) {
        if (err instanceof Error && err.message === 'scan_already_running') return;
        console.error('[ross] emergency cron error', err);
      }
    })();
  });

  console.log('[ross] Emergency Rosterer cron armed (checks every minute; interval from config)');
}

export function stopEmergencyCron(): void {
  cronTask?.stop();
  cronTask = null;
}
