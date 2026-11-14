/**
 * Gemini, server-side only. Two jobs:
 *  - ask(): function calling over our own data. The model chooses a tool, we run it against
 *    our databases, the model writes one or two sentences. The STRUCTURE of the answer (place,
 *    steps, contact, action) is built by the server from the tool results, never by the model.
 *  - transcribe(): voice fallback for Expo Go, where on-device speech recognition is unavailable.
 */
export class GeminiUnavailable extends Error {}

export type ToolCall = { name: 'find_place' | 'get_person_office' | 'get_procedure'; args: Record<string, string> };
export type ToolRunner = (call: ToolCall) => Promise<unknown>;

const TOOLS = [{
  functionDeclarations: [
    { name: 'find_place', description: 'Find a place on the Al Akhawayn University campus (building, office, café, car park, service) by name or description.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'What the user is looking for, e.g. "library" or "where to print"' } }, required: ['query'] } },
    { name: 'get_person_office', description: 'Office, building, floor, office hours and whether a professor or staff member is in right now.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'get_procedure', description: 'How to do a university procedure (declare a minor, internship agreement, advising, account problems…): steps, owning office, where it is, contact.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  ],
}];

const SYSTEM = (lang: string) => `You are GoMap, the campus assistant of Al Akhawayn University in Ifrane (AUI).
Rules:
- Answer ONLY from function results. Always call a function before answering a campus question.
- Never invent a building number, room, email, phone number, hours or procedure step.
- If the functions return nothing useful, say plainly you don't know and suggest asking the office or the AUI switchboard (+212 535-862-000).
- Records marked unverified or draft: say they still need confirming.
- Reply in ${lang === 'fr' ? 'French' : lang === 'ar' ? 'Arabic' : 'English'}, in at most two short sentences. No markdown, no lists. The app shows steps, maps and contacts itself.
- Questions not about the campus: say you can only help with places, people and procedures at AUI.`;

type Part = { text?: string; functionCall?: { name: string; args?: Record<string, string>; id?: string }; functionResponse?: unknown; thoughtSignature?: string };
// Tool results go back with role 'user': the API rejects the older 'function' role.
type Content = { role: 'user' | 'model'; parts: Part[] };

export class Gemini {
  constructor(private apiKey: string, private model: string, private fetchImpl: typeof fetch = fetch) {}

  get configured() { return Boolean(this.apiKey); }

  private async generate(body: unknown) {
    if (!this.apiKey) throw new GeminiUnavailable('The AI assistant is not configured on the server (GEMINI_API_KEY).');
    const response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (response.status === 429) throw new GeminiUnavailable('The assistant is busy right now (rate limit). Try again in a minute.');
    if (!response.ok) throw new GeminiUnavailable(`Gemini request failed (${response.status}).`);
    const data = await response.json() as { candidates?: { content?: { parts?: Part[] } }[] };
    return data.candidates?.[0]?.content?.parts ?? [];
  }

  /** Runs the tool loop. Returns the model's prose and every tool call it made, with results. */
  async ask(question: string, lang: string, history: { role: 'user' | 'assistant'; text: string }[], run: ToolRunner) {
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
      contents.push({ role: 'model', parts: fnCalls });
      const responses: Part[] = [];
      for (const p of fnCalls) {
        const name = p.functionCall!.name as ToolCall['name'];
        if (!['find_place', 'get_person_office', 'get_procedure'].includes(name)) continue;
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
