/**
 * Gemini, server-side only. Two jobs:
 *  - ask(): function calling over our own data. The model chooses a tool, we run it against
 *    our databases, the model writes one or two sentences. The STRUCTURE of the answer (place,
 *    steps, contact, action) is built by the server from the tool results, never by the model.
 *  - transcribe(): voice fallback for Expo Go, where on-device speech recognition is unavailable.
 */
import { LlmUnavailable, SYSTEM, TOOL_NAMES, TOOL_SPECS, type History, type Llm, type LlmResult, type ToolCall, type ToolRunner } from './llm.js';

/** Kept for older imports: the same error every provider throws. */
export const GeminiUnavailable = LlmUnavailable;
export type { ToolCall };

const TOOLS = [{ functionDeclarations: TOOL_SPECS.map(t => ({ name: t.name, description: t.description,
  parameters: { type: 'object', properties: t.properties, ...(t.required.length ? { required: t.required } : {}) } })) }];

type Part = { text?: string; functionCall?: { name: string; args?: Record<string, string>; id?: string }; functionResponse?: unknown; thoughtSignature?: string };
// Tool results go back with role 'user': the API rejects the older 'function' role.
type Content = { role: 'user' | 'model'; parts: Part[] };

export class Gemini implements Llm {
  readonly provider = 'gemini' as const;
  /** The configured model first, then fallbacks for when it has no quota (free tier) or is retired. */
  private chain: string[];
  private active = 0;
  private activeSince = 0;
  /** model → until when it is skipped after hanging */
  private stalled = new Map<string, number>();
  /** per request: a tool choice takes ~1 s; a model that has not answered in 8 s is not going to */
  timeoutMs = 8000;
  constructor(private apiKey: string, model: string, private fetchImpl: typeof fetch = fetch, fallbacks: string[] = []) {
    this.chain = [...new Set([model, ...fallbacks].filter(Boolean))];
  }

  /** The model answering right now (the configured one unless it ran out of quota). */
  get model() { return this.chain[this.active]; }
  get configured() { return Boolean(this.apiKey); }

  /**
   * Free-tier keys hit two kinds of 429: a short per-minute limit (wait the few seconds Google asks
   * for, once) and "limit: 0" (this model has no free quota at all: move to the next model). A 404 means
   * the model was retired: next model. The working model stays in use; the configured one is retried
   * every 10 minutes.
   */
  private async generate(body: unknown, timeoutMs = this.timeoutMs) {
    if (!this.apiKey) throw new LlmUnavailable('The AI assistant is not configured on the server (GEMINI_API_KEY).');
    if (this.active && Date.now() - this.activeSince > 10 * 60_000) this.active = 0;
    for (let i = this.active; i < this.chain.length; i++) {
      // a model that hung recently is skipped for a while, so students do not wait on it again
      if ((this.stalled.get(this.chain[i]) ?? 0) > Date.now()) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        let response: Response;
        try {
          response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.chain[i])}:generateContent`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
            body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          // Free-tier keys can leave a model with no quota hanging instead of answering 429: next model
          if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) { this.stalled.set(this.chain[i], Date.now() + 10 * 60_000); break; }
          throw new LlmUnavailable('Could not reach Gemini (network).');
        }
        if (response.ok) {
          if (i !== this.active) { this.active = i; this.activeSince = Date.now(); }
          const data = await response.json() as { candidates?: { content?: { parts?: Part[] } }[] };
          return data.candidates?.[0]?.content?.parts ?? [];
        }
        const text = await response.text().catch(() => '');
        if (response.status === 429) {
          const wait = Number(text.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1] ?? NaN);
          if (!/limit: 0\b/.test(text) && attempt === 0 && wait <= 6) { await new Promise(r => setTimeout(r, wait * 1000 + 200)); continue; }
          break; // no quota on this model, or a long wait: try the next model
        }
        if (response.status === 404) break;
        // "high demand" (503) or a server error: this model is unavailable for now, the next one answers
        if (response.status >= 500) { this.stalled.set(this.chain[i], Date.now() + 10 * 60_000); break; }
        // a model that does not take a thinking level: ask again without it
        if (response.status === 400 && /thinking/i.test(text) && body && typeof body === 'object' && (body as { generationConfig?: { thinkingConfig?: unknown } }).generationConfig?.thinkingConfig) {
          const { thinkingConfig: _drop, ...generationConfig } = (body as { generationConfig: Record<string, unknown> }).generationConfig;
          void _drop;
          body = { ...(body as object), generationConfig };
          attempt--;
          continue;
        }
        throw new LlmUnavailable(`Gemini request failed (${response.status}).`);
      }
    }
    throw new LlmUnavailable('The assistant is busy right now (rate limit). Try again in a minute.');
  }

  /** Runs the tool loop. Returns the model's prose and every tool call it made, with results. */
  async ask(question: string, lang: string, history: History, run: ToolRunner): Promise<LlmResult> {
    const contents: Content[] = [
      ...history.slice(-6).map(h => ({ role: h.role === 'assistant' ? 'model' as const : 'user' as const, parts: [{ text: h.text }] })),
      { role: 'user', parts: [{ text: question }] },
    ];
    const calls: { call: ToolCall; result: unknown }[] = [];
    for (let turn = 0; turn < 4; turn++) {
      const parts = await this.generate({
        systemInstruction: { parts: [{ text: SYSTEM(lang) }] }, contents, tools: TOOLS,
        // low thinking: this is choosing a tool, not reasoning, and students are waiting.
        // The budget covers the thinking tokens too, so a tool call is never cut off.
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'low' } },
      });
      const fnCalls = parts.filter(p => p.functionCall);
      if (!fnCalls.length) {
        const text = parts.map(p => p.text ?? '').join('').trim();
        return { text, calls };
      }
      // Gemini 3 may attach a thought signature to any part; return every part unchanged.
      contents.push({ role: 'model', parts });
      const responses: Part[] = [];
      for (const p of fnCalls) {
        const name = p.functionCall!.name as ToolCall['name'];
        if (!TOOL_NAMES.includes(name)) {
          responses.push({ functionResponse: { name, ...(p.functionCall!.id ? { id: p.functionCall!.id } : {}), response: { error: 'Unknown function' } } });
          continue;
        }
        const call: ToolCall = { name, args: p.functionCall!.args ?? {} };
        const result = await run(call);
        calls.push({ call, result });
        responses.push({ functionResponse: { name, ...(p.functionCall!.id ? { id: p.functionCall!.id } : {}), response: { result: result ?? { found: false } } } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    return { text: '', calls };
  }

  async transcribe(audio: Buffer, mimeType: string, lang: string) {
    const parts = await this.generate({
      contents: [{ role: 'user', parts: [
        { text: `Transcribe this short voice question verbatim. Expected language: ${lang}. It is about places and people at Al Akhawayn University. Reply with the transcript only, no quotes.` },
        { inlineData: { mimeType, data: audio.toString('base64') } },
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 200 },
    }, 12_000); // a short question clip takes longer than a tool choice, but not much
    return parts.map(p => p.text ?? '').join('').trim();
  }
}
