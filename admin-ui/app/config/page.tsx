'use client';

import { useEffect, useState } from 'react';
import type { AgentConfig } from '@/lib/ross';

type FormState = {
  auto_approve_threshold: string;
  scan_interval_minutes: string;
  pre_shift_confirm_hours: string;
  escalation_hours_before_shift: string;
  max_safe_matches_per_scan: string;
  auto_assign_enabled: boolean;
};

const empty: FormState = {
  auto_approve_threshold: '',
  scan_interval_minutes: '',
  pre_shift_confirm_hours: '',
  escalation_hours_before_shift: '',
  max_safe_matches_per_scan: '',
  auto_assign_enabled: false,
};

function fromConfig(c: AgentConfig): FormState {
  return {
    auto_approve_threshold: String(c.auto_approve_threshold),
    scan_interval_minutes: String(c.scan_interval_minutes),
    pre_shift_confirm_hours: String(c.pre_shift_confirm_hours),
    escalation_hours_before_shift: String(c.escalation_hours_before_shift),
    max_safe_matches_per_scan: String(c.max_safe_matches_per_scan),
    auto_assign_enabled: Boolean(c.auto_assign_enabled),
  };
}

export default function ConfigPage() {
  const [form, setForm] = useState<FormState>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/config');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load config');
        setForm(fromConfig(json.config));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function setField(key: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const body = {
        auto_approve_threshold: Number(form.auto_approve_threshold),
        scan_interval_minutes: Number(form.scan_interval_minutes),
        pre_shift_confirm_hours: Number(form.pre_shift_confirm_hours),
        escalation_hours_before_shift: Number(form.escalation_hours_before_shift),
        max_safe_matches_per_scan: Number(form.max_safe_matches_per_scan),
        auto_assign_enabled: form.auto_assign_enabled,
      };
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setForm(fromConfig(json.config));
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Config</h1>
          <p>Global Ross settings — no Entra required; changes apply on the next scan.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => void save()} disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      {savedAt ? <p className="save-ok">Saved at {savedAt}</p> : null}

      {loading ? (
        <div className="empty">Loading config…</div>
      ) : (
        <div className="config-grid">
          <section className="config-card">
            <h2>Scan & timing</h2>
            <label>
              Emergency scan interval (minutes)
              <input
                type="number"
                min={1}
                max={1440}
                value={form.scan_interval_minutes}
                onChange={(e) => setField('scan_interval_minutes', e.target.value)}
              />
            </label>
            <label>
              Pre-shift confirm window (hours)
              <input
                type="number"
                min={1}
                max={168}
                value={form.pre_shift_confirm_hours}
                onChange={(e) => setField('pre_shift_confirm_hours', e.target.value)}
              />
            </label>
            <label>
              Escalation threshold (hours before shift)
              <input
                type="number"
                min={1}
                max={72}
                value={form.escalation_hours_before_shift}
                onChange={(e) => setField('escalation_hours_before_shift', e.target.value)}
              />
            </label>
          </section>

          <section className="config-card">
            <h2>Auto-pilot</h2>
            <label className="toggle-row">
              <span>Enable auto-assign writes</span>
              <input
                type="checkbox"
                checked={form.auto_assign_enabled}
                onChange={(e) => setField('auto_assign_enabled', e.target.checked)}
              />
            </label>
            <label>
              Auto-approve threshold (%)
              <input
                type="number"
                min={0}
                max={100}
                value={form.auto_approve_threshold}
                onChange={(e) => setField('auto_approve_threshold', e.target.value)}
              />
            </label>
            <label>
              Max candidates per proposal
              <input
                type="number"
                min={1}
                max={10}
                value={form.max_safe_matches_per_scan}
                onChange={(e) => setField('max_safe_matches_per_scan', e.target.value)}
              />
            </label>
            <p className="widget-foot">
              {form.auto_assign_enabled
                ? `ON — scans will assign the top match when score ≥ ${form.auto_approve_threshold || '—'}.`
                : 'OFF — scans only write proposals. Use Bulk approve on the Dashboard for safe matches.'}
            </p>
          </section>
        </div>
      )}
    </>
  );
}
