import test from 'node:test';
import assert from 'node:assert/strict';
import { Claude } from '../src/assistant/claude.js';

test('Claude provider: runs the requested tool, sends results back in one message, returns the prose', async () => {
  const bodies: any[] = [];
  const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const msg = (content: unknown[], stop: string) => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return bodies.length === 1
      ? msg([{ type: 'tool_use', id: 'tu1', name: 'find_service', input: { query: 'lost wallet' } }], 'tool_use')
      : msg([{ type: 'text', text: 'Go to Security.' }], 'end_turn');
  }) as typeof fetch;
  const claude = new Claude('test-key', 'claude-opus-5-5', fake);
  const ran: string[] = [];
  const out = await claude.ask('I lost my wallet', 'en', [{ role: 'assistant', text: 'hi' }], async c => { ran.push(`${c.name}:${c.args.query}`); return { found: true, id: 'service:security' }; });
  assert.deepEqual(ran, ['find_service:lost wallet']);
  assert.equal(out.text, 'Go to Security.');
  assert.equal(out.calls.length, 1);
  assert.equal(bodies[0].model, 'claude-opus-5-5');
  assert.equal(bodies[0].messages[0].role, 'user', 'history never starts with the assistant');
  assert.equal(bodies[0].output_config.effort, 'low');
  assert.equal(bodies[0].fallbacks, 'default');
  const last = bodies[1].messages.at(-1);
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].tool_use_id, 'tu1');
});

test('Claude provider: not configured without a key', () => {
  assert.equal(new Claude('', 'claude-opus-5-5').configured, false);
});
