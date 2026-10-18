import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Run the real handler; all transport is intercepted. No production reads or writes.
const source = fs.readFileSync(new URL('../../api/send-email.js', import.meta.url), 'utf8');
let calls = 0;
let foreignTenant = false;
let membershipChecks = 0;
let reservationReads = 0;
const context = vm.createContext({
  createHash, URL, URLSearchParams, Date, Intl, AbortSignal, performance,
  process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'local-fixture-only' } },
  console: { error() {}, log() {}, warn() {} },
  fetch: async (raw, options = {}) => {
    calls++;
    const url = new URL(raw);
    assert.equal(url.hostname, 'decpnnbaejxjbpmyjocs.supabase.co');
    if (foreignTenant) {
      assert.equal(options.method || 'GET', 'GET', 'Forbidden mutation attempted');
      if (url.pathname === '/auth/v1/user') {
        assert.equal(options.headers.Authorization, 'Bearer foreign-fixture-token');
        return { ok: true, status: 200, json: async () => ({ id: 'fixture-owner-of-other-restaurant' }) };
      }
      let data;
      if (url.pathname === '/rest/v1/restaurant_team') {
        membershipChecks++;
        assert.equal(url.searchParams.get('restaurant_id'), 'eq.2');
        assert.equal(url.searchParams.get('user_id'), 'eq.fixture-owner-of-other-restaurant');
        assert.equal(url.searchParams.get('active'), 'eq.true');
        data = [];
      } else if (url.pathname === '/rest/v1/reservations') {
        reservationReads++;
        assert.equal(url.searchParams.get('id'), 'eq.1');
        data = [{ id: 1, restaurant_id: 2, status: 'Potvrzeno', row_revision: 0,
          status_revision: 1, name: 'PRIVATE-GUEST-MARKER', email: 'private-guest@example.invalid' }];
      } else {
        assert.fail('Foreign tenant access reached unexpected data or email transport: ' + url.pathname);
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    }
    assert.equal(url.pathname, '/auth/v1/user', 'Unauthenticated access reached database or email transport');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer rejected-fixture-token');
    return { ok: false, status: 401, json: async () => ({ message: 'fixture invalid token' }) };
  }
});
vm.runInContext(source.replace('import { createHash } from "node:crypto";', '')
  .replace('export default async function handler', 'async function handler') + '\nthis.testHandler = handler;', context);

let cases = 0;
async function request(method, body, headers = {}) {
  let status = 200, result;
  const responseHeaders = {};
  const response = {
    setHeader(key, value) { responseHeaders[key] = value; },
    status(value) { status = value; return this; },
    json(value) { result = value; return this; }
  };
  await context.testHandler({ method, body, headers }, response);
  assert.equal(responseHeaders['Cache-Control'], 'no-store');
  assert.ok(result && typeof result.error === 'string');
  cases++;
  return { status, responseHeaders, result };
}

for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
  const result = await request(method, { action: 'create-reservation' });
  assert.equal(result.status, 405);
  assert.equal(result.responseHeaders.Allow, 'POST');
}
for (const body of [undefined, null, {}, { action: 'unknown' }]) {
  assert.equal((await request('POST', body)).status, 400);
}
assert.equal(calls, 0);

const fields = {
  restaurant_id: 1, reservation_id: 1, expected_revision: 0,
  status_revision: 1, name: 'Local fixture', people: 2,
  date: '2030-01-15', time: '18:00', duration_minutes: 90,
  table_id: 1, status: 'Potvrzeno'
};
const actions = [
  'dashboard-restaurant-info', 'create-dashboard-reservation',
  'update-reservation', 'update-reservation-status',
  'pending-status-emails', 'retry-reservation-status-email'
];
for (const action of actions) {
  const before = calls;
  assert.equal((await request('POST', { ...fields, action })).status, 401, action);
  assert.equal(calls, before, `${action}: missing token must fail before transport`);
  assert.equal((await request('POST', { ...fields, action }, {
    authorization: 'Bearer rejected-fixture-token'
  })).status, 401, action);
  assert.equal(calls, before + 1, `${action}: invalid token must stop at identity validation`);
}
foreignTenant = true;
for (const action of actions) {
  const beforeMembership = membershipChecks;
  const beforeReads = reservationReads;
  const usesReservation = ['update-reservation', 'update-reservation-status', 'retry-reservation-status-email'].includes(action);
  // Supplying a different body restaurant_id must not override the reservation's true tenant.
  const response = await request('POST', {
    ...fields, restaurant_id: usesReservation ? 1 : 2, action
  }, { authorization: 'Bearer foreign-fixture-token' });
  assert.equal(response.status, 403, action + ': authenticated foreign owner must be rejected');
  assert.equal(membershipChecks, beforeMembership + 1, action + ': verify target membership');
  assert.equal(reservationReads, beforeReads + (usesReservation ? 1 : 0));
  assert.doesNotMatch(JSON.stringify(response.result), /PRIVATE-GUEST-MARKER|private-guest@example/);
  assert.deepEqual(Object.keys(response.result), ['error'], action + ': do not return private records');
}
console.log(`PASS ${cases} real-handler boundary cases: method enforcement, unknown actions, six private routes reject missing/invalid credentials and authenticated foreign owners; no external calls, mutations or emails.`);
