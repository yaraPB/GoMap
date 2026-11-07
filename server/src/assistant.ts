import type { DatabaseSync } from 'node:sqlite';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };
export type AssistantAnswer = {
  answer: string;
  suggestedPlaces: { id: string; name: string; verificationStatus: string }[];
};

export class AssistantUnavailable extends Error {}

export async function answerQuestion(
  db: DatabaseSync,
  message: string,
  history: ChatTurn[],
  fetchImpl: typeof fetch = fetch,
  apiKey = process.env.GEMINI_API_KEY,
): Promise<AssistantAnswer> {
  if (!apiKey) throw new AssistantUnavailable('Set GEMINI_API_KEY on the server to use the AI assistant.');
  const places = db.prepare(`SELECT id, name, category, description,
    verification_status AS verificationStatus, hours, entrance FROM places ORDER BY name`).all();
  const services = db.prepare(`SELECT title, description, destination_id AS destinationId, note FROM services ORDER BY title`).all();
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `You are GoMap's campus discovery assistant. Use only the supplied sample campus records. Do not invent locations, hours, procedures, routes or accessibility facts. Say when a detail needs AUI verification. Answer the user's question concisely and suggest at most three relevant place IDs. Return JSON with exactly {"answer": string, "placeIds": string[]}. Campus records: ${JSON.stringify({ places, services })}` }] },
      contents: [...history, { role: 'user', text: message }].map(turn => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.text }] })),
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 600 },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new AssistantUnavailable(`Gemini request failed (${response.status}). Check the key, model and quota.`);
  const result = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  let parsed: { answer?: unknown; placeIds?: unknown };
  try { parsed = JSON.parse(text); } catch { throw new AssistantUnavailable('Gemini returned an unreadable answer. Try again.'); }
  if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) throw new AssistantUnavailable('Gemini returned an empty answer. Try again.');
  const ids = Array.isArray(parsed.placeIds) ? parsed.placeIds.filter((id): id is string => typeof id === 'string').slice(0, 3) : [];
  const known = new Map(places.map(place => [String(place.id), place]));
  return {
    answer: parsed.answer.trim().slice(0, 2000),
    suggestedPlaces: ids.filter(id => known.has(id)).map(id => {
      const place = known.get(id)!;
      return { id, name: String(place.name), verificationStatus: String(place.verificationStatus) };
    }),
  };
}
