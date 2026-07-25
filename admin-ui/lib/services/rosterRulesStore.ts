import { query } from '../db/pool';
import { defaultRosterRules } from '../engine/rosterRuleDefaults';
import {
  normalizeRosterRule,
  normalizeRosterRuleEnforcement,
  normalizeRosterRuleParameters,
  normalizeRosterRuleType,
  type RosterRuleEnforcement,
  type RosterRuleParameters,
  type RosterRuleRecord,
  type RosterRuleType,
} from '../engine/rosterRules';

type RuleRow = {
  id: string;
  rule_type: string;
  name: string;
  description: string;
  enabled: boolean;
  enforcement: string;
  priority: number;
  parameters: unknown;
  effective_from: string | Date | null;
  effective_to: string | Date | null;
  updated_by: string | null;
  updated_at: string | Date | null;
  created: string | Date | null;
  deleted_at: string | Date | null;
};

function mapRow(row: RuleRow): RosterRuleRecord {
  return normalizeRosterRule({
    id: row.id,
    rule_type: row.rule_type,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    enforcement: row.enforcement,
    priority: row.priority,
    parameters: row.parameters,
    effective_from: row.effective_from != null ? String(row.effective_from) : null,
    effective_to: row.effective_to != null ? String(row.effective_to) : null,
    updated_by: row.updated_by,
    updated_at: row.updated_at != null ? String(row.updated_at) : null,
    created: row.created != null ? String(row.created) : null,
    deleted_at: row.deleted_at != null ? String(row.deleted_at) : null,
  });
}

export async function listRosterRules(includeDeleted = false): Promise<RosterRuleRecord[]> {
  const { rows } = await query<RuleRow>(
    `SELECT id, rule_type, name, description, enabled, enforcement, priority,
            parameters, effective_from, effective_to, updated_by, updated_at, created, deleted_at
     FROM adempiere.rostering_agent_rules
     WHERE ($1::boolean OR deleted_at IS NULL)
     ORDER BY priority ASC, name ASC`,
    [includeDeleted],
  );
  return rows.map(mapRow);
}

