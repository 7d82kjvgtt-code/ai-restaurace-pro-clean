import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const source = fs.readFileSync(new URL('../../api/restaurant-ai.js', import.meta.url), 'utf8');
let cases = 0;
for (const locale of ['cs', 'en']) for (const env of [
  {}, { OPENAI_API_KEY: 'fixture-only' },
  { OPENAI_API_KEY: 'fixture-only', AI_ENABLED: 'false' },
  { OPENAI_API_KEY: 'fixture-only', AI_ENABLED: 'TRUE' }, { AI_ENABLED: 'true' }
]) {
  let fetches = 0;
  const context = vm.createContext({ createHash, URL, Date, Intl, Map, AbortSignal,
    process: { env }, console: { error() {} },
    fetch: async () => { fetches++; throw new Error('Disabled AI must not access database or provider'); }
  });
  vm.runInContext(source.replace('import { createHash } from "node:crypto";', '')
    .replace('export default async function handler', 'async function handler') + '\nthis.testHandler = handler;', context);
  for (const method of ['POST', 'GET']) {
    let status = 200, body;
    const headers = {};
    const res = { setHeader(k, v) { headers[k] = v; }, status(n) { status = n; return this; }, json(v) { body = v; return this; } };
    await context.testHandler({ method, headers: {}, body: { locale, slug: 'fixture', question: 'Opening hours?' } }, res);
    assert.equal(status, method === 'POST' ? 503 : 405);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.match(body.error, locale === 'en' ? /not available|POST/ : /aktivovaný|POST/);
    assert.equal(fetches, 0);
    cases++;
  }
}
console.log(`PASS ${cases} disabled guest AI cases: no database or provider access, including a configured key without explicit activation.`);
