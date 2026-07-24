import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { isAiConfigured, runAgentChat, type ChatMessage } from '../agent/chat';

export const agentRouter = Router();

agentRouter.get('/agent/status', (_req, res) => {
  res.json({
    aiEnabled: isAiConfigured(),
    provider: 'openai',
  });
});

agentRouter.post('/agent/chat', async (req, res) => {
  try {
    const message = String(req.body?.message ?? '').trim();
    if (!message) {
      res.status(400).json({ error: 'invalid_body', message: 'message required' });
      return;
    }

    const history = Array.isArray(req.body?.history)
      ? (req.body.history as ChatMessage[])
      : [];
    const officerName = String(req.body?.officerName ?? req.body?.updatedBy ?? '').trim();

    const result = await runAgentChat({
      message,
      history,
      officerName: officerName || 'Rostering Officer',
    });

    res.json({
      success: true,
      reply: result.reply,
      model: result.model,
      aiEnabled: result.aiEnabled,
      toolCalls: result.toolCalls.map((t) => ({
        name: t.name,
        ok: t.ok,
        args: t.args,
        // keep payloads small for UI
        result: t.ok ? summariseToolResult(t.name, t.result) : t.result,
      })),
    });
  } catch (err) {
    const message = errorMessage(err);
    const status =
      message.includes('API key') || message.includes('Incorrect API key') ? 502 : 503;
    res.status(status).json({ error: 'agent_chat_failed', message });
  }
});

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