export async function getRosterRule(id: string): Promise<RosterRuleRecord | null> {
  const { rows } = await query<RuleRow>(
    `SELECT id, rule_type, name, description, enabled, enforcement, priority,
            parameters, effective_from, effective_to, updated_by, updated_at, created, deleted_at
     FROM adempiere.rostering_agent_rules
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * Rules effective on a date (including disabled rows).
 * Matcher needs disabled catalogue rows so built-in toggles can turn filters off.
 */
export async function listActiveRosterRules(asOfDate: string): Promise<RosterRuleRecord[]> {
  const day = asOfDate.slice(0, 10);
  const { rows } = await query<RuleRow>(
    `SELECT id, rule_type, name, description, enabled, enforcement, priority,
            parameters, effective_from, effective_to, updated_by, updated_at, created, deleted_at
     FROM adempiere.rostering_agent_rules
     WHERE deleted_at IS NULL
       AND (effective_from IS NULL OR effective_from <= $1::date)
       AND (effective_to IS NULL OR effective_to >= $1::date)
     ORDER BY priority ASC`,
    [day],
  );
  return rows.map(mapRow);
}

export type RosterRulePatch = Partial<{
  name: string;
  description: string;
  enabled: boolean;
  enforcement: RosterRuleEnforcement;
  priority: number;
  parameters: RosterRuleParameters;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}>;

export async function updateRosterRule(
  id: string,
  patch: RosterRulePatch,
  updatedBy: string,
): Promise<RosterRuleRecord | null> {
  const current = await getRosterRule(id);
  if (!current) return null;

  const next: RosterRuleRecord = {
    ...current,
    name: patch.name !== undefined ? String(patch.name).trim() : current.name,
    description:
      patch.description !== undefined ? String(patch.description).trim() : current.description,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    enforcement:
      patch.enforcement !== undefined
        ? normalizeRosterRuleEnforcement(patch.enforcement)
        : current.enforcement,
    priority:
      patch.priority !== undefined && Number.isFinite(Number(patch.priority))
        ? Math.round(Number(patch.priority))
        : current.priority,
    parameters:
      patch.parameters !== undefined
        ? normalizeRosterRuleParameters(current.ruleType, patch.parameters)
        : current.parameters,
    effectiveFrom:
      patch.effectiveFrom !== undefined
        ? patch.effectiveFrom
          ? String(patch.effectiveFrom).slice(0, 10)
          : null
        : current.effectiveFrom,
    effectiveTo:
      patch.effectiveTo !== undefined
        ? patch.effectiveTo
          ? String(patch.effectiveTo).slice(0, 10)
          : null
        : current.effectiveTo,
  };

  const { rows } = await query<RuleRow>(
    `UPDATE adempiere.rostering_agent_rules
     SET name = $2,
         description = $3,
         enabled = $4,
         enforcement = $5,
         priority = $6,
         parameters = $7::jsonb,
         effective_from = $8::date,
         effective_to = $9::date,
         updated_by = $10,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, rule_type, name, description, enabled, enforcement, priority,
               parameters, effective_from, effective_to, updated_by, updated_at, created, deleted_at`,
    [
      id,
      next.name,
      next.description,
      next.enabled,
      next.enforcement,
      next.priority,
      JSON.stringify(next.parameters),
      next.effectiveFrom,
      next.effectiveTo,
      updatedBy,
    ],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function toggleRosterRule(
  id: string,
  updatedBy: string,
): Promise<RosterRuleRecord | null> {
  const current = await getRosterRule(id);
  if (!current) return null;
  return updateRosterRule(id, { enabled: !current.enabled }, updatedBy);
}

export async function softDeleteRosterRule(
  id: string,
  updatedBy: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE adempiere.rostering_agent_rules
     SET deleted_at = NOW(), enabled = FALSE, updated_by = $2, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, updatedBy],
  );
  return (rowCount ?? 0) > 0;
}

export async function seedDefaultRosterRules(updatedBy = 'system'): Promise<{
  inserted: number;
  rules: RosterRuleRecord[];
}> {
  const defaults = defaultRosterRules(updatedBy);
  let inserted = 0;
  for (const rule of defaults) {
    const { rowCount } = await query(
      `INSERT INTO adempiere.rostering_agent_rules
         (id, rule_type, name, description, enabled, enforcement, priority, parameters, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        rule.id,
        rule.ruleType,
        rule.name,
        rule.description,
        rule.enabled,
        rule.enforcement,
        rule.priority,
        JSON.stringify(rule.parameters),
        updatedBy,
      ],
    );
    if ((rowCount ?? 0) > 0) inserted += 1;
  }
  const rules = await listRosterRules();
  return { inserted, rules };
}

export async function createRosterRule(
  input: {
    id?: string;
    ruleType: RosterRuleType | string;
    name: string;
    description?: string;
    enabled?: boolean;
    enforcement?: RosterRuleEnforcement | string;
    priority?: number;
    parameters?: unknown;
  },
  updatedBy: string,
): Promise<RosterRuleRecord> {
  const ruleType = normalizeRosterRuleType(input.ruleType);
  const id =
    String(input.id ?? '').trim() ||
    `rule-${ruleType}-${Date.now().toString(36)}`;
  const parameters = normalizeRosterRuleParameters(ruleType, input.parameters);
  const enforcement = normalizeRosterRuleEnforcement(input.enforcement);
  const { rows } = await query<RuleRow>(
    `INSERT INTO adempiere.rostering_agent_rules
       (id, rule_type, name, description, enabled, enforcement, priority, parameters, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     RETURNING id, rule_type, name, description, enabled, enforcement, priority,
               parameters, effective_from, effective_to, updated_by, updated_at, created, deleted_at`,
    [
      id,
      ruleType,
      String(input.name).trim(),
      String(input.description ?? '').trim(),
      input.enabled !== undefined ? Boolean(input.enabled) : true,
      enforcement,
      Number.isFinite(Number(input.priority)) ? Math.round(Number(input.priority)) : 100,
      JSON.stringify(parameters),
      updatedBy,
    ],
  );
  return mapRow(rows[0]!);
}
