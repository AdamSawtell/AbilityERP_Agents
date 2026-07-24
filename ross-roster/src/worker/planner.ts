import cron from 'node-cron';
import { buildPlannerBriefing, persistDailyPlan, type PlannerBriefing } from '../services/planner';
import { isSkillAutoEnabled } from '../services/skills';

export type PlannerCycleSummary = {
  startedAt: string;
  finishedAt: string;
  fillRate: number;
  vacantSlots: number;
  auditLogId: number | null;
  errors: string[];
};

let running = false;
let lastSummary: PlannerCycleSummary | null = null;
let lastBriefing: PlannerBriefing | null = null;
let cronTask: cron.ScheduledTask | null = null;

export function getLastPlannerCycle(): PlannerCycleSummary | null {
  return lastSummary;
}

export function getLastBriefing(): PlannerBriefing | null {
  return lastBriefing;
}

export async function runPlannerCycle(
  trigger: 'cron' | 'manual' = 'manual',
): Promise<{ summary: PlannerCycleSummary; briefing: PlannerBriefing }> {
  if (running) throw new Error('planner_cycle_busy');
  running = true;
  const startedAt = new Date().toISOString();
  const summary: PlannerCycleSummary = {
    startedAt,
    finishedAt: '',
    fillRate: 0,
    vacantSlots: 0,
    auditLogId: null,
    errors: [],
  };

  try {
    const briefing = await buildPlannerBriefing();
    lastBriefing = briefing;
    summary.fillRate = briefing.fillRate.thisPeriod;
    summary.vacantSlots = briefing.fillRate.vacantSlots;

    try {
      summary.auditLogId = await persistDailyPlan(briefing);
    } catch (err) {
      summary.errors.push(err instanceof Error ? err.message : String(err));
    }

    summary.finishedAt = new Date().toISOString();
    lastSummary = summary;
    console.log(
      `[ross] planner cycle (${trigger}): fill=${summary.fillRate}% vacant=${summary.vacantSlots}`,
    );
    return { summary, briefing };
  } finally {
    running = false;
  }
}

/** Daily 4:00 Australia/Adelaide (cron in server local; EC2 UTC → 18:30 UTC prior day ≈ 04:00 ACST). */
export function startPlannerCron(): void {
  if (cronTask) return;
  // 18:30 UTC ≈ 04:00 ACST / 05:00 ACDT — good enough for staging without tz lib
  cronTask = cron.schedule('30 18 * * *', () => {
    void (async () => {
      try {
        if (!(await isSkillAutoEnabled('planner_briefing'))) return;
        await runPlannerCycle('cron');
      } catch (err) {
        if (err instanceof Error && err.message === 'planner_cycle_busy') return;
        console.error('[ross] planner cron error', err);
      }
    })();
  });
  console.log('[ross] Planner briefing cron armed (daily ~04:00 Adelaide / 18:30 UTC)');
}

export function stopPlannerCron(): void {
  cronTask?.stop();
  cronTask = null;
}
