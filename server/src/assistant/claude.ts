/**
 * Claude (Anthropic), server-side only. Same job as the Gemini provider: pick the right tool,
 * run it on our records, write one or two sentences. The answer card is built by the server.
 *
 * Why it is the preferred provider when a key is set: the most reliable tool choice we tested on
 * mixed Darija/French/Arabic questions, and it says "I don't know" instead of improvising.
 * Model: claude-opus-5-5 by default (CLAUDE_MODEL to change it). Effort "low": this is a short
 * routing chat, not a reasoning task, so it stays fast. Thinking cannot be switched off on this
 * model; effort is the dial. Server-side fallbacks are on: if a safety classifier declines a
 * (harmless) campus question, the API retries on a fallback model inside the same call.
 */
import Anthropic from '@anthropic-ai/sdk';
import { LlmUnavailable, SYSTEM, TOOL_NAMES, TOOL_SPECS, type History, type Llm, type LlmResult, type ToolCall, type ToolName, type ToolRunner } from './llm.js';

const TOOLS: Anthropic.Tool[] = TOOL_SPECS.map(t => ({
  name: t.name, description: t.description,
  input_schema: { type: 'object', properties: t.properties, required: t.required },
}));

export class Claude implements Llm {
  readonly provider = 'claude' as const;
  private client: Anthropic | null;

  constructor(apiKey: string, readonly model: string, fetchImpl?: typeof fetch) {
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) }) : null;
  }

  get configured() { return this.client !== null; }

  async ask(question: string, lang: string, history: History, run: ToolRunner): Promise<LlmResult> {
    if (!this.client) throw new LlmUnavailable('The AI assistant is not configured on the server (ANTHROPIC_API_KEY).');
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...history.slice(-6).map(h => ({ role: h.role, content: h.text }) as Anthropic.Beta.BetaMessageParam),
      { role: 'user', content: question },
    ];
    // the API needs the conversation to start with the user
    while (messages.length && messages[0].role !== 'user') messages.shift();
    const calls: LlmResult['calls'] = [];
    for (let turn = 0; turn < 5; turn++) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await this.client.beta.messages.create({
          model: this.model,
          max_tokens: 2048,
          // the system prompt and tool list never change between requests: cache them
          system: [{ type: 'text', text: SYSTEM(lang), cache_control: { type: 'ephemeral' } }],
          tools: TOOLS,
          messages,
          output_config: { effort: 'low' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (error) {
        if (error instanceof Anthropic.RateLimitError) throw new LlmUnavailable('The assistant is busy right now (rate limit). Try again in a minute.');
        if (error instanceof Anthropic.AuthenticationError) throw new LlmUnavailable('The assistant key on the server was refused (ANTHROPIC_API_KEY).');
        if (error instanceof Anthropic.APIError) throw new LlmUnavailable(`Claude request failed (${error.status ?? 'network'}).`);
        throw error;
      }
      if (response.stop_reason === 'refusal') return { text: '', calls };
      const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !uses.length) return { text, calls };
      messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      // every tool result of one turn goes back in ONE user message
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        if (!TOOL_NAMES.includes(use.name as ToolName)) {
          results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool', is_error: true });
          continue;
        }
        const input = (use.input && typeof use.input === 'object' ? use.input : {}) as Record<string, unknown>;
        const call: ToolCall = { name: use.name as ToolName, args: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v ?? '')])) };
        const result = await run(call);
        calls.push({ call, result });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result ?? { found: false }) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: '', calls };
  }
}
