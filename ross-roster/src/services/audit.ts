import { createHash } from 'crypto';
import { query } from '../db/pool';

export type AgentType = 'emergency' | 'planner' | 'system';

export type AuditInput = {
  agentType: AgentType;
  action: string;
  shiftId?: number | null;
  workerId?: number | null;
  score?: number | null;
  rulesPassed?: unknown;
  rulesFailed?: unknown;
  approvedBy?: string | null;
  notes?: string | null;
};

function hashRow(parts: Array<string | number | null | undefined>): string {
  return createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex');
}

export async function writeAudit(input: AuditInput): Promise<number> {
  const { rows: prevRows } = await query<{
    id: number;
    timestamp: Date;
    action: string;
    shift_id: number | null;
    worker_id: number | null;
    score: number | null;
  }>(
    `SELECT id, timestamp, action, shift_id, worker_id, score
     FROM adempiere.rostering_agent_audit_log
     ORDER BY id DESC
     LIMIT 1`,
  );

  const previousHash =
    prevRows[0] != null
      ? hashRow([
          prevRows[0].id,
          prevRows[0].timestamp?.toISOString?.() ?? String(prevRows[0].timestamp),
          prevRows[0].action,
          prevRows[0].shift_id,
          prevRows[0].worker_id,
          prevRows[0].score,
        ])
      : null;

  const { rows } = await query<{ id: number }>(
    `INSERT INTO adempiere.rostering_agent_audit_log (
        agent_type, action, shift_id, worker_id, score,
        rules_passed, rules_failed, approved_by, notes, previous_hash
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
     RETURNING id`,
    [
      input.agentType,
      input.action,
      input.shiftId ?? null,
      input.workerId ?? null,
      input.score ?? null,
      JSON.stringify(input.rulesPassed ?? null),
      JSON.stringify(input.rulesFailed ?? null),
      input.approvedBy ?? null,
      input.notes ?? null,
      previousHash,
    ],
  );

  return rows[0].id;
}

export async function listAudit(limit = 50, offset = 0) {
  const { rows } = await query(
    `SELECT id, timestamp, agent_type, action, shift_id, worker_id, score,
            rules_passed, rules_failed, approved_by, notes, previous_hash, created
     FROM adempiere.rostering_agent_audit_log
     ORDER BY id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

export async function getLastScanTimestamps(): Promise<{
  emergency: string | null;
  planner: string | null;
}> {
  const { rows } = await query<{ agent_type: string; timestamp: Date }>(
    `SELECT DISTINCT ON (agent_type) agent_type, timestamp
     FROM adempiere.rostering_agent_audit_log
     WHERE action IN ('scan_run', 'daily_plan', 'system_startup')
     ORDER BY agent_type, timestamp DESC`,
  );

  const map = new Map(rows.map((r) => [r.agent_type, r.timestamp.toISOString()]));
  return {
    emergency: map.get('emergency') ?? null,
    planner: map.get('planner') ?? null,
  };
}
