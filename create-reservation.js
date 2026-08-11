const SUPABASE_URL = process.env.SUPABASE_URL || "https://decpnnbaejxjbpmyjocs.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESTAURANT_ID = 1;

function send(res, status, body) {
  return res.status(status).json(body);
}

function minutes(value) {
  const [h, m] = String(value || "00:00").slice(0, 5).split(":").map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function validTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

function durationForPeople(people, settings) {
  const p = Number(people);
  if (p <= 2) return Math.max(30, Number(settings.duration_1_2 || 90));
  if (p <= 4) return Math.max(30, Number(settings.duration_3_4 || 120));
  if (p <= 6) return Math.max(30, Number(settings.duration_5_6 || 150));
  return Math.max(30, Number(settings.duration_7_plus || 180));
}

function effectiveExistingDuration(reservation, settings) {
  const stored = Number(reservation.duration_minutes || 0);
  const byPeople = durationForPeople(Number(reservation.people || 1), settings);
  return Math.max(30, Number.isFinite(stored) ? stored : 0, byPeople);
}

function overlaps(startA, durationA, startB, durationB) {
  const endA = startA + durationA;
  const endB = startB + durationB;
  return startA < endB && startB < endA;
}

async function supabase(path, options = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

async function jsonOrThrow(response, label) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) {
    throw new Error(`${label}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Použij POST." });
  }

  if (!SERVICE_ROLE_KEY) {
    return send(res, 500, { error: "Na Vercelu chybí SUPABASE_SERVICE_ROLE_KEY." });
  }

  const body = req.body || {};
  const name = String(body.name || "").trim().slice(0, 80);
  const lastName = String(body.last_name || "").trim().slice(0, 80);
  const people = Number(body.people);
  const date = String(body.date || "").trim();
  const time = String(body.time || "").trim().slice(0, 5);
  const phone = String(body.phone || "").trim().slice(0, 40);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 160);
  const note = String(body.note || "").trim().slice(0, 1000);

  if (!name || !lastName || !Number.isInteger(people) || people < 1 || people > 30 || !validDate(date) || !validTime(time) || !phone || !/^\S+@\S+\.\S+$/.test(email)) {
    return send(res, 400, { error: "Neplatné údaje rezervace." });
  }

  try {
    const settingsResponse = await supabase(`/rest/v1/reservation_settings?restaurant_id=eq.${RESTAURANT_ID}&select=*&limit=1`);
    const settingsRows = await jsonOrThrow(settingsResponse, "reservation_settings");
    const settings = settingsRows?.[0] || {};
    const duration = durationForPeople(people, settings);
    const requestedStart = minutes(time);

    // Otevírací doba + blokace se kontrolují i na serveru, ne jen v prohlížeči.
    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
    const [hoursResponse, blocksResponse] = await Promise.all([
      supabase(`/rest/v1/opening_hours?restaurant_id=eq.${RESTAURANT_ID}&day_of_week=eq.${dayOfWeek}&select=is_open,open_time,close_time&limit=1`),
      supabase(`/rest/v1/blocked_times?restaurant_id=eq.${RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&select=start_time,end_time,reason`)
    ]);
    const hoursRows = await jsonOrThrow(hoursResponse, "opening_hours");
    const blocks = await jsonOrThrow(blocksResponse, "blocked_times");
    const hours = hoursRows?.[0] || { is_open: true, open_time: "10:00:00", close_time: "22:00:00" };

    if (hours.is_open === false) {
      return send(res, 409, { error: "V tento den má restaurace zavřeno." });
    }

    const open = minutes(hours.open_time);
    const close = minutes(hours.close_time);
    if (requestedStart < open || requestedStart + duration > close) {
      return send(res, 409, { error: "Rezervace se nevejde do provozní doby." });
    }

    const blocked = (blocks || []).some(block =>
      overlaps(requestedStart, duration, minutes(block.start_time), Math.max(0, minutes(block.end_time) - minutes(block.start_time)))
    );
    if (blocked) {
      return send(res, 409, { error: "Tento čas je restaurací zablokovaný." });
    }

    const [tablesResponse, reservationsResponse] = await Promise.all([
      supabase(`/rest/v1/restaurant_tables?restaurant_id=eq.${RESTAURANT_ID}&active=eq.true&capacity=gte.${people}&select=id,name,capacity,active&order=capacity.asc,id.asc`),
      supabase(`/rest/v1/reservations?restaurant_id=eq.${RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&status=neq.${encodeURIComponent("Zrušeno")}&select=id,date,time,duration_minutes,people,table_id,status`)
    ]);

    const tables = await jsonOrThrow(tablesResponse, "restaurant_tables");
    const reservations = await jsonOrThrow(reservationsResponse, "reservations");

    if (!Array.isArray(tables) || tables.length === 0) {
      return send(res, 409, { error: "Pro tento počet hostů není žádný vhodný aktivní stůl." });
    }

    const selectedTable = tables.find(table => {
      return !(reservations || []).some(existing => {
        if (Number(existing.table_id) !== Number(table.id)) return false;
        const existingStart = minutes(existing.time);
        const existingDuration = effectiveExistingDuration(existing, settings);
        return overlaps(requestedStart, duration, existingStart, existingDuration);
      });
    });

    if (!selectedTable) {
      return send(res, 409, { error: "V tomto čase už není volný vhodný stůl. Vyber jiný čas." });
    }

    // Druhá kontrola těsně před INSERTem, aby se zmenšilo riziko souběžného obsazení.
    const finalCheckResponse = await supabase(`/rest/v1/reservations?restaurant_id=eq.${RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&table_id=eq.${selectedTable.id}&status=neq.${encodeURIComponent("Zrušeno")}&select=id,time,duration_minutes,people,table_id,status`);
    const latestOnTable = await jsonOrThrow(finalCheckResponse, "final_table_check");
    const conflictNow = (latestOnTable || []).some(existing =>
      overlaps(requestedStart, duration, minutes(existing.time), effectiveExistingDuration(existing, settings))
    );

    if (conflictNow) {
      return send(res, 409, { error: `${selectedTable.name} byl právě obsazen. Zkus rezervaci znovu.` });
    }

    const payload = {
      name,
      last_name: lastName,
      people,
      date,
      time,
      duration_minutes: duration,
      table_id: Number(selectedTable.id),
      phone,
      email,
      note,
      status: "Čeká",
      restaurant_id: RESTAURANT_ID
    };

    const insertResponse = await supabase(`/rest/v1/reservations`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });
    const inserted = await jsonOrThrow(insertResponse, "insert_reservation");

    return send(res, 200, {
      ok: true,
      reservation: Array.isArray(inserted) ? inserted[0] : inserted,
      table: {
        id: Number(selectedTable.id),
        name: selectedTable.name,
        capacity: Number(selectedTable.capacity)
      },
      duration_minutes: duration
    });
  } catch (error) {
    console.error("create-reservation error", error);
    return send(res, 500, { error: "Rezervaci se nepodařilo uložit.", detail: String(error.message || error) });
  }
};
