const RESEND_API_URL = "https://api.resend.com/emails";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://decpnnbaejxjbpmyjocs.supabase.co";

const SUPABASE_PUBLIC_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const RESTAURANT_TIME_ZONE =
  process.env.RESTAURANT_TIME_ZONE || "Europe/Prague";


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


function cleanSlug(value) {
  return String(value || "").trim();
}


function serviceHeaders(extra = {}) {
  if (!SERVICE_ROLE_KEY) {
    throw new Error("Ve Vercelu chybí SUPABASE_SERVICE_ROLE_KEY.");
  }

  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}


function publicHeaders(extra = {}) {
  return {
    apikey: SUPABASE_PUBLIC_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLIC_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}


async function supabaseServiceJson(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: serviceHeaders(options.headers || {})
  });

  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      typeof data === "string"
        ? data
        : data?.message ||
          data?.error ||
          data?.hint ||
          `Supabase chyba ${response.status}`
    );

    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}


async function supabasePublicRpc(functionName, body) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      headers: publicHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(body)
    }
  );

  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      typeof data === "string"
        ? data
        : data?.message ||
          data?.error ||
          data?.hint ||
          `Supabase RPC chyba ${response.status}`
    );

    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}


async function getPublishedRestaurantBySlug(slug) {
  const clean = cleanSlug(slug);

  if (!clean) {
    throw new Error("V požadavku chybí slug restaurace.");
  }

  const rows = await supabaseServiceJson(
    `/rest/v1/restaurants?slug=eq.${encodeURIComponent(clean)}&is_published=eq.true&select=id,name,slug&limit=1`,
    { method: "GET" }
  );

  const restaurant = Array.isArray(rows) ? rows[0] : null;

  if (!restaurant?.id) {
    const error = new Error("Restaurace neexistuje nebo není zveřejněná.");
    error.status = 404;
    throw error;
  }

  return restaurant;
}


function timeToMinutes(value) {
  const [h, m] = String(value || "00:00").slice(0, 5).split(":").map(Number);
  return (Number(h) * 60) + Number(m);
}


function getRestaurantNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RESTAURANT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: (Number(values.hour) * 60) + Number(values.minute)
  };
}


function getDurationByPeople(people, settings = {}) {
  const count = Number(people || 1);

  if (count <= 2) {
    return Math.max(30, Number(settings.duration_1_2 || 90));
  }

  if (count <= 4) {
    return Math.max(30, Number(settings.duration_3_4 || 90));
  }

  if (count <= 6) {
    return Math.max(30, Number(settings.duration_5_6 || 150));
  }

  return Math.max(30, Number(settings.duration_7_plus || 180));
}


function effectiveDuration(reservation, settings) {
  const stored = Number(reservation?.duration_minutes || 0);
  const byPeople = getDurationByPeople(reservation?.people, settings);

  return Math.max(
    30,
    Number.isFinite(stored) ? stored : 0,
    byPeople
  );
}


function overlaps(a, b, settings) {
  if (String(a.date) !== String(b.date)) return false;

  const aStart = timeToMinutes(a.time);
  const bStart = timeToMinutes(b.time);

  const aEnd = aStart + effectiveDuration(a, settings);
  const bEnd = bStart + effectiveDuration(b, settings);

  return aStart < bEnd && bStart < aEnd;
}


function mapReservationError(error) {
  const message = String(error?.message || "");

  if (
    message.includes("již rezervovan") ||
    message.includes("blokovaný") ||
    message.includes("zavřená") ||
    message.includes("minimální předstih") ||
    message.includes("příliš daleko") ||
    message.includes("Neplatný počet hostů") ||
    message.includes("Stůl neexistuje") ||
    message.includes("Skupina stolů neexistuje")
  ) {
    return 409;
  }

  if (
    message.includes("Jméno je povinné") ||
    message.includes("Neplatný formát času") ||
    message.includes("Je nutný telefon nebo e-mail") ||
    message.includes("Nelze současně vybrat")
  ) {
    return 400;
  }

  if (
    message.includes("Restaurace neexistuje") ||
    message.includes("není zveřejněná")
  ) {
    return 404;
  }

  return Number(error?.status) >= 400 && Number(error?.status) < 500
    ? Number(error.status)
    : 500;
}


