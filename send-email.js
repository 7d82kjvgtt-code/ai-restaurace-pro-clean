const RESEND_API_URL = "https://api.resend.com/emails";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://decpnnbaejxjbpmyjocs.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_RESTAURANT_ID = 1;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(date) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}.${month}.${year}` : date;
}

function supabaseHeaders(extra = {}) {
  if (!SERVICE_ROLE_KEY) return null;
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function supabaseJson(path, options = {}) {
  const headers = supabaseHeaders(options.headers || {});
  if (!headers) {
    throw new Error("Ve Vercelu chybí SUPABASE_SERVICE_ROLE_KEY.");
  }

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof data === "string"
        ? data
        : data?.message || data?.error || `Supabase chyba ${response.status}`
    );
  }

  return data;
}

function timeToMinutes(value) {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return (Number(h) * 60) + Number(m);
}

function getDurationByPeople(people, settings = {}) {
  const count = Number(people || 1);
  if (count <= 2) return Math.max(30, Number(settings.duration_1_2 || 90));
  if (count <= 4) return Math.max(30, Number(settings.duration_3_4 || 90));
  if (count <= 6) return Math.max(30, Number(settings.duration_5_6 || 150));
  return Math.max(30, Number(settings.duration_7_plus || 180));
}

function effectiveDuration(reservation, settings) {
  const stored = Number(reservation?.duration_minutes || 0);
  const byPeople = getDurationByPeople(reservation?.people, settings);
  return Math.max(30, Number.isFinite(stored) ? stored : 0, byPeople);
}

function overlaps(a, b, settings) {
  if (String(a.date) !== String(b.date)) return false;
  const aStart = timeToMinutes(a.time);
  const bStart = timeToMinutes(b.time);
  const aEnd = aStart + effectiveDuration(a, settings);
  const bEnd = bStart + effectiveDuration(b, settings);
  return aStart < bEnd && bStart < aEnd;
}

async function createReservationOnServer(req, res) {
  const {
    name = "",
    last_name = "",
    people,
    date = "",
    time = "",
    phone = "",
    email = "",
    note = ""
  } = req.body || {};

  const cleanName = String(name).trim();
  const cleanLastName = String(last_name).trim();
  const cleanPhone = String(phone).trim();
  const cleanEmail = String(email).trim();
  const peopleNumber = Number(people);

  if (
    !cleanName || !cleanLastName || !date || !time || !cleanPhone ||
    !Number.isInteger(peopleNumber) || peopleNumber < 1
  ) {
    return res.status(400).json({ error: "Chybí povinné údaje rezervace." });
  }

  try {
    const settingsRows = await supabaseJson(
      `/rest/v1/reservation_settings?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&select=*`,
      { method: "GET" }
    );
    const settings = Array.isArray(settingsRows) && settingsRows[0] ? settingsRows[0] : {};
    const durationMinutes = getDurationByPeople(peopleNumber, settings);

    const [tables, tableGroups] = await Promise.all([
      supabaseJson(
        `/rest/v1/restaurant_tables?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&active=eq.true&select=id,name,capacity,active,room&order=capacity.asc,id.asc`,
        { method: "GET" }
      ),
      supabaseJson(
        `/rest/v1/table_groups?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&select=id,name,table_ids,total_capacity,room&order=total_capacity.asc,id.asc`,
        { method: "GET" }
      )
    ]);

    const singleCandidates = (Array.isArray(tables) ? tables : [])
      .filter(table => Number(table.capacity) >= peopleNumber);
    const groupCandidates = (Array.isArray(tableGroups) ? tableGroups : [])
      .filter(group =>
        Number(group.total_capacity) >= peopleNumber &&
        Array.isArray(group.table_ids) &&
        group.table_ids.length >= 2
      );

    if (!singleCandidates.length && !groupCandidates.length) {
      return res.status(409).json({
        error: "Pro tento počet hostů není žádný vhodný aktivní stůl ani povolená skupina stolů."
      });
    }

    const reservations = await supabaseJson(
      `/rest/v1/reservations?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&status=neq.${encodeURIComponent("Zrušeno")}&select=id,date,time,duration_minutes,people,table_id,table_group_id,status`,
      { method: "GET" }
    );

    const draft = {
      date,
      time,
      people: peopleNumber,
      duration_minutes: durationMinutes
    };

    const groupById = new Map((Array.isArray(tableGroups) ? tableGroups : []).map(group => [Number(group.id), group]));

    function occupiedTableIds(rows) {
      const occupied = new Set();
      (Array.isArray(rows) ? rows : []).forEach(existing => {
        if (!overlaps(draft, existing, settings)) return;
        if (existing.table_group_id) {
          const existingGroup = groupById.get(Number(existing.table_group_id));
          (Array.isArray(existingGroup?.table_ids) ? existingGroup.table_ids : [])
            .forEach(id => occupied.add(Number(id)));
        } else if (existing.table_id) {
          occupied.add(Number(existing.table_id));
        }
      });
      return occupied;
    }

    const occupied = occupiedTableIds(reservations);
    const selectedTable = singleCandidates.find(table => !occupied.has(Number(table.id))) || null;
    const selectedGroup = !selectedTable
      ? groupCandidates.find(group => group.table_ids.map(Number).every(id => !occupied.has(id))) || null
      : null;

    if (!selectedTable && !selectedGroup) {
      return res.status(409).json({
        error: "V tomto čase není volný vhodný stůl ani povolená skupina stolů. Vyber jiný čas."
      });
    }

    // Poslední kontrola těsně před uložením – znovu načteme všechny rezervace,
    // protože skupina může kolidovat i s rezervací na jednom z jejích stolů.
    const latestReservations = await supabaseJson(
      `/rest/v1/reservations?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&status=neq.${encodeURIComponent("Zrušeno")}&select=id,date,time,duration_minutes,people,table_id,table_group_id,status`,
      { method: "GET" }
    );
    const latestOccupied = occupiedTableIds(latestReservations);
    const chosenIds = selectedTable
      ? [Number(selectedTable.id)]
      : selectedGroup.table_ids.map(Number);

    if (chosenIds.some(id => latestOccupied.has(id))) {
      return res.status(409).json({
        error: `${selectedTable ? selectedTable.name : selectedGroup.name} byl mezitím obsazen. Vyber jiný čas.`
      });
    }

    const inserted = await supabaseJson(
      "/rest/v1/reservations",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          restaurant_id: PUBLIC_RESTAURANT_ID,
          name: cleanName,
          last_name: cleanLastName,
          people: peopleNumber,
          date,
          time,
          duration_minutes: durationMinutes,
          table_id: selectedTable ? Number(selectedTable.id) : null,
          table_group_id: selectedGroup ? Number(selectedGroup.id) : null,
          phone: cleanPhone,
          email: cleanEmail,
          note: String(note || "").trim(),
          status: "Čeká"
        })
      }
    );

    return res.status(200).json({
      success: true,
      reservation: Array.isArray(inserted) ? inserted[0] : inserted,
      table: selectedTable ? {
        id: Number(selectedTable.id),
        name: selectedTable.name,
        capacity: Number(selectedTable.capacity),
        type: "table"
      } : {
        id: Number(selectedGroup.id),
        name: selectedGroup.name,
        capacity: Number(selectedGroup.total_capacity),
        table_ids: selectedGroup.table_ids.map(Number),
        type: "group"
      }
    });
  } catch (error) {
    console.error("Chyba při vytvoření rezervace:", error);
    return res.status(500).json({
      error: error.message || "Rezervaci se nepodařilo uložit."
    });
  }
}

