'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  parameterFieldDefs,
  ROSTER_RULE_TYPE_LABELS,
  type RosterRuleEnforcement,
  type RosterRuleParameters,
  type RosterRuleRecord,
  type RosterRuleType,
} from '@/lib/engine/rosterRules';

export default function RulesPage() {
  const [rules, setRules] = useState<RosterRuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RosterRuleRecord | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/rules');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load rules');
      setRules(json.rules ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function seedDefaults() {
    setBusyId('seed');
    setError(null);
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed-defaults', updatedBy: 'admin-ui' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Seed failed');
      setRules(json.rules ?? []);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Seed failed');
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(rule: RosterRuleRecord) {
    setBusyId(rule.id);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(rule.id)}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updatedBy: 'admin-ui' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Toggle failed');
      setRules((prev) => prev.map((r) => (r.id === rule.id ? (json.rule as RosterRuleRecord) : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusyId(editing.id);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(editing.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updatedBy: 'admin-ui',
          name: editing.name,
          description: editing.description,
          enabled: editing.enabled,
          enforcement: editing.enforcement,
          priority: editing.priority,
          parameters: editing.parameters,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setRules((prev) =>
        prev.map((r) => (r.id === editing.id ? (json.rule as RosterRuleRecord) : r)),
      );
      setEditing(null);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusyId(null);
    }
  }

  function setParam(key: string, value: number | boolean) {
    if (!editing) return;
    setEditing({
      ...editing,
      parameters: { ...(editing.parameters as Record<string, unknown>), [key]: value } as RosterRuleParameters,
    });
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Roster rules</h1>
          <p>
            Configurable matching / safety rules (AbilityAPP-style). Toggle, set blocking vs
            warning, and edit parameters — applied on the next match scan.
          </p>
        </div>
        <div className="actions">
          <button
            className="btn"
            onClick={() => void seedDefaults()}
            disabled={loading || busyId === 'seed'}
          >
            {busyId === 'seed' ? 'Seeding…' : 'Seed defaults'}
          </button>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {savedAt ? <p className="save-ok">Saved at {savedAt}</p> : null}

      {loading ? (
        <div className="empty">Loading rules…</div>
      ) : rules.length === 0 ? (
        <div className="empty">
          No rules yet. Apply migration <code>007_roster_rules.sql</code> or click Seed defaults.
        </div>
      ) : (
        <div className="rules-list">
          {rules.map((rule) => (
            <section key={rule.id} className="config-card rules-card">
              <div className="rules-card-head">
                <div>
                  <h2>{rule.name}</h2>
                  <p className="rules-meta">
                    <span className="rules-type">
                      {ROSTER_RULE_TYPE_LABELS[rule.ruleType as RosterRuleType] ?? rule.ruleType}
                    </span>
                    <span
                      className={`skill-status ${rule.enabled ? 'on' : 'off'}`}
                      style={{ marginLeft: 8 }}
                    >
                      {rule.enabled ? 'On' : 'Off'}
                    </span>
                    <span className="rules-enforcement">{rule.enforcement}</span>
                  </p>
                  <p className="rules-desc">{rule.description}</p>
                </div>
                <div className="actions">
                  <button
                    className="btn"
                    disabled={busyId === rule.id}
                    onClick={() => void toggle(rule)}
                  >
                    {rule.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn btn-primary" onClick={() => setEditing({ ...rule })}>
                    Edit
                  </button>
                </div>
              </div>
              {Object.keys(rule.parameters ?? {}).length > 0 ? (
                <pre className="rules-params">{JSON.stringify(rule.parameters, null, 2)}</pre>
              ) : (
                <p className="rules-desc">No parameters (built-in filter).</p>
              )}
            </section>
          ))}
        </div>
      )}

      {editing ? (
        <div className="rules-modal-backdrop" onClick={() => setEditing(null)}>
          <div
            className="config-card rules-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Edit roster rule"
          >
            <h2>Edit — {editing.name}</h2>
            <label>
              Name
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </label>
            <label>
              Description
              <input
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </label>
            <label>
              Enforcement
              <select
                value={editing.enforcement}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    enforcement: e.target.value as RosterRuleEnforcement,
                  })
                }
              >
                <option value="blocking">Blocking (hard fail)</option>
                <option value="warning">Warning (soft note)</option>
              </select>
            </label>
            <label>
              Priority
              <input
                type="number"
                value={editing.priority}
                onChange={(e) =>
                  setEditing({ ...editing, priority: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label className="toggle-row">
              <span>Enabled</span>
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              />
            </label>

            {parameterFieldDefs(editing.ruleType).length > 0 ? (
              <div className="rules-param-grid">
                <h3>Parameters</h3>
                {parameterFieldDefs(editing.ruleType).map((field) => {
                  const params = editing.parameters as Record<string, unknown>;
                  if (field.kind === 'boolean') {
                    return (
                      <label key={field.key} className="toggle-row">
                        <span>{field.label}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(params[field.key])}
                          onChange={(e) => setParam(field.key, e.target.checked)}
                        />
                      </label>
                    );
                  }
                  return (
                    <label key={field.key}>
                      {field.label}
                      <input
                        type="number"
                        step={field.step ?? 1}
                        value={Number(params[field.key] ?? 0)}
                        onChange={(e) => setParam(field.key, Number(e.target.value))}
                      />
                      {field.hint ? <span className="rules-hint">{field.hint}</span> : null}
                    </label>
                  );
                })}
              </div>
            ) : null}

            <div className="actions" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busyId === editing.id}
                onClick={() => void saveEdit()}
              >
                {busyId === editing.id ? 'Saving…' : 'Save rule'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