async function getAvailableTimesOnServer(req, res) {
  const {
    slug = "",
    people,
    date = ""
  } = req.body || {};

  const cleanRestaurantSlug = cleanSlug(slug);
  const peopleNumber = Number(people);

  if (
    !cleanRestaurantSlug ||
    !date ||
    !Number.isInteger(peopleNumber) ||
    peopleNumber < 1
  ) {
    return res.status(400).json({
      error: "Chybí restaurace, datum nebo platný počet osob."
    });
  }

  try {
    const restaurant = await getPublishedRestaurantBySlug(cleanRestaurantSlug);
    const restaurantId = Number(restaurant.id);

    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();

    const [
      settingsRows,
      hoursRows,
      blocks,
      tables,
      tableGroups,
      reservations
    ] = await Promise.all([
      supabaseServiceJson(
        `/rest/v1/reservation_settings?restaurant_id=eq.${restaurantId}&select=*`,
        { method: "GET" }
      ),
      supabaseServiceJson(
        `/rest/v1/opening_hours?restaurant_id=eq.${restaurantId}&day_of_week=eq.${dayOfWeek}&select=is_open,open_time,close_time`,
        { method: "GET" }
      ),
      supabaseServiceJson(
        `/rest/v1/blocked_times?restaurant_id=eq.${restaurantId}&date=eq.${encodeURIComponent(date)}&select=start_time,end_time,reason`,
        { method: "GET" }
      ),
      supabaseServiceJson(
        `/rest/v1/restaurant_tables?restaurant_id=eq.${restaurantId}&active=eq.true&select=id,name,capacity,active,room&order=capacity.asc,id.asc`,
        { method: "GET" }
      ),
      supabaseServiceJson(
        `/rest/v1/table_groups?restaurant_id=eq.${restaurantId}&select=id,name,table_ids,total_capacity,room&order=total_capacity.asc,id.asc`,
        { method: "GET" }
      ),
      supabaseServiceJson(
        `/rest/v1/reservations?restaurant_id=eq.${restaurantId}&date=eq.${encodeURIComponent(date)}&status=neq.${encodeURIComponent("Zrušeno")}&select=id,date,time,duration_minutes,people,table_id,table_group_id,status`,
        { method: "GET" }
      )
    ]);

    const settings =
      Array.isArray(settingsRows) && settingsRows[0]
        ? settingsRows[0]
        : {};

    const hours =
      Array.isArray(hoursRows) && hoursRows[0]
        ? hoursRows[0]
        : null;

    if (!hours || !hours.is_open) {
      return res.status(200).json({
        success: true,
        slots: [],
        message: "V tento den má restaurace zavřeno."
      });
    }

    const minPeople = Math.max(1, Number(settings.min_people || 1));
    const maxPeople = Math.max(
      minPeople,
      Number(settings.max_people || 20)
    );

    if (
      peopleNumber < minPeople ||
      peopleNumber > maxPeople
    ) {
      return res.status(400).json({
        error: `Počet osob musí být od ${minPeople} do ${maxPeople}.`
      });
    }

    const duration = getDurationByPeople(peopleNumber, settings);

    const minAdvanceMinutes = Math.max(
      0,
      Number(settings.min_advance_minutes ?? 60)
    );

    const maxAdvanceDays = Math.max(
      1,
      Number(settings.max_advance_days || 30)
    );

    const restaurantNowForDateLimit = getRestaurantNow();

    const maxAllowedDate = new Date(
      `${restaurantNowForDateLimit.date}T12:00:00`
    );

    maxAllowedDate.setDate(
      maxAllowedDate.getDate() + maxAdvanceDays
    );

    const maxAllowedDateString = [
      maxAllowedDate.getFullYear(),
      String(maxAllowedDate.getMonth() + 1).padStart(2, "0"),
      String(maxAllowedDate.getDate()).padStart(2, "0")
    ].join("-");

    if (date > maxAllowedDateString) {
      return res.status(400).json({
        error: `Rezervaci lze vytvořit maximálně ${maxAdvanceDays} dní dopředu.`
      });
    }

    const singleCandidates =
      (Array.isArray(tables) ? tables : [])
        .filter(table =>
          Number(table.capacity) >= peopleNumber
        );

    const groupCandidates =
      (Array.isArray(tableGroups) ? tableGroups : [])
        .filter(group =>
          Number(group.total_capacity) >= peopleNumber &&
          Array.isArray(group.table_ids) &&
          group.table_ids.length >= 2
        );

    if (!singleCandidates.length && !groupCandidates.length) {
      return res.status(200).json({
        success: true,
        slots: [],
        message:
          `Pro ${peopleNumber} osob není k dispozici vhodný stůl ani povolená skupina stolů.`
      });
    }

    const groupById = new Map(
      (Array.isArray(tableGroups) ? tableGroups : [])
        .map(group => [Number(group.id), group])
    );

    const openMinutes = timeToMinutes(hours.open_time);
    const closeMinutes = timeToMinutes(hours.close_time);

    const restaurantNow = getRestaurantNow();
    const slots = [];

    for (
      let start = openMinutes;
      start + duration <= closeMinutes;
      start += 30
    ) {
      const slotTime =
        `${String(Math.floor(start / 60)).padStart(2, "0")}:` +
        `${String(start % 60).padStart(2, "0")}`;

      if (date < restaurantNow.date) continue;

      if (
        date === restaurantNow.date &&
        start < (restaurantNow.minutes + minAdvanceMinutes)
      ) {
        continue;
      }

      const end = start + duration;

      const blocked =
        (Array.isArray(blocks) ? blocks : [])
          .some(block => {
            const blockStart = timeToMinutes(block.start_time);
            const blockEnd = timeToMinutes(block.end_time);

            return start < blockEnd && blockStart < end;
          });

      if (blocked) continue;

      const draft = {
        date,
        time: slotTime,
        people: peopleNumber,
        duration_minutes: duration
      };

      const occupiedIds = new Set();

      (Array.isArray(reservations) ? reservations : [])
        .forEach(existing => {
          if (!overlaps(draft, existing, settings)) return;

          if (existing.table_group_id) {
            const existingGroup =
              groupById.get(Number(existing.table_group_id));

            (
              Array.isArray(existingGroup?.table_ids)
                ? existingGroup.table_ids
                : []
            ).forEach(id => occupiedIds.add(Number(id)));
          } else if (existing.table_id) {
            occupiedIds.add(Number(existing.table_id));
          }
        });

      const availableTable =
        singleCandidates.find(
          table => !occupiedIds.has(Number(table.id))
        ) || null;

      const availableGroup =
        !availableTable
          ? groupCandidates.find(
              group =>
                group.table_ids
                  .map(Number)
                  .every(id => !occupiedIds.has(id))
            ) || null
          : null;

      if (availableTable || availableGroup) {
        slots.push(slotTime);
      }
    }

    return res.status(200).json({
      success: true,
      restaurant: {
        id: restaurantId,
        slug: restaurant.slug,
        name: restaurant.name
      },
      slots,
      duration_minutes: duration,
      message:
        slots.length
          ? `${slots.length} volných termínů`
          : "Pro zvolený den a počet osob už není volný termín."
    });
  } catch (error) {
    console.error("Chyba při načítání volných časů:", error);

    return res
      .status(mapReservationError(error))
      .json({
        error:
          error.message ||
          "Volné časy se nepodařilo načíst."
      });
  }
}


