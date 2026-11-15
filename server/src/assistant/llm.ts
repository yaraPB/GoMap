/**
 * What every assistant model gets: the same tools, the same rules, the same contract.
 * The model only RESOLVES the question (which tool, which words). The server runs the tool on
 * our own records and builds the answer card (place, steps, contact, directions) from the result,
 * so switching model (Claude ↔ Gemini) never changes what a student is told about a fact.
 */
export class LlmUnavailable extends Error {}

export const TOOL_NAMES = ['find_place', 'get_person_office', 'get_procedure', 'find_service', 'campus_rule', 'whats_on', 'campus_info'] as const;
export type ToolName = typeof TOOL_NAMES[number];
export type ToolCall = { name: ToolName; args: Record<string, string> };
export type ToolRunner = (call: ToolCall) => Promise<unknown>;
export type History = { role: 'user' | 'assistant'; text: string }[];
export type LlmResult = { text: string; calls: { call: ToolCall; result: unknown }[] };

export interface Llm {
  readonly provider: 'claude' | 'gemini';
  readonly model: string;
  readonly configured: boolean;
  ask(question: string, lang: string, history: History, run: ToolRunner): Promise<LlmResult>;
}

type Prop = { type: 'string'; description?: string };
export const TOOL_SPECS: { name: ToolName; description: string; properties: Record<string, Prop>; required: string[] }[] = [
  { name: 'campus_rule', description: 'Answers written by the campus administration for specific questions and situations (rules, policies, "what do I do if…", local know-how). Check this FIRST for any question that is not simply "where is X".',
    properties: { query: { type: 'string', description: 'The question or situation in a few words' } }, required: ['query'] },
  { name: 'find_place', description: 'Find a place on the Al Akhawayn University campus (building, office, café, car park, service) by name or description.',
    properties: { query: { type: 'string', description: 'What the user is looking for, e.g. "library" or "where to print"' } }, required: ['query'] },
  { name: 'get_person_office', description: 'Office, building, floor, office hours and whether a professor or staff member is in right now.',
    properties: { name: { type: 'string', description: 'The person\'s name as the user said it' } }, required: ['name'] },
  { name: 'get_procedure', description: 'How to do a university procedure (declare a minor, internship agreement, advising, account problems…): steps, owning office, where it is, contact.',
    properties: { query: { type: 'string' } }, required: ['query'] },
  { name: 'find_service', description: 'Which AUI office handles a student need or problem (fees, scholarships, transcripts, housing, feeling sick, stress, harassment, lost items, Wi-Fi, tutoring, internships, clubs…): office name, building, room, hours, email, phone extension.',
    properties: { query: { type: 'string', description: 'The need in a few words, e.g. "pay tuition" or "lost my wallet"' } }, required: ['query'] },
  { name: 'whats_on', description: 'Events happening on campus now and in the coming days (talks, matches, club fairs, ceremonies), with time and place.',
    properties: { query: { type: 'string', description: 'Optional topic or day, e.g. "tonight", "sport"' } }, required: [] },
  { name: 'campus_info', description: 'General campus facts: standard office hours, lunch break, weekend opening, emergency numbers, and the list of offices.',
    properties: {}, required: [] },
];

export const SYSTEM = (lang: string) => `You are GoMap, the campus assistant of Al Akhawayn University in Ifrane (AUI).
Rules:
- Answer ONLY from tool results. Always call a tool before answering a campus question.
- For anything that is not plainly "where is X", call campus_rule first: the administration writes those answers by hand and they win over everything else.
- Never invent a building number, room, email, phone number, hours, event or procedure step.
- If the tools return nothing useful, say plainly you don't know and suggest asking the office or the AUI switchboard (+212 535-862-000).
- Records marked unverified or draft: say they still need confirming.
- Reply in ${lang === 'fr' ? 'French' : lang === 'ar' ? 'Arabic' : 'English'}, in at most two short sentences. No markdown, no lists. The app shows steps, maps and contacts itself.
- A student describing a problem ("I lost my card", "I feel sick", "I can't pay"): call campus_rule, then find_service.
- Emergencies: always give Security's 24/7 number (ext. 2222 / 0535-86-2222) first.
- Questions not about the campus: say you can only help with places, people, offices, events and procedures at AUI.`;
