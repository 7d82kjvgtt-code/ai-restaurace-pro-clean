import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../script.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Booking source boundary changed; review test extraction');
  return source.slice(a, b);
}
const busy = section('function setPublicReservationSubmitting(', 'function showPublicReservationNotice(');
const submit = section('function showUnverifiedPublicReservationResult(', 'document.addEventListener("DOMContentLoaded"');
const scenarios = ['success', 'email-failed', 'invalid-success', 'network', 'unverified',
  'known-503', 'invalid-json', '500', '501', '502', '503', '504', '507', '599',
  '400', '404', '409', '429', 'disabled-time', 'double-submit'];
let cases = 0;
for (const locale of ['cs', 'en']) for (const scenario of scenarios) {
  let requests = 0, loads = 0, release;
  const notices = [];
  const values = { jmeno: 'Local', prijmeni: 'Fixture', osoby: '2', datum: '2030-01-15',
    cas: '18:00', telefon: '000000000', email: 'test@example.invalid', poznamka: 'Keep this draft' };
  const inputs = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value }]));
  const button = { disabled: false, dataset: {}, textContent: 'Submit', setAttribute() {} };
  const uncertain = ['invalid-success', 'network', 'unverified', 'invalid-json',
    '500', '501', '502', '503', '504', '507', '599'].includes(scenario);
  const status = ['known-503', 'unverified'].includes(scenario) ? 503 : Number(scenario) || 200;
  const context = vm.createContext({ Date, Number, AbortSignal,
    console: { error() {} }, PUBLIC_LOCALE: locale,
    publicText: (cs, en) => locale === 'en' ? en : cs,
    publicReservationSettingsLoaded: true,
    publicReservationSettings: { min_people: 1, max_people: 20, max_advance_days: 90 },
    publicRestaurantToday: '2030-01-01',
    localDateString: d => d.toISOString().slice(0, 10),
    addLocalDays: (d, n) => new Date(d.getTime() + n * 86400000),
    getPublicReservationDuration: () => 90,
    getPublicReservationButton: () => button,
    showPublicReservationNotice: (...args) => notices.push(args),
    requirePublicRestaurantSlug: () => 'fixture-only',
    loadAvailableReservationTimes: async () => { loads++; },
    document: { documentElement: { lang: locale }, getElementById: id => inputs[id] },
    fetch: async (url, options) => {
      requests++;
      assert.equal(url, '/api/send-email');
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).action, 'create-reservation');
      if (scenario === 'network') throw new TypeError('fixture offline');
      if (scenario === 'double-submit') await new Promise(resolve => { release = resolve; });
      return { ok: status === 200, status, json: async () => {
        if (scenario === 'invalid-json') throw new SyntaxError('fixture invalid response');
        if (scenario === 'invalid-success') return {};
        if (scenario === 'unverified') return { code: 'BOOKING_RESULT_UNVERIFIED' };
        if (scenario === 'known-503') return { code: 'BOOKING_NOT_CREATED', error: 'Fixture unavailable' };
        if (status !== 200) return { error: 'Fixture error' };
        return { success: true, reservation: { id: 99 }, email: { sent: scenario !== 'email-failed' } };
      } };
    }
  });
  vm.runInContext('let reservationSubmissionInProgress = false; let reservationResultUnverified = false;\n' + busy + submit, context);
  if (scenario === 'disabled-time') inputs.cas.disabled = true;
  const first = context.ulozitRezervaci();
  if (scenario === 'double-submit') {
    await context.ulozitRezervaci();
    assert.equal(requests, 1, 'Concurrent submission must not issue another request');
    release();
  }
  await first;
  if (scenario === 'disabled-time') {
    assert.equal(requests, 0);
    assert.equal(inputs.jmeno.value, 'Local');
  } else if (uncertain) {
    assert.equal(button.disabled, true);
    assert.equal(inputs.poznamka.value, 'Keep this draft');
    assert.equal(loads, 0);
    assert.match(notices.at(-1)[0], locale === 'en' ? /Before submitting again, contact/ : /Před dalším odesláním kontaktujte/);
    await context.ulozitRezervaci();
    assert.equal(requests, 1, 'Uncertain result must block repeat submission');
  } else {
    assert.equal(button.disabled, false);
    assert.equal(requests, 1);
    assert.equal(loads, 1);
    assert.equal(inputs.jmeno.value, status === 200 ? '' : 'Local');
  }
  cases++;
}
console.log(`PASS ${cases} current public booking cases in CZ/EN: duplicate submit, uncertain 5xx, explicit not-created response, malformed response and email delivery failure; no external calls.`);
