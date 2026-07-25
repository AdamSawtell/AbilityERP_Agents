import type OpenAI from 'openai';
import { listVacantShifts, mapVacantShift } from '../db/queries/shifts';
import { assignWorker } from '../db/queries/assign';
import { listGaps } from '../services/gaps';
import { buildNextPeriodForecast } from '../services/forecast';
import { runLeaveReplacementCycle } from '../services/leaveReplacer';
import { getConfig } from '../services/configStore';
import {
  expireSiblingProposals,
  getProposal,
  listBulkApproveTargets,
  listPendingProposals,
  markProposalStatus,
} from '../services/proposals';
import { writeAudit } from '../services/audit';
import { getLastEmergencyScan, runEmergencyScan } from '../worker/emergency';
import { listSkills } from '../services/skills';

export const AGENT_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_status',
      description: 'Ross health, config, last emergency scan summary',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_scan',
      description: 'Run the Emergency Rosterer scan now (match vacant shifts, write proposals)',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_vacant',
      description: 'List vacant shifts in a time horizon',
      parameters: {
        type: 'object',
        properties: {
          horizon: {
            type: 'string',
            enum: ['today', 'period', 'next'],
            description: 'today = next 24h, period = 14d from now, next = following 14d',
          },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_gaps',
      description: 'List unresolved training/coverage gaps',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_proposals',
      description: 'List pending match proposals awaiting officer approval',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'approve_proposal',
      description: 'Approve a pending proposal and assign the worker',
      parameters: {
        type: 'object',
        properties: {
          proposalId: { type: 'number' },
        },
        required: ['proposalId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reject_proposal',
      description: 'Reject a pending proposal',
      parameters: {
        type: 'object',
        properties: {
          proposalId: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['proposalId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_approve',
      description: 'Bulk-approve top pending proposal per shift at/above auto-approve threshold',
      parameters: {
        type: 'object',
        properties: {
          minScore: { type: 'number', description: 'Override threshold; default from config' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_forecast',
      description: 'Next-period coverage forecast vs this period',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_leave_cycle',
      description: 'Process approved leave overlaps: vacate and propose/assign replacements',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List Ross skills and on/paused/off status',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

type Horizon = 'today' | 'period' | 'next';

function horizonWindow(horizon: Horizon): { start: Date; end: Date } {
  const start = new Date();
  if (horizon === 'today') {
    return { start, end: new Date(start.getTime() + 24 * 3_600_000) };
  }
  if (horizon === 'period') {
    return { start, end: new Date(start.getTime() + 14 * 24 * 3_600_000) };
  }
  const periodEnd = new Date(start.getTime() + 14 * 24 * 3_600_000);
  return {
    start: periodEnd,
    end: new Date(periodEnd.getTime() + 14 * 24 * 3_600_000),
  };
}

export type ToolCallRecord = {
  name: string;
  args: unknown;
  ok: boolean;
  result: unknown;
};

export async function executeAgentTool(
  name: string,
  rawArgs: string,
  officerName: string,
): Promise<ToolCallRecord> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return { name, args: rawArgs, ok: false, result: { error: 'invalid_json_args' } };
  }

  try {
    switch (name) {
      case 'get_status': {
        const config = await getConfig();
        const last = getLastEmergencyScan();
        return {
          name,
          args,
          ok: true,
          result: {
            service: 'ross-roster',
            config: {
              auto_approve_threshold: config.auto_approve_threshold,
              scan_interval_minutes: config.scan_interval_minutes,
              auto_assign_enabled: config.auto_assign_enabled,
            },
            lastEmergencyScan: last,
          },
        };
      }
      case 'run_scan': {
        const summary = await runEmergencyScan('manual');
        return { name, args, ok: true, result: summary };
      }
      case 'list_vacant': {
        const horizon = (String(args.horizon || 'today') as Horizon) || 'today';
        const limit = Math.min(30, Math.max(1, Number(args.limit) || 15));
        const { start, end } = horizonWindow(
          ['today', 'period', 'next'].includes(horizon) ? horizon : 'today',
        );
        const rows = await listVacantShifts({ start, end, limit });
        return {
          name,
          args,
          ok: true,
          result: {
            horizon,
            count: rows.length,
            shifts: rows.map(mapVacantShift),
          },
        };
      }
      case 'list_gaps': {
        const limit = Math.min(40, Math.max(1, Number(args.limit) || 20));
        const gaps = await listGaps(false, limit, 0);
        return {
          name,
          args,
          ok: true,
          result: {
            count: gaps.length,
            gaps: gaps.map((g) => ({
              id: g.id,
              shiftName: g.shift_name,
              reason: g.reason,
              credentialName: g.credential_name,
              escalation: g.escalation_level,
              blocked: g.blocked_count,
            })),
          },
        };
      }
      case 'list_proposals': {
        const limit = Math.min(40, Math.max(1, Number(args.limit) || 20));
        const payload = await listPendingProposals(limit, 0);
        return { name, args, ok: true, result: payload };
      }
      case 'approve_proposal': {
        const proposalId = Number(args.proposalId);
        const proposal = await getProposal(proposalId);
        if (!proposal || proposal.status !== 'pending') {
          return { name, args, ok: false, result: { error: 'not_pending' } };
        }
        const marked = await markProposalStatus({
          id: proposalId,
          status: 'approved',
          reviewedBy: officerName,
          notes: 'Approved via Ross AI chat',
        });
        if (!marked) {
          return { name, args, ok: false, result: { error: 'not_pending' } };
        }
        const assignResult = await assignWorker({
          shiftId: Number(proposal.shift_id),
          workerId: Number(proposal.worker_id),
          approvedBy: officerName,
          notes: `AI chat approved proposal #${proposalId}`,
          notifyWorker: true,
        });
        await writeAudit({
          agentType: 'emergency',
          action: 'match_approved',
          shiftId: Number(proposal.shift_id),
          workerId: Number(proposal.worker_id),
          score: Number(proposal.score),
          approvedBy: officerName,
          notes: `AI chat proposal #${proposalId}`,
        });
        await expireSiblingProposals(Number(proposal.shift_id), proposalId);
        return {
          name,
          args,
          ok: true,
          result: {
            proposalId,
            assignmentId: assignResult.assignmentId,
            pathwaysMessageSent: assignResult.pathwaysMessageSent,
            workerName: proposal.worker_name,
            shiftName: proposal.shift_name,
          },
        };
      }
      case 'reject_proposal': {
        const proposalId = Number(args.proposalId);
        const reason = String(args.reason || 'Rejected via Ross AI chat');
        const marked = await markProposalStatus({
          id: proposalId,
          status: 'rejected',
          reviewedBy: officerName,
          notes: reason,
        });
        if (!marked) {
          return { name, args, ok: false, result: { error: 'not_pending' } };
        }
        await writeAudit({
          agentType: 'emergency',
          action: 'match_rejected',
          approvedBy: officerName,
          notes: `AI chat proposal #${proposalId}: ${reason}`,
        });
        return { name, args, ok: true, result: { proposalId, rejected: true } };
      }
      case 'bulk_approve': {
        const config = await getConfig();
        const minScore = Number.isFinite(Number(args.minScore))
          ? Number(args.minScore)
          : config.auto_approve_threshold;
        const targets = await listBulkApproveTargets(minScore, 50);
        const results: { proposalId: number; success: boolean; error?: string }[] = [];
        for (const proposal of targets) {
          try {
            const marked = await markProposalStatus({
              id: proposal.id,
              status: 'approved',
              reviewedBy: officerName,
              notes: `AI bulk approve (score ${proposal.score} ≥ ${minScore})`,
            });
            if (!marked) {
              results.push({ proposalId: proposal.id, success: false, error: 'not_pending' });
              continue;
            }
            await assignWorker({
              shiftId: proposal.shiftId,
              workerId: proposal.workerId,
              approvedBy: officerName,
              notes: `AI chat bulk approved #${proposal.id}`,
              notifyWorker: true,
            });
            await writeAudit({
              agentType: 'emergency',
              action: 'match_approved',
              shiftId: proposal.shiftId,
              workerId: proposal.workerId,
              score: proposal.score,
              approvedBy: officerName,
              notes: `AI bulk proposal #${proposal.id}`,
            });
            await expireSiblingProposals(proposal.shiftId, proposal.id);
            results.push({ proposalId: proposal.id, success: true });
          } catch (err) {
            results.push({
              proposalId: proposal.id,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return {
          name,
          args,
          ok: true,
          result: {
            minScore,
            attempted: targets.length,
            approved: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
          },
        };
      }
      case 'get_forecast': {
        const forecast = await buildNextPeriodForecast();
        return { name, args, ok: true, result: forecast };
      }
      case 'run_leave_cycle': {
        const summary = await runLeaveReplacementCycle('manual');
        return { name, args, ok: true, result: summary };
      }
      case 'list_skills': {
        const skills = await listSkills();
        return {
          name,
          args,
          ok: true,
          result: skills.map((s) => ({
            key: s.skill_key,
            name: s.name,
            status: s.status,
            lastRun: s.last_run_at,
          })),
        };
      }
      default:
        return { name, args, ok: false, result: { error: 'unknown_tool' } };
    }
  } catch (err) {
    return {
      name,
      args,
      ok: false,
      result: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}
