import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../api/invite-team-member.js', import.meta.url), 'utf8');
const ownerId = '10000000-0000-4000-8000-000000000001';
const inviteeId = '20000000-0000-4000-8000-000000000002';
const scenarios = [
  ['missing-token', 401], ['invalid-token', 401], ['manager', 403], ['staff', 403],
  ['no-membership', 403], ['multiple-memberships', 409], ['foreign-invitee', 409],
  ['active-invalid-json', 500], ['active-object', 500], ['active-null-row', 500],
  ['active-invalid-id', 500], ['existing-object', 500], ['existing-invalid-id', 500],
  ['existing-active-owner', 409], ['forbidden-owner-role', 400], ['valid', 200]
];
for (const [scenario, expectedStatus] of scenarios) {
  let writes = 0, status = 200, result;
  const jsonResponse = data => ({ ok: true, status: 200,
    json: async () => data, text: async () => JSON.stringify(data) });
  const context = vm.createContext({ URL, Date, module: { exports: {} },
    process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', APP_URL: 'https://fixture.example.invalid' } },
    console: { error() {} },
    fetch: async (raw, options = {}) => {
      const url = new URL(raw);
      assert.equal(url.hostname, 'decpnnbaejxjbpmyjocs.supabase.co');
      const method = options.method || 'GET';
      if (method !== 'GET') {
        writes++;
        assert.equal(scenario, 'valid', 'Rejected invitation attempted a mutation/email');
        const body = JSON.parse(options.body);
        if (url.pathname === '/auth/v1/invite') {
          assert.equal(url.searchParams.get('redirect_to'), 'https://fixture.example.invalid/invite.html');
          assert.equal(body.data.restaurant_id, 2, 'Body tenant must not override owner context');
          assert.equal(body.data.role, 'staff');
          return jsonResponse({ id: inviteeId });
        }
        assert.equal(url.pathname, '/rest/v1/restaurant_team');
        assert.equal(body.restaurant_id, 2);
        assert.equal(body.user_id, inviteeId);
        return jsonResponse([{ restaurant_id: 2, user_id: inviteeId }]);
      }
      if (url.pathname === '/auth/v1/user') {
        return scenario === 'invalid-token'
          ? { ok: false, status: 401 }
          : jsonResponse({ id: ownerId });
      }
      assert.equal(url.pathname, '/rest/v1/restaurant_team');
      if (url.searchParams.has('user_id')) {
        assert.equal(url.searchParams.get('user_id'), `eq.${ownerId}`);
        assert.equal(url.searchParams.get('active'), 'eq.true');
        if (scenario === 'no-membership') return jsonResponse([]);
        if (scenario === 'multiple-memberships') return jsonResponse([{ restaurant_id: 2, role: 'owner' }, { restaurant_id: 3, role: 'owner' }]);
        return jsonResponse([{ restaurant_id: 2, role: ['staff', 'manager'].includes(scenario) ? scenario : 'owner' }]);
      }
      if (!url.searchParams.has('restaurant_id')) {
        assert.equal(url.searchParams.get('active'), 'eq.true');
        if (scenario === 'active-invalid-json') return { ok: true, json: async () => { throw new SyntaxError('fixture'); } };
        if (scenario === 'active-object') return jsonResponse({ unexpected: true });
        if (scenario === 'active-null-row') return jsonResponse([null]);
        if (scenario === 'active-invalid-id') return jsonResponse([{ restaurant_id: 'invalid' }]);
        return jsonResponse(scenario === 'foreign-invitee' ? [{ restaurant_id: 3 }] : []);
      }
      assert.equal(url.searchParams.get('restaurant_id'), 'eq.2');
      if (scenario === 'existing-object') return jsonResponse({ unexpected: true });
      if (scenario === 'existing-invalid-id') return jsonResponse([{ id: 'invalid', active: false, role: 'staff' }]);
      if (scenario === 'existing-active-owner') return jsonResponse([{ id: 7, active: true, role: 'owner' }]);
      return jsonResponse([]);
    }
  });
  vm.runInContext(source, context);
  const headers = {};
  const response = { setHeader(k, v) { headers[k] = v; }, status(n) { status = n; return this; }, json(v) { result = v; return this; } };
  await context.module.exports({ method: 'POST',
    headers: scenario === 'missing-token' ? {} : { authorization: 'Bearer local-fixture-token', host: 'attacker.example.invalid' },
    body: { full_name: 'Local fixture', email: 'test@example.invalid', restaurant_id: 999,
      role: scenario === 'forbidden-owner-role' ? 'owner' : 'staff' }
  }, response);
  assert.equal(status, expectedStatus, scenario);
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(writes, scenario === 'valid' ? 2 : 0, scenario);
  if (scenario === 'valid') assert.equal(result.ok, true);
  else assert.equal(typeof result.error, 'string');
}
console.log(`PASS ${scenarios.length} invitation cases: owner-only access, tenant scoping, safe redirect and malformed membership responses; transport fully mocked, no invitations sent.`);
