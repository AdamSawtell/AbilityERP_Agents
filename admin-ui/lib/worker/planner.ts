import { buildPlannerBriefing, persistDailyPlan, type PlannerBriefing } from '../services/planner';

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
