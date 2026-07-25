import {
  processPendingResponses,
  sendConfirmations,
} from '../services/confirmations';
import { writeAudit } from '../services/audit';

export type ConfirmCycleSummary = {
  startedAt: string;
  finishedAt: string;
  sent: number;
  confirmed: number;
  declined: number;
  escalated: number;
  errors: string[];
};

let running = false;
let lastSummary: ConfirmCycleSummary | null = null;

export function getLastConfirmCycle(): ConfirmCycleSummary | null {
  return lastSummary;
}

export async function runConfirmCycle(
  trigger: 'cron' | 'manual' = 'manual',
): Promise<ConfirmCycleSummary> {
  if (running) {
    throw new Error('confirm_cycle_busy');
  }
  running = true;
  const startedAt = new Date().toISOString();
  const summary: ConfirmCycleSummary = {
    startedAt,
    finishedAt: '',
    sent: 0,
    confirmed: 0,
    declined: 0,
    escalated: 0,
    errors: [],
  };

  try {
    const send = await sendConfirmations();
    summary.sent = send.sent;
    summary.errors.push(...send.errors);

    const responses = await processPendingResponses();
    summary.confirmed = responses.confirmed;
    summary.declined = responses.declined;
    summary.escalated = responses.escalated;

    summary.finishedAt = new Date().toISOString();
    lastSummary = summary;

    await writeAudit({
      agentType: 'system',
      action: 'confirm_cycle',
      notes: JSON.stringify({ trigger, ...summary }),
    });

    console.log(
      `[ross] confirm cycle (${trigger}): sent=${summary.sent} confirmed=${summary.confirmed} declined=${summary.declined} escalated=${summary.escalated}`,
    );
    return summary;
  } finally {
    running = false;
  }
}
