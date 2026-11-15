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

const quota = (limit: number, delay: string) => new Response(JSON.stringify({ error: { code: 429, message: `Quota exceeded for metric: generate_content_free_tier_requests, limit: ${limit}`,
  details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }] } }, null, 2), { status: 429 });
const ok = (text: string) => Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
const modelOf = (url: string | URL | Request) => String(url).match(/models\/([^:]+):/)![1];

test('Gemini free tier: a model with no quota ("limit: 0") hands over to the next one, which stays in use', async () => {
  const asked: string[] = [];
  const mock = (async (url: string | URL | Request) => {
    const m = modelOf(url); asked.push(m);
    return m === 'gemini-3.8-flash' ? quota(0, '40s') : ok(`answer from ${m}`);
  }) as typeof fetch;
  const g = new Gemini('k', 'gemini-3.8-flash', mock, ['gemini-3.5-flash-lite']);
  const r = await g.ask('hi', 'en', [], async () => ({}));
  assert.equal(r.text, 'answer from gemini-3.5-flash-lite');
  assert.equal(g.model, 'gemini-3.5-flash-lite');
  await g.ask('again', 'en', [], async () => ({}));
  assert.deepEqual(asked, ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite'], 'the empty model is not retried on every question');
});

test('Gemini free tier: a short per-minute limit is waited out once on the same model', async () => {
  let calls = 0;
  const mock = (async () => (++calls === 1 ? quota(15, '0.05s') : ok('after the wait'))) as typeof fetch;
  const g = new Gemini('k', 'gemini-3.5-flash-lite', mock, ['gemini-3.1-flash-lite']);
  const r = await g.ask('hi', 'en', [], async () => ({}));
  assert.equal(r.text, 'after the wait');
  assert.equal(calls, 2);
  assert.equal(g.model, 'gemini-3.5-flash-lite');
});

test('Gemini: a retired model (404) moves on; when every model is out, the student gets a clear "busy"', async () => {
  const retired = (async (url: string | URL | Request) => (modelOf(url) === 'gemini-2.5-flash' ? new Response('{}', { status: 404 }) : ok('fine'))) as typeof fetch;
  assert.equal((await new Gemini('k', 'gemini-2.5-flash', retired, ['gemini-3.5-flash-lite']).ask('hi', 'en', [], async () => ({}))).text, 'fine');
  const empty = (async () => quota(0, '60s')) as typeof fetch;
  await assert.rejects(new Gemini('k', 'a', empty, ['b']).ask('hi', 'en', [], async () => ({})), /busy/);
});
