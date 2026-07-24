'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Skill, SkillStatus } from '@/lib/ross';

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

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [filter, setFilter] = useState<'all' | SkillStatus>('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/skills');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load skills');
      setSkills(json.skills ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(skill: Skill) {
    setBusyKey(skill.skill_key);
    setError(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skill.skill_key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Toggle failed');
      setSkills((prev) =>
        prev.map((s) => (s.skill_key === skill.skill_key ? (json.skill as Skill) : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    } finally {
      setBusyKey(null);
    }
  }

  const filtered = skills.filter((s) => {
    if (filter !== 'all' && s.status !== filter) return false;
    if (!q.trim()) return true;
    const hay = `${s.name} ${s.purpose} ${s.skill_key}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Skills</h1>
          <p>Ross capabilities — toggle On / Paused / Off. Changes apply immediately.</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          aria-label="Filter by status"
        >
          <option value="all">All skills</option>
          <option value="on">On</option>
          <option value="paused">Paused</option>
          <option value="off">Off</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search skills…"
          aria-label="Search skills"
          style={{ minWidth: 200 }}
        />
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="empty">Loading skills…</p> : null}

      {!loading && filtered.length === 0 ? (
        <p className="empty">No skills match.</p>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Skill</th>
              <th>Purpose</th>
              <th>Status</th>
              <th>Trigger</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((skill, idx) => (
              <tr key={skill.skill_key}>
                <td>{idx + 1}</td>
                <td>
                  <Link href={`/skills/${encodeURIComponent(skill.skill_key)}`}>
                    <strong>{skill.name}</strong>
                  </Link>
                </td>
                <td className="muted">{skill.purpose}</td>
                <td>
                  <button
                    type="button"
                    className={statusClass(skill.status)}
                    disabled={busyKey === skill.skill_key}
                    onClick={() => void toggle(skill)}
                    title="Click to cycle On → Paused → Off"
                  >
                    {statusLabel(skill.status)}
                  </button>
                </td>
                <td className="muted">{skill.trigger_label}</td>
                <td className="muted" title={skill.last_run_at ?? undefined}>
                  {formatWhen(skill.last_run_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
