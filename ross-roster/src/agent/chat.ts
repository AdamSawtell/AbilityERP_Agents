import OpenAI from 'openai';
import { env } from '../config';
import { writeAudit } from '../services/audit';
import { getSystemPrompt } from './systemPrompt';
import { AGENT_TOOLS, executeAgentTool, type ToolCallRecord } from './tools';

export type ChatMessage = {
  role: 'officer' | 'ross' | 'user' | 'assistant';
  content: string;
};

export type AgentChatResult = {
  reply: string;
  model: string;
  toolCalls: ToolCallRecord[];
  aiEnabled: boolean;
};

function toOpenAiHistory(
  history: ChatMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  for (const m of history.slice(-12)) {
    const text = String(m.content || '').trim();
    if (!text) continue;
    if (m.role === 'officer' || m.role === 'user') {
      out.push({ role: 'user', content: text });
    } else {
      out.push({ role: 'assistant', content: text });
    }
  }
  return out;
}

export function isAiConfigured(): boolean {
  return Boolean(env.openai.apiKey);
}

export async function runAgentChat(opts: {
  message: string;
  history?: ChatMessage[];
  officerName?: string;
}): Promise<AgentChatResult> {
  const message = opts.message.trim();
  if (!message) {
    return {
      reply: 'Say something and I will look it up.',
      model: env.openai.model,
      toolCalls: [],
      aiEnabled: isAiConfigured(),
    };
  }

  if (!env.openai.apiKey) {
    return {
      reply:
        'AI chat is offline — set OPENAI_API_KEY on the Ross server (.env), redeploy, then try again.\n' +
        'Until then use shortcuts: help, scan, status, vacant, gaps, bulk.',
      model: env.openai.model,
      toolCalls: [],
      aiEnabled: false,
    };
  }

  const officerName = (opts.officerName || 'Rostering Officer').trim();
  const client = new OpenAI({ apiKey: env.openai.apiKey });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: getSystemPrompt() },
    ...toOpenAiHistory(opts.history ?? []),
    { role: 'user', content: message },
  ];

  const toolCalls: ToolCallRecord[] = [];
  let finalReply = '';
  const maxRounds = 6;

  for (let round = 0; round < maxRounds; round += 1) {
    const completion = await client.chat.completions.create({
      model: env.openai.model,
      messages,
      tools: AGENT_TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) {
      finalReply = 'No response from the model.';
      break;
    }

    messages.push(choice);

    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      finalReply = (choice.content || '').trim() || 'Done.';
      break;
    }

    for (const call of calls) {
      if (call.type !== 'function') continue;
      const record = await executeAgentTool(
        call.function.name,
        call.function.arguments || '{}',
        officerName,
      );
      toolCalls.push(record);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(record.result).slice(0, 12_000),
      });
    }

    if (round === maxRounds - 1) {
      finalReply =
        (choice.content || '').trim() ||
        'I ran the tools but hit the step limit — ask me to continue or check the Dashboard.';
    }
  }

  try {
    await writeAudit({
      agentType: 'system',
      action: 'agent_chat',
      approvedBy: officerName,
      notes: JSON.stringify({
        message: message.slice(0, 400),
        reply: finalReply.slice(0, 800),
        tools: toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
        model: env.openai.model,
      }),
    });
  } catch {
    /* audit best-effort */
  }

  return {
    reply: finalReply,
    model: env.openai.model,
    toolCalls,
    aiEnabled: true,
  };
}
