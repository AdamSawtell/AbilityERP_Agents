import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { runAgentChat, type ChatMessage } from '@/lib/agent/chat';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = String(body?.message ?? '').trim();
    if (!message) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'message required' },
        { status: 400 },
      );
    }
    const history = Array.isArray(body?.history) ? (body.history as ChatMessage[]) : [];
    const officerName = String(body?.officerName ?? body?.updatedBy ?? '').trim();
    const result = await runAgentChat({
      message,
      history,
      officerName: officerName || 'Rostering Officer',
    });
    return NextResponse.json({
      success: true,
      reply: result.reply,
      model: result.model,
      aiEnabled: result.aiEnabled,
      toolCalls: result.toolCalls.map((t) => ({
        name: t.name,
        ok: t.ok,
        args: t.args,
        result: t.ok ? summariseToolResult(t.name, t.result) : t.result,
      })),
    });
  } catch (err) {
    const message = errorMessage(err);
    const status =
      message.includes('API key') || message.includes('Incorrect API key') ? 502 : 503;
    return NextResponse.json({ error: 'agent_chat_failed', message }, { status });
  }
}

function summariseToolResult(name: string, result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;
  if (name === 'list_vacant' && Array.isArray(r.shifts)) {
    return {
      horizon: r.horizon,
      count: r.count,
      shifts: (r.shifts as { id: number; name: string; urgency?: string }[])
        .slice(0, 10)
        .map((s) => ({ id: s.id, name: s.name, urgency: s.urgency })),
    };
  }
  if (name === 'list_proposals' && Array.isArray(r.proposals)) {
    return {
      pendingCount: r.pendingCount,
      proposals: (r.proposals as { id: number; shiftName: string; workerName: string; score: number }[])
        .slice(0, 10)
        .map((p) => ({
          id: p.id,
          shiftName: p.shiftName,
          workerName: p.workerName,
          score: p.score,
        })),
    };
  }
  if (name === 'list_gaps' && Array.isArray(r.gaps)) {
    return { count: r.count, gaps: (r.gaps as unknown[]).slice(0, 10) };
  }
  return result;
}
