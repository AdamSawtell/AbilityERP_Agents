'use client';

import { useEffect, useState } from 'react';
import type { AuditEntry } from '@/lib/ross';

function formatNotes(e: AuditEntry): string {
  const raw = e.notes ?? e.approved_by;
  if (!raw) return '—';
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.trigger === 'string') {
        return `${parsed.trigger}: ${parsed.proposalsWritten ?? 0} proposals, ${parsed.gapsLogged ?? 0} gaps`;
      }
    } catch {
      /* keep raw */
    }
  }
  return raw;
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/audit');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed');
        setEntries(json.entries ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Audit</h1>
          <p>Immutable action log for Ross.</p>
        </div>
      </div>
      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {loading ? (
        <div className="empty">Loading audit log…</div>
      ) : entries.length === 0 ? (
        <div className="empty">No audit entries yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent</th>
              <th>Action</th>
              <th>Shift</th>
              <th>Score</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.timestamp).toLocaleString()}</td>
                <td>{e.agent_type}</td>
                <td>{e.action}</td>
                <td>{e.shift_id ?? '—'}</td>
                <td>{e.score ?? '—'}</td>
                <td>{formatNotes(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
