import { detectAndProposeSwaps, scanSwapIntents } from '../services/swaps';
import { writeAudit } from '../services/audit';

export type SwapCycleSummary = {
  startedAt: string;
  finishedAt: string;
  intentsSeen: number;
  proposed: number;
  considered: number;
  errors: string[];
};

let running = false;
let lastSummary: SwapCycleSummary | null = null;

export function getLastSwapCycle(): SwapCycleSummary | null {
  return lastSummary;
}

export async function runSwapCycle(
  trigger: 'cron' | 'manual' = 'manual',
): Promise<SwapCycleSummary> {
  if (running) throw new Error('swap_cycle_busy');
  running = true;
  const startedAt = new Date().toISOString();
  const summary: SwapCycleSummary = {
    startedAt,
    finishedAt: '',
    intentsSeen: 0,
    proposed: 0,
    considered: 0,
    errors: [],
  };

  try {
    summary.intentsSeen = await scanSwapIntents();
    const result = await detectAndProposeSwaps(5);
    summary.proposed = result.proposed;
    summary.considered = result.considered;
    summary.errors = result.errors;
    summary.finishedAt = new Date().toISOString();
    lastSummary = summary;

    await writeAudit({
      agentType: 'system',
      action: 'swap_proposed',
      notes: JSON.stringify({ trigger, ...summary }),
    });

    console.log(
      `[ross] swap cycle (${trigger}): proposed=${summary.proposed} considered=${summary.considered} intents=${summary.intentsSeen}`,
    );
    return summary;
  } finally {
    running = false;
  }
}
