const baseUrl = process.env.ROSS_API_URL ?? 'http://127.0.0.1:3002';
const apiKey = process.env.ROSS_API_KEY ?? '';

export async function rossFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || body?.error || `Ross API ${res.status}`);
  }
  return body as T;
}

export type Proposal = {
  id: number;
  shiftId: number;
  shiftName: string;
  workerId: number;
  workerName: string;
  score: number;
  isAutoApproved: boolean;
  proposedAt: string;
  status: string;
  rulesPassed?: {
    reason?: string;
    hard?: { rule: string; pass: boolean; detail?: string }[];
    soft?: { rule: string; pass: boolean; weight: number; earned: number }[];
  };
};

export type Gap = {
  id: number;
  shift_id: number;
  shift_name: string | null;
  reason: string;
  escalation_level: string;
  detected_at: string;
  resolved: boolean;
  blocked_count: number | null;
};

export type AuditEntry = {
  id: number;
  timestamp: string;
  agent_type: string;
  action: string;
  shift_id: number | null;
  worker_id: number | null;
  score: number | null;
  approved_by: string | null;
  notes: string | null;
};