async function sendResendEmail({ to, subject, html, replyTo }) {
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || "Restaurace <onboarding@resend.dev>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || "Resend odmítl odeslání e-mailu.");
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Povolena je pouze metoda POST." });
  }

  // DŮLEŽITÉ: rezervace se zpracuje DŘÍV než jakákoli kontrola Resendu.
  if (req.body?.action === "create-reservation") {
    return createReservationOnServer(req, res);
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: "Ve Vercelu chybí proměnná RESEND_API_KEY." });
  }

  const {
    name = "",
    people = "",
    date = "",
    time = "",
    phone = "",
    email = "",
    note = ""
  } = req.body || {};

  const cleanEmail = String(email).trim();

  if (
    !name || !people || !date || !time || !phone ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
  ) {
    return res.status(400).json({ error: "Chybí údaje rezervace nebo je neplatný e-mail." });
  }

  const safe = {
    name: escapeHtml(name),
    people: escapeHtml(people),
    date: escapeHtml(formatDate(date)),
    time: escapeHtml(time),
    phone: escapeHtml(phone),
    email: escapeHtml(cleanEmail),
    note: escapeHtml(note || "Bez poznámky")
  };

  const customerHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
      <div style="background:#111827;color:#ffffff;padding:24px;text-align:center">
        <h1 style="margin:0;font-size:26px">Potvrzení rezervace</h1>
      </div>
      <div style="padding:28px;color:#1f2937">
        <p>Dobrý den, <strong>${safe.name}</strong>,</p>
        <p>děkujeme za rezervaci. Vaši rezervaci jsme přijali a nyní čeká na potvrzení restaurací.</p>
        <div style="background:#f9fafb;border-radius:12px;padding:18px;margin:22px 0">
          <p style="margin:7px 0"><strong>Datum:</strong> ${safe.date}</p>
          <p style="margin:7px 0"><strong>Čas:</strong> ${safe.time}</p>
          <p style="margin:7px 0"><strong>Počet osob:</strong> ${safe.people}</p>
          <p style="margin:7px 0"><strong>Telefon:</strong> ${safe.phone}</p>
          <p style="margin:7px 0"><strong>Poznámka:</strong> ${safe.note}</p>
        </div>
        <p>V případě změny nás prosím kontaktujte.</p>
        <p style="margin-bottom:0">Těšíme se na vaši návštěvu.</p>
      </div>
    </div>
  `;

  const restaurantHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h1>Nová rezervace</h1>
      <p><strong>Jméno:</strong> ${safe.name}</p>
      <p><strong>Počet osob:</strong> ${safe.people}</p>
      <p><strong>Datum:</strong> ${safe.date}</p>
      <p><strong>Čas:</strong> ${safe.time}</p>
      <p><strong>Telefon:</strong> ${safe.phone}</p>
      <p><strong>E-mail:</strong> ${safe.email}</p>
      <p><strong>Poznámka:</strong> ${safe.note}</p>
    </div>
  `;

  try {
    const customerResult = await sendResendEmail({
      to: cleanEmail,
      subject: `Rezervace na ${safe.date} v ${safe.time}`,
      html: customerHtml
    });

    let restaurantResult = null;
    const restaurantEmail = process.env.RESTAURANT_EMAIL?.trim();

    if (restaurantEmail) {
      restaurantResult = await sendResendEmail({
        to: restaurantEmail,
        subject: `Nová rezervace – ${safe.name}, ${safe.date} ${safe.time}`,
        html: restaurantHtml,
        replyTo: cleanEmail
      });
    }

    return res.status(200).json({
      success: true,
      customerEmailId: customerResult?.id || null,
      restaurantEmailId: restaurantResult?.id || null,
      restaurantNotificationSkipped: !restaurantEmail
    });
  } catch (error) {
    console.error("Chyba při odesílání e-mailu:", error);
    return res.status(500).json({ error: error.message || "E-mail se nepodařilo odeslat." });
  }
}