async function createReservationOnServer(req, res) {
  const {
    slug = "",
    name = "",
    last_name = "",
    people,
    date = "",
    time = "",
    phone = "",
    email = "",
    note = ""
  } = req.body || {};

  const cleanRestaurantSlug = cleanSlug(slug);
  const cleanName = String(name).trim();
  const cleanLastName = String(last_name).trim();
  const cleanPhone = String(phone).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanNote = String(note || "").trim();

  const peopleNumber = Number(people);
  const cleanTime = String(time || "").trim().slice(0, 5);

  if (
    !cleanRestaurantSlug ||
    !cleanName ||
    !cleanLastName ||
    !date ||
    !cleanTime ||
    !cleanPhone ||
    !cleanEmail ||
    !Number.isInteger(peopleNumber) ||
    peopleNumber < 1
  ) {
    return res.status(400).json({
      error: "Chybí povinné údaje rezervace."
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      error: "Neplatné datum rezervace."
    });
  }

  if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(cleanTime)) {
    return res.status(400).json({
      error: "Neplatný čas rezervace."
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({
      error: "Zadej platný e-mail."
    });
  }

  try {
    const restaurant =
      await getPublishedRestaurantBySlug(cleanRestaurantSlug);

    const restaurantId = Number(restaurant.id);

    const [
      settingsRows,
      tables,
      tableGroups,
      reservations
    ] = await Promise.all([
      supabaseServiceJson(
        `/rest/v1/reservation_settings?restaurant_id=eq.${restaurantId}&select=*`,
        { method: "GET" }
      ),
      supabaseServiceJson(
        `/rest/v1/restaurant_tables?restaurant_id=eq.${restaurantId}&active=eq.true&select=id,name,capacity,active,room&order=capacity.asc,id.asc`,
        { method: "GET" }
      ),
      supabaseServiceJson(
        `/rest/v1/table_groups?restaurant_id=eq.${restaurantId}&select=id,name,table_ids,total_capacity,room&order=total_capacity.asc,id.asc`,
        { method: "GET" }
      ),
      supabaseServiceJson(
        `/rest/v1/reservations?restaurant_id=eq.${restaurantId}&date=eq.${encodeURIComponent(date)}&status=neq.${encodeURIComponent("Zrušeno")}&select=id,date,time,duration_minutes,people,table_id,table_group_id,status`,
        { method: "GET" }
      )
    ]);

    const settings =
      Array.isArray(settingsRows) && settingsRows[0]
        ? settingsRows[0]
        : {};

    const minPeople = Math.max(
      1,
      Number(settings.min_people || 1)
    );

    const maxPeople = Math.max(
      minPeople,
      Number(settings.max_people || 20)
    );

    if (
      peopleNumber < minPeople ||
      peopleNumber > maxPeople
    ) {
      return res.status(400).json({
        error:
          `Počet osob musí být od ${minPeople} do ${maxPeople}.`
      });
    }

    const durationMinutes =
      getDurationByPeople(peopleNumber, settings);

    const singleCandidates =
      (Array.isArray(tables) ? tables : [])
        .filter(table =>
          Number(table.capacity) >= peopleNumber
        );

    const groupCandidates =
      (Array.isArray(tableGroups) ? tableGroups : [])
        .filter(group =>
          Number(group.total_capacity) >= peopleNumber &&
          Array.isArray(group.table_ids) &&
          group.table_ids.length >= 2
        );

    if (
      !singleCandidates.length &&
      !groupCandidates.length
    ) {
      return res.status(409).json({
        error:
          "Pro tento počet hostů není žádný vhodný aktivní stůl ani povolená skupina stolů."
      });
    }

    const draft = {
      date,
      time: cleanTime,
      people: peopleNumber,
      duration_minutes: durationMinutes
    };

    const groupById = new Map(
      (Array.isArray(tableGroups) ? tableGroups : [])
        .map(group => [Number(group.id), group])
    );

    const occupied = new Set();

    (Array.isArray(reservations) ? reservations : [])
      .forEach(existing => {
        if (!overlaps(draft, existing, settings)) return;

        if (existing.table_group_id) {
          const existingGroup =
            groupById.get(Number(existing.table_group_id));

          (
            Array.isArray(existingGroup?.table_ids)
              ? existingGroup.table_ids
              : []
          ).forEach(id => occupied.add(Number(id)));
        } else if (existing.table_id) {
          occupied.add(Number(existing.table_id));
        }
      });

    const selectedTable =
      singleCandidates.find(
        table => !occupied.has(Number(table.id))
      ) || null;

    const selectedGroup =
      !selectedTable
        ? groupCandidates.find(
            group =>
              group.table_ids
                .map(Number)
                .every(id => !occupied.has(id))
          ) || null
        : null;

    if (!selectedTable && !selectedGroup) {
      return res.status(409).json({
        error:
          "V tomto čase není volný vhodný stůl ani povolená skupina stolů. Vyber jiný čas."
      });
    }

    const rpcResult = await supabasePublicRpc(
      "create_public_reservation_safe",
      {
        p_slug: cleanRestaurantSlug,
        p_name: cleanName,
        p_people: peopleNumber,
        p_date: date,
        p_time: cleanTime,
        p_phone: cleanPhone,
        p_email: cleanEmail,
        p_note: cleanNote || null,
        p_last_name: cleanLastName || null,
        p_table_id:
          selectedTable
            ? Number(selectedTable.id)
            : null,
        p_table_group_id:
          selectedGroup
            ? Number(selectedGroup.id)
            : null
      }
    );

    const inserted =
      Array.isArray(rpcResult)
        ? rpcResult[0] || null
        : rpcResult || null;

    return res.status(200).json({
      success: true,
      apiVersion: "slug-rpc-v1",
      reservation: inserted,
      restaurant: {
        id: restaurantId,
        slug: restaurant.slug,
        name: restaurant.name
      },
      table: selectedTable
        ? {
            id: Number(selectedTable.id),
            name: selectedTable.name,
            capacity: Number(selectedTable.capacity),
            type: "table"
          }
        : {
            id: Number(selectedGroup.id),
            name: selectedGroup.name,
            capacity: Number(selectedGroup.total_capacity),
            table_ids: selectedGroup.table_ids.map(Number),
            type: "group"
          }
    });
  } catch (error) {
    console.error("Chyba při vytvoření rezervace:", error);

    return res
      .status(mapReservationError(error))
      .json({
        error:
          error.message ||
          "Rezervaci se nepodařilo uložit."
      });
  }
}


async function sendResendEmail({
  to,
  subject,
  html,
  replyTo
}) {
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization:
        `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from:
        process.env.RESEND_FROM_EMAIL ||
        "Restaurace <onboarding@resend.dev>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });

  const data =
    await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.message ||
      "Resend odmítl odeslání e-mailu."
    );
  }

  return data;
}


export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Povolena je pouze metoda POST."
    });
  }

  if (req.body?.action === "available-times") {
    return getAvailableTimesOnServer(req, res);
  }

  if (req.body?.action === "create-reservation") {
    return createReservationOnServer(req, res);
  }
  
return res.status(400).json({
  error: "Neplatná akce."
});
}
