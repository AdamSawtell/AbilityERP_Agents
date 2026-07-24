'use client';

import { useEffect, useState } from 'react';
import type { AuditEntry } from '@/lib/ross';

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
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
              <td>{e.notes ?? e.approved_by ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
