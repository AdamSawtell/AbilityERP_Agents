'use client';

import { useEffect, useState } from 'react';
import type { Gap } from '@/lib/ross';

export default function GapsPage() {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/gaps');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed');
        setGaps(json.gaps ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      }
    })();
  }, []);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Gaps</h1>
          <p>Shifts where Ross found no eligible worker.</p>
        </div>
      </div>
      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {gaps.length === 0 ? (
        <div className="empty">No unresolved gaps.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Shift</th>
              <th>Reason</th>
              <th>Level</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => (
              <tr key={g.id}>
                <td>{new Date(g.detected_at).toLocaleString()}</td>
                <td>{g.shift_name || g.shift_id}</td>
                <td>{g.reason}</td>
                <td className={`escalation-${g.escalation_level}`}>{g.escalation_level}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
