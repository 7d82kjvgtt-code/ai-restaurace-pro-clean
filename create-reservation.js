const SUPABASE_URL = process.env.SUPABASE_URL || 'https://decpnnbaejxjbpmyjocs.supabase.co';
const PUBLIC_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const API_KEY = SERVICE_ROLE_KEY || PUBLIC_KEY;
const RESTAURANT_ID = 1;

function send(res, status, body) {
  res.status(status).json(body);
}

function headers(extra = {}) {
  return {
    apikey: API_KEY,
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function sb(path, options = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: headers(options.headers || {})
  });
}

function toMinutes(value) {
  const [h, m] = String(value || '00:00').slice(0, 5).split(':').map(Number);
  return (h * 60) + m;
}

function durationForPeople(people, settings) {
  const n = Number(people || 1);
  if (n <= 2) return Math.max(30, Number(settings.duration_1_2 || 90));
  if (n <= 4) return Math.max(30, Number(settings.duration_3_4 || 120));
  if (n <= 6) return Math.max(30, Number(settings.duration_5_6 || 150));
  return Math.max(30, Number(settings.duration_7_plus || 180));
}

function overlaps(aStart, aDuration, bStart, bDuration) {
  const a1 = toMinutes(aStart);
  const a2 = a1 + Number(aDuration || 0);
  const b1 = toMinutes(bStart);
  const b2 = b1 + Number(bDuration || 0);
  return a1 < b2 && b1 < a2;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Použij POST.' });
  }

  try {
    const name = String(req.body?.name || '').trim();
    const lastName = String(req.body?.last_name || '').trim();
    const people = Number(req.body?.people || 0);
    const date = String(req.body?.date || '').trim();
    const time = String(req.body?.time || '').trim().slice(0, 5);
    const phone = String(req.body?.phone || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const note = String(req.body?.note || '').trim();

    if (!name || !lastName || !Number.isInteger(people) || people < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return send(res, 400, { error: 'Neplatné údaje rezervace.' });
    }

    const settingsResponse = await sb(`/rest/v1/reservation_settings?restaurant_id=eq.${RESTAURANT_ID}&select=duration_1_2,duration_3_4,duration_5_6,duration_7_plus&limit=1`);
    const settingsRows = settingsResponse.ok ? await settingsResponse.json() : [];
    const settings = settingsRows[0] || {};
    const newDuration = durationForPeople(people, settings);

    const tablesResponse = await sb(
      `/rest/v1/restaurant_tables?restaurant_id=eq.${RESTAURANT_ID}&active=eq.true&capacity=gte.${people}&select=id,name,capacity&order=capacity.asc,id.asc`
    );
    if (!tablesResponse.ok) {
      return send(res, 500, { error: `Nepodařilo se načíst stoly: ${await tablesResponse.text()}` });
    }

    const reservationsResponse = await sb(
      `/rest/v1/reservations?restaurant_id=eq.${RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&status=neq.${encodeURIComponent('Zrušeno')}&select=id,time,duration_minutes,people,table_id,status`
    );
    if (!reservationsResponse.ok) {
      return send(res, 500, { error: `Nepodařilo se načíst rezervace: ${await reservationsResponse.text()}` });
    }

    const tables = await tablesResponse.json();
    const reservations = await reservationsResponse.json();

    const freeTable = tables.find((table) => {
      return !reservations.some((r) => {
        if (Number(r.table_id) !== Number(table.id)) return false;
        const stored = Number(r.duration_minutes || 0);
        const byPeople = durationForPeople(Number(r.people || 1), settings);
        const existingDuration = Math.max(30, stored || 0, byPeople || 0);
        return overlaps(time, newDuration, String(r.time || '').slice(0, 5), existingDuration);
      });
    });

    if (!freeTable) {
      return send(res, 409, { error: 'V tomto čase už není volný vhodný stůl. Vyber jiný čas.' });
    }

    // Poslední kontrola těsně před zápisem.
    const finalCheckResponse = await sb(
      `/rest/v1/reservations?restaurant_id=eq.${RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&table_id=eq.${Number(freeTable.id)}&status=neq.${encodeURIComponent('Zrušeno')}&select=id,time,duration_minutes,people,table_id`
    );
    if (!finalCheckResponse.ok) {
      return send(res, 500, { error: `Nepodařilo se ověřit stůl: ${await finalCheckResponse.text()}` });
    }
    const finalRows = await finalCheckResponse.json();
    const conflict = finalRows.some((r) => {
      const stored = Number(r.duration_minutes || 0);
      const byPeople = durationForPeople(Number(r.people || 1), settings);
      const existingDuration = Math.max(30, stored || 0, byPeople || 0);
      return overlaps(time, newDuration, String(r.time || '').slice(0, 5), existingDuration);
    });
    if (conflict) {
      return send(res, 409, { error: 'Vybraný stůl byl mezitím obsazen. Zkus rezervaci znovu.' });
    }

    const insertResponse = await sb('/rest/v1/reservations', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        name,
        last_name: lastName,
        people,
        date,
        time,
        duration_minutes: newDuration,
        table_id: Number(freeTable.id),
        phone,
        email,
        note,
        status: 'Čeká',
        restaurant_id: RESTAURANT_ID
      })
    });

    const insertText = await insertResponse.text();
    if (!insertResponse.ok) {
      return send(res, insertResponse.status || 500, { error: `Uložení do databáze selhalo: ${insertText}` });
    }

    let inserted = null;
    try { inserted = JSON.parse(insertText)?.[0] || null; } catch (_) {}

    return send(res, 200, {
      ok: true,
      reservation: inserted,
      table: { id: Number(freeTable.id), name: freeTable.name, capacity: Number(freeTable.capacity) },
      duration_minutes: newDuration,
      used_service_role: Boolean(SERVICE_ROLE_KEY)
    });
  } catch (error) {
    console.error('create-reservation error:', error);
    return send(res, 500, { error: `Serverová chyba rezervace: ${error.message || String(error)}` });
  }
};
