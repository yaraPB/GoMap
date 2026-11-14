// Optional live smoke check. It sends one synthetic campus question to Gemini.
import { config, loadEnv } from '../config.js';
import { Gemini } from '../assistant/gemini.js';

loadEnv();
if (!config.geminiKey) throw new Error('Set GEMINI_API_KEY in server/.env first.');
const gemini = new Gemini(config.geminiKey, config.geminiModel);
const result = await gemini.ask('Where is the library?', 'en', [], async call => {
  if (call.name === 'find_place') return { found: true, id: 'library', name: 'Library', verified: false };
  return { found: false };
});
if (!result.calls.some(c => c.call.name === 'find_place')) throw new Error('Gemini did not call the place tool.');
console.log(`Gemini responded with ${result.calls.length} tool call(s).`);
