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

console.log('uncai credit tests passed');
