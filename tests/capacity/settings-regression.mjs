import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(process.env.DASHBOARD_SOURCE || new URL('../../dashboard.js', import.meta.url), 'utf8');
const start = source.indexOf('async function saveReservationSettings() {');
const end = source.indexOf('\n[\n  "settingDuration12"', start);
assert.ok(start >= 0 && end > start);
const code = source.slice(start, end);
const values = { settingDuration12: 90, settingDuration34: 120, settingDuration56: 150, settingDuration7Plus: 180, settingMinAdvance: 60, settingMaxAdvanceDays: 30, settingMinPeople: 1, settingMaxPeople: 20 };
const scenarios = ['success', 'manager', 'staff', 'signed-out', 'logout-fetch', 'switch-fetch', 'role-fetch', 'logout-json', 'switch-json', 'empty', 'wrong-restaurant', 'multiple', 'null', 'http-error', 'network-error'];
for (const scenario of scenarios) {
  let requests = 0, renders = 0;
  const notices = [];
  const context = vm.createContext({
    dashboardSessionVersion: 1, currentRestaurantId: 7, currentUserId: scenario === 'signed-out' ? null : 'fixture-owner', currentUserRole: scenario === 'staff' ? 'staff' : scenario === 'manager' ? 'manager' : 'owner',
    reservationSettings: { original: true }, reservationSettingsConfigured: false,
    SUPABASE_URL: 'https://fixture.invalid',
    document: { getElementById: id => ({ value: String(values[id]) }) },
    console: { error() {} }, getHeaders: x => x,
    normalizeReservationSettings: row => row,
    renderReservationSettings: () => renders++, renderSetupChecklist() {},
    showDashboardNotice: (...args) => notices.push(args),
    authorizedFetch: async (url, options) => {
      requests++;
      assert.equal(JSON.parse(options.body).restaurant_id, 7);
      if (scenario === 'network-error') throw new Error('offline fixture');
      if (scenario === 'logout-fetch') { context.dashboardSessionVersion++; context.currentUserId = null; }
      if (scenario === 'switch-fetch') context.currentRestaurantId = 8;
      if (scenario === 'role-fetch') context.currentUserRole = 'staff';
      return { ok: scenario !== 'http-error', text: async () => 'fixture error', json: async () => {
        if (scenario === 'logout-json') { context.dashboardSessionVersion++; context.currentUserId = null; }
        if (scenario === 'switch-json') context.currentRestaurantId = 8;
        if (scenario === 'empty') return [];
        if (scenario === 'null') return null;
        if (scenario === 'wrong-restaurant') return [{ restaurant_id: 8 }];
        if (scenario === 'multiple') return [{ restaurant_id: 7 }, { restaurant_id: 7 }];
        return [{ restaurant_id: 7, duration_1_2: 90 }];
      } };
    }
  });
  vm.runInContext(code, context);
  await context.saveReservationSettings();
  const success = ['success', 'manager'].includes(scenario);
  assert.equal(requests, ['staff', 'signed-out'].includes(scenario) ? 0 : 1, scenario);
  assert.equal(renders, success ? 1 : 0, scenario);
  assert.equal(context.reservationSettingsConfigured, success, scenario);
  assert.equal(notices.some(n => n[1] === 'success'), success, scenario);
  if (!success) assert.equal(context.reservationSettings.original, true, scenario);
  if (['logout-fetch','switch-fetch','role-fetch','logout-json','switch-json'].includes(scenario)) assert.equal(notices.length, 0, scenario);
}
console.log(`PASS ${scenarios.length} reservation-settings cases: roles, logout/switch during requests and malformed responses; no external calls.`);
