import test from 'node:test';
import assert from 'node:assert/strict';
import { Gemini } from '../src/assistant/gemini.js';

test('Gemini tool loop returns every signed part and preserves parallel call ids', async () => {
  const bodies: any[] = [];
  const parts = [
    { text: 'Checking.', thoughtSignature: 'signature-on-text' },
    { functionCall: { name: 'find_place', args: { query: 'library' }, id: 'one' }, thoughtSignature: 'signature-on-call' },
    { functionCall: { name: 'get_person_office', args: { name: 'Harit Satt' }, id: 'two' } },
  ];
  const mock = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ candidates: [{ content: { parts: bodies.length === 1 ? parts : [{ text: 'Done.' }] } }] });
  }) as typeof fetch;
  const gemini = new Gemini('test-key', 'gemini-3.5-flash-lite', mock);
  const result = await gemini.ask('Where are they?', 'en', [{ role: 'user', text: 'Library and Harit Satt' }], async call => ({ found: true, query: call.args.query ?? call.args.name }));
  assert.equal(result.calls.length, 2);
  const content = bodies[1].contents;
  assert.deepEqual(content.at(-2), { role: 'model', parts });
  assert.deepEqual(content.at(-1).parts.map((p: any) => p.functionResponse.id), ['one', 'two']);
  assert.equal(content[0].parts[0].text, 'Library and Harit Satt');
});
