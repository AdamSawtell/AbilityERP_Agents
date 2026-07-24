'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Skill, SkillStatus } from '@/lib/ross';

const WEIGHT_LABELS: Record<string, string> = {
  continuity_of_care: 'Continuity of care',
  location_proximity: 'Location proximity',
  availability_pattern: 'Availability pattern',
  contract_capacity: 'Contract capacity',
  transport_match: 'Transport match',
  response_history: 'Response history',
};

const RUNNABLE = new Set([
  'shift_scanner',
  'worker_matching',
  'gap_detector',
  'pre_shift_confirm',
  'swap_handler',
  'planner_briefing',
]);

function statusLabel(status: SkillStatus): string {
  if (status === 'on') return 'On';
  if (status === 'paused') return 'Paused';
  return 'Off';
}

function statusClass(status: SkillStatus): string {
  if (status === 'on') return 'skill-status on';
  if (status === 'paused') return 'skill-status paused';
  return 'skill-status off';
}

export default function SkillDetailPage() {
  const params = useParams<{ key: string }>();
  const key = decodeURIComponent(params.key);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(key)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setSkill(json.skill);
      if (json.softWeights) setWeights(json.softWeights);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle() {
    if (!skill) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Toggle failed');
      setSkill(json.skill);
      setFlash(`Status → ${statusLabel(json.skill.status)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(key)}/run`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Run failed');
      setFlash(`Run complete — ${JSON.stringify(json.result).slice(0, 160)}…`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveWeights() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(key)}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soft_weights: weights }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Save failed');
      if (json.skill) setSkill(json.skill);
      if (json.softWeights) setWeights(json.softWeights);
      setFlash('Soft weights saved — next match uses them');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="empty">Loading skill…</p>;
  if (!skill) return <p className="error">{error || 'Skill not found'}</p>;

  const canRun = RUNNABLE.has(skill.skill_key) && skill.status !== 'off';

  return (
    <>
      <div className="topbar">
        <div>
          <p className="muted" style={{ margin: '0 0 4px' }}>
            <Link href="/skills">← Skills</Link>
          </p>
          <h1>{skill.name}</h1>
          <p>{skill.purpose}</p>
        </div>
        <div className="actions">
          <button
            type="button"
            className={statusClass(skill.status)}
            disabled={busy}
            onClick={() => void toggle()}
            title="Cycle On → Paused → Off"
          >
            {statusLabel(skill.status)}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !canRun}
            onClick={() => void runNow()}
            title={skill.status === 'off' ? 'Turn On or Paused to run' : 'Run now'}
          >
            Run Now
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {flash ? <p className="flash">{flash}</p> : null}

      <section className="widget" style={{ marginBottom: 16 }}>
        <h3>Runtime</h3>
        <dl className="stat-list">
          <div>
            <dt>Key</dt>
            <dd>
              <code>{skill.skill_key}</code>
            </dd>
          </div>
          <div>
            <dt>Trigger</dt>
            <dd>{skill.trigger_label}</dd>
          </div>
          <div>
            <dt>Depends on</dt>
            <dd>
              {skill.depends_on.length
                ? skill.depends_on.map((d) => (
                    <Link key={d} href={`/skills/${encodeURIComponent(d)}`} style={{ marginRight: 8 }}>
                      {d}
                    </Link>
                  ))
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Last run</dt>
            <dd>
              {skill.last_run_at
                ? `${new Date(skill.last_run_at).toLocaleString()} (${skill.last_run_action})`
                : '—'}
            </dd>
          </div>
        </dl>
        <p className="widget-foot">
          On = cron + chain. Paused = no cron (manual OK). Off = no cron and no chain effects.
        </p>
      </section>

      {skill.skill_key === 'worker_matching' ? (
        <section className="widget">
          <h3>Soft rule weights</h3>
          <p className="widget-foot">Scores scale to these weights (capped at 100).</p>
          <div className="weight-grid">
            {Object.keys(WEIGHT_LABELS).map((k) => (
              <label key={k} className="weight-row">
                <span>{WEIGHT_LABELS[k]}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={weights[k] ?? 0}
                  disabled={busy}
                  onChange={(e) =>
                    setWeights((prev) => ({ ...prev, [k]: Number(e.target.value) }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveWeights()}>
              Save weights
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
