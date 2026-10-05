import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../worker/uncai.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

async function scenario(providerStatus, providerBody, startingUsed = 2) {
  let used = startingUsed;
  let patches = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1' });
    if (url.includes('/rest/v1/profiles')) {
      if (options.method === 'PATCH') {
        patches++;
        const expected = Number(new URL(url).searchParams.get('ai_used')?.slice(3));
        if (used !== expected) return Response.json([]);
        used = JSON.parse(options.body).ai_used;
      }
      return Response.json([{ ai_used: used }]);
    }
    if (url.includes('api.anthropic.com')) return Response.json(providerBody, { status: providerStatus });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const request = new Request('https://uncai.example/', {
    method: 'POST', headers: { Authorization: 'Bearer test-token' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
  });
  const response = await worker.fetch(request, { ANTHROPIC_KEY: 'test-key' });
  return { response, body: await response.json(), used, patches };
}

for (const [status, body] of [
  [400, { type: 'error', error: { message: 'Invalid model' } }],
  [500, { type: 'error', error: { message: 'Provider failure' } }],
  [200, { content: [] }],
]) {
  const result = await scenario(status, body);
  assert.notEqual(result.response.status, 200);
  assert.equal(result.used, 2);
  assert.equal(result.patches, 0);
}

const success = await scenario(200, { content: [{ type: 'text', text: 'Analysis' }] });
assert.equal(success.response.status, 200);
assert.equal(success.used, 3);
assert.equal(success.patches, 1);
assert.equal(success.body.aiUsed, 3);

const exhausted = await scenario(200, { content: [{ type: 'text', text: 'Analysis' }] }, 5);
assert.equal(exhausted.response.status, 429);
assert.equal(exhausted.patches, 0);

const tradeId = '11111111-1111-4111-8111-111111111111';
const validAnalysis = { grade: 'A', summary: 'Good trade', strengths: ['Plan'], improvements: ['Risk'], psychology: 'Calm', pattern: 'Consistent', verdict: 'Keep going' };
async function tradeScenario(providerText, rpcStatus = 200) {
  let rpcCalls = 0;
  let profilePatches = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1' });
    if (url.includes('/rest/v1/profiles')) {
      if (options.method === 'PATCH') profilePatches++;
      return Response.json([{ ai_used: 2 }]);
    }
    if (url.includes('api.anthropic.com')) return Response.json({ content: [{ type: 'text', text: providerText }] });
    if (url.endsWith('/rpc/save_trade_ai_analysis')) {
      rpcCalls++;
      assert.equal(JSON.parse(options.body).p_trade_id, tradeId);
      return rpcStatus === 200 ? Response.json(3) : Response.json({ message: 'Could not save the AI analysis' }, { status: rpcStatus });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const response = await worker.fetch(new Request('https://uncai.example/', {
    method: 'POST', headers: { Authorization: 'Bearer test-token' },
    body: JSON.stringify({ purpose: 'trade_analysis', trade_id: tradeId, messages: [{ role: 'user', content: 'test' }] }),
  }), { ANTHROPIC_KEY: 'test-key' });
  return { status: response.status, body: await response.json(), rpcCalls, profilePatches };
}

const malformed = await tradeScenario('not JSON');
assert.equal(malformed.status, 502);
assert.equal(malformed.rpcCalls, 0);
assert.equal(malformed.profilePatches, 0);
const unsaved = await tradeScenario(JSON.stringify(validAnalysis), 500);
assert.equal(unsaved.status, 409);
assert.equal(unsaved.rpcCalls, 1);
assert.equal(unsaved.profilePatches, 0);
const saved = await tradeScenario(JSON.stringify(validAnalysis));
assert.equal(saved.status, 200);
assert.equal(saved.body.aiUsed, 3);
assert.equal(saved.rpcCalls, 1);
assert.equal(saved.profilePatches, 0);

console.log('uncai credit tests passed');
