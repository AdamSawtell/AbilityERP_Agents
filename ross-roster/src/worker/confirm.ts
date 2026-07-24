import cron from 'node-cron';
import {
  processPendingResponses,
  sendConfirmations,
} from '../services/confirmations';
import { writeAudit } from '../services/audit';
import { isSkillAutoEnabled } from '../services/skills';

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
let cronTask: cron.ScheduledTask | null = null;

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

/** Hourly: send new pre-shift confirms + poll Pathways REQ/DEC + escalate. */
export function startConfirmCron(): void {
  if (cronTask) return;
  cronTask = cron.schedule('15 * * * *', () => {
    void (async () => {
      try {
        if (!(await isSkillAutoEnabled('pre_shift_confirm'))) return;
        await runConfirmCycle('cron');
      } catch (err) {
        if (err instanceof Error && err.message === 'confirm_cycle_busy') return;
        console.error('[ross] confirm cron error', err);
      }
    })();
  });
  console.log('[ross] Pre-shift confirm cron armed (hourly at :15)');
}

export function stopConfirmCron(): void {
  cronTask?.stop();
  cronTask = null;
}
