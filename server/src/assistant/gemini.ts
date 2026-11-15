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
  constructor(private apiKey: string, readonly model: string, private fetchImpl: typeof fetch = fetch) {}

  get configured() { return Boolean(this.apiKey); }

  private async generate(body: unknown) {
    if (!this.apiKey) throw new LlmUnavailable('The AI assistant is not configured on the server (GEMINI_API_KEY).');
    const response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (response.status === 429) throw new LlmUnavailable('The assistant is busy right now (rate limit). Try again in a minute.');
    if (!response.ok) throw new LlmUnavailable(`Gemini request failed (${response.status}).`);
    const data = await response.json() as { candidates?: { content?: { parts?: Part[] } }[] };
    return data.candidates?.[0]?.content?.parts ?? [];
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
        generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
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
    });
    return parts.map(p => p.text ?? '').join('').trim();
  }
}
