import cron from 'node-cron';
import { runLeaveReplacementCycle, type LeaveCycleSummary } from '../services/leaveReplacer';
import { isSkillAutoEnabled } from '../services/skills';

let running = false;
let lastSummary: LeaveCycleSummary | null = null;
let cronTask: cron.ScheduledTask | null = null;

export function getLastLeaveCycle(): LeaveCycleSummary | null {
  return lastSummary;
}

export async function runLeaveCycle(
  trigger: 'cron' | 'manual' = 'manual',
): Promise<LeaveCycleSummary> {
  if (running) throw new Error('leave_cycle_busy');
  running = true;
  try {
    const summary = await runLeaveReplacementCycle(trigger);
    lastSummary = summary;
    return summary;
  } finally {
    running = false;
  }
}

/** Every 15 minutes when leave_replacer skill is On. */
export function startLeaveCron(): void {
  if (cronTask) return;
  cronTask = cron.schedule('5,20,35,50 * * * *', () => {
    void (async () => {
      try {
        if (!(await isSkillAutoEnabled('leave_replacer'))) return;
        await runLeaveCycle('cron');
      } catch (err) {
        if (err instanceof Error && err.message === 'leave_cycle_busy') return;
        console.error('[ross] leave cron error', err);
      }
    })();
  });
  console.log('[ross] Leave Replacer cron armed (every 15m at :05/:20/:35/:50)');
}

export function stopLeaveCron(): void {
  cronTask?.stop();
  cronTask = null;
}
