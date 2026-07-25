import { runLeaveReplacementCycle, type LeaveCycleSummary } from '../services/leaveReplacer';

let running = false;
let lastSummary: LeaveCycleSummary | null = null;

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
