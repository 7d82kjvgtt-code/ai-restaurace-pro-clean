const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY = "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json"
};

let menu = [];


const PUBLIC_RESTAURANT_ID = 1;
const DEFAULT_PUBLIC_RESERVATION_SETTINGS = {
  duration_1_2: 90,
  duration_3_4: 120,
  duration_5_6: 150,
  duration_7_plus: 180,
  min_advance_minutes: 60,
  max_advance_days: 30,
  min_people: 1,
  max_people: 20
};

let publicReservationSettings = { ...DEFAULT_PUBLIC_RESERVATION_SETTINGS };
let publicReservationSettingsLoaded = false;

function getPublicReservationDuration(people) {
  const count = Number(people || 1);
  if (count <= 2) return Number(publicReservationSettings.duration_1_2 || 90);
  if (count <= 4) return Number(publicReservationSettings.duration_3_4 || 120);
  if (count <= 6) return Number(publicReservationSettings.duration_5_6 || 150);
  return Number(publicReservationSettings.duration_7_plus || 180);
}

function localDateString(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split("T")[0];
}

function addLocalDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

function applyPublicReservationSettingsToForm() {
  const peopleInput = document.getElementById("osoby");
  const dateInput = document.getElementById("datum");
  if (peopleInput) {
    peopleInput.min = String(publicReservationSettings.min_people);
    peopleInput.max = String(publicReservationSettings.max_people);
  }
  if (dateInput) {
    const now = new Date();
    dateInput.min = localDateString(now);
    dateInput.max = localDateString(addLocalDays(now, publicReservationSettings.max_advance_days));
  }
}

async function loadPublicReservationSettings(force = false) {
  if (publicReservationSettingsLoaded && !force) return publicReservationSettings;
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/reservation_settings?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&select=*`,
      { headers }
    );
    if (!response.ok) throw new Error(await response.text());
    const rows = await response.json();
    const row = rows[0] || {};
    publicReservationSettings = {
      duration_1_2: Math.max(30, Number(row.duration_1_2 || 90)),
      duration_3_4: Math.max(30, Number(row.duration_3_4 || 120)),
      duration_5_6: Math.max(30, Number(row.duration_5_6 || 150)),
      duration_7_plus: Math.max(30, Number(row.duration_7_plus || 180)),
      min_advance_minutes: Math.max(0, Number(row.min_advance_minutes ?? 60)),
      max_advance_days: Math.max(1, Number(row.max_advance_days || 30)),
      min_people: Math.max(1, Number(row.min_people || 1)),
      max_people: Math.max(1, Number(row.max_people || 20))
    };
  } catch (error) {
    console.warn("Používám výchozí nastavení rezervací:", error);
    publicReservationSettings = { ...DEFAULT_PUBLIC_RESERVATION_SETTINGS };
  }
  publicReservationSettingsLoaded = true;
  applyPublicReservationSettingsToForm();
  return publicReservationSettings;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "00:00")
    .split(":")
    .map(Number);

  return (hours * 60) + minutes;
}

function publicReservationsOverlap(first, second) {
  if (!first?.date || !second?.date || first.date !== second.date) {
    return false;
  }

  const firstStart = timeToMinutes(first.time);
  const secondStart = timeToMinutes(second.time);
  const firstEnd = firstStart + Math.max(
    30,
    Number(first.duration_minutes || getPublicReservationDuration(first.people || 1))
  );
  const secondEnd = secondStart + Math.max(
    30,
    Number(second.duration_minutes || getPublicReservationDuration(second.people || 1))
  );

  return firstStart < secondEnd && secondStart < firstEnd;
}

async function findBestPublicTable({ people, date, time, durationMinutes }) {
  const tablesUrl =
    `${SUPABASE_URL}/rest/v1/restaurant_tables` +
    `?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}` +
    `&active=eq.true` +
    `&capacity=gte.${Number(people)}` +
    `&select=id,name,capacity,active` +
    `&order=capacity.asc`;

  const reservationsUrl =
    `${SUPABASE_URL}/rest/v1/reservations` +
    `?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}` +
    `&date=eq.${encodeURIComponent(date)}` +
    `&status=neq.${encodeURIComponent("Zrušeno")}` +
    `&select=id,date,time,duration_minutes,people,table_id,status`;

  const [tablesResponse, reservationsResponse] = await Promise.all([
    fetch(tablesUrl, { headers }),
    fetch(reservationsUrl, { headers, cache: "no-store" })
  ]);

  if (!tablesResponse.ok || !reservationsResponse.ok) {
    const tablesError = tablesResponse.ok
      ? ""
      : await tablesResponse.text();
    const reservationsError = reservationsResponse.ok
      ? ""
      : await reservationsResponse.text();

    console.error("Chyba automatického výběru stolu:", {
      tablesError,
      reservationsError
    });

    throw new Error("Nepodařilo se ověřit dostupnost stolů.");
  }

  const tables = await tablesResponse.json();
  const reservationsForDate = await reservationsResponse.json();
  const draft = {
    date,
    time,
    duration_minutes: Number(durationMinutes || getPublicReservationDuration(people))
  };

  const normalizeTableName = value => String(value || "").trim().toLocaleLowerCase("cs-CZ");

  return tables.find(table => {
    const logicalTableIds = new Set(
      tables
        .filter(candidate => normalizeTableName(candidate.name) === normalizeTableName(table.name))
        .map(candidate => String(candidate.id))
    );

    return !reservationsForDate.some(reservation => {
      if (!logicalTableIds.has(String(reservation.table_id))) {
        return false;
      }

      return publicReservationsOverlap(draft, reservation);
    });
  }) || null;
}

async function checkPublicOpeningAvailability({ date, time, durationMinutes }) {
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  const endMinutes = timeToMinutes(time) + Number(durationMinutes || 120);

  const hoursUrl = `${SUPABASE_URL}/rest/v1/opening_hours?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&day_of_week=eq.${dayOfWeek}&select=is_open,open_time,close_time`;
  const blocksUrl = `${SUPABASE_URL}/rest/v1/blocked_times?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&select=start_time,end_time,reason`;

  const [hoursResponse, blocksResponse] = await Promise.all([
    fetch(hoursUrl, { headers }),
    fetch(blocksUrl, { headers })
  ]);

  if (!hoursResponse.ok || !blocksResponse.ok) {
    throw new Error("Nepodařilo se ověřit otevírací dobu.");
  }

  const hoursRows = await hoursResponse.json();
  const blocks = await blocksResponse.json();
  const hours = hoursRows[0] || { is_open: true, open_time: "10:00:00", close_time: "22:00:00" };

  if (!hours.is_open) {
    return { ok: false, message: "V tento den má restaurace zavřeno." };
  }

  const openMinutes = timeToMinutes(hours.open_time);
  const closeMinutes = timeToMinutes(hours.close_time);
  const startMinutes = timeToMinutes(time);

  if (startMinutes < openMinutes || endMinutes > closeMinutes) {
    return {
      ok: false,
      message: `Rezervace musí celá proběhnout mezi ${String(hours.open_time).slice(0,5)} a ${String(hours.close_time).slice(0,5)}.`
    };
  }

  const conflictingBlock = blocks.find(block => {
    const blockStart = timeToMinutes(block.start_time);
    const blockEnd = timeToMinutes(block.end_time);
    return startMinutes < blockEnd && blockStart < endMinutes;
  });

  if (conflictingBlock) {
    const reservationEnd = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
    const blockStart = String(conflictingBlock.start_time).slice(0, 5);
    const blockEnd = String(conflictingBlock.end_time).slice(0, 5);

    return {
      ok: false,
      message: conflictingBlock.reason
        ? `Rezervace by končila v ${reservationEnd} a zasahovala do blokace ${blockStart}–${blockEnd}: ${conflictingBlock.reason}`
        : `Rezervace by končila v ${reservationEnd} a zasahovala do blokovaného času ${blockStart}–${blockEnd}.`
    };
  }

  return { ok: true };
}

async function loadMenu() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/menu?select=*&order=id.asc`, {
    headers
  });

  menu = await res.json();
  renderPublicMenu();
}

function renderPublicMenu() {
  const container = document.getElementById("publicMenu");
  if (!container) return;

  if (!menu.length) {
    container.innerHTML = "<p>Menu je prázdné.</p>";
    return;
  }

  const categoryOrder = [
  "Pizza",
  "Předkrm",
  "Hlavní jídlo",
  "Těstoviny",
  "Dezert",
  "Sladká jídla",
  "Nápoj"
];

const categoriesFromMenu = menu
  .map(item => (item.category || "Hlavní jídlo").trim())
  .filter(Boolean);

const categories = [
  ...categoryOrder,
  ...categoriesFromMenu.filter(
    category => !categoryOrder.includes(category)
  )
].filter(
  (category, index, array) =>
    array.indexOf(category) === index
);

  container.className = "";
  container.style.display = "block";

  container.innerHTML = categories.map(category => {
    const items = menu.filter(item =>
  (item.category || "Hlavní jídlo").trim() === category.trim()
);
    if (!items.length) return "";

    return `
      <section class="menu-category" style="width:100%;margin-bottom:70px;">
        <h2 style="font-size:36px;color:#f59e0b;margin-bottom:25px;border-left:6px solid #f59e0b;padding-left:15px;text-transform:uppercase;">
          ${category}
        </h2>

       <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,260px));justify-content:center;gap:30px;">
          ${items.map(item => `
            <div class="food-card" onclick="openFoodDetail(${item.id})">
              ${
                item.image_url
                  ? `<img src="${item.image_url}" style="width:100%;height:180px;object-fit:cover;border-radius:18px;margin-bottom:18px;display:block;">`
                  : `<div style="width:100%;height:180px;display:flex;align-items:center;justify-content:center;font-size:64px;border-radius:18px;margin-bottom:18px;background:#111827;">${item.emoji || "🍽️"}</div>`
              }

              <h3>${item.name}</h3>
              <p>${item.price} Kč</p>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");
}

function odpoved() {
  const text = document.getElementById("dotaz").value.toLowerCase();
  const vysledek = document.getElementById("vysledek");

  if (text.includes("menu")) {
    vysledek.innerHTML = menu
      .map(item => `${item.emoji || "🍽️"} ${item.name} - ${item.price} Kč`)
      .join("<br>");
  } else if (text.includes("otev")) {
    vysledek.innerHTML = "🕒 Otevřeno každý den 10:00–22:00.";
  } else if (text.includes("rezerv")) {
    document.getElementById("rezervace").scrollIntoView({ behavior: "smooth" });
    vysledek.innerHTML = "📅 Formulář rezervace je níže.";
  } else {
    vysledek.innerHTML = "Zkus napsat: <b>menu</b>, <b>otevřeno</b> nebo <b>rezervace</b>.";
  }
}

let reservationSubmissionInProgress = false;

function getPublicReservationButton() {
  return document.getElementById("reservationSubmitButton") || document.querySelector('button[onclick*="ulozitRezervaci"]');
}

function setPublicReservationSubmitting(isSubmitting) {
  reservationSubmissionInProgress = isSubmitting;

  const button = getPublicReservationButton();
  if (!button) return;

  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent.trim() || "Potvrdit rezervaci";
  }

  button.disabled = isSubmitting;
  button.setAttribute("aria-busy", String(isSubmitting));
  button.textContent = isSubmitting
    ? "Ukládám rezervaci…"
    : button.dataset.originalText;
}


function showPublicReservationNotice(message, type = null) {
  const notice = document.getElementById("reservationNotice");
  if (!notice) {
    console[type === "success" ? "log" : "warn"](message);
    return;
  }

  const text = String(message || "").trim();
  const resolvedType = type || (text.startsWith("✅") ? "success" : "error");
  notice.hidden = false;
  notice.className = `reservation-notice ${resolvedType}`;
  notice.innerHTML = `
    <span class="reservation-notice-icon">${resolvedType === "success" ? "✓" : "!"}</span>
    <span>${text.replace(/^✅\s*/, "")}</span>
    <button type="button" class="reservation-notice-close" aria-label="Zavřít">×</button>
  `;

  notice.querySelector(".reservation-notice-close")?.addEventListener("click", () => {
    notice.hidden = true;
  });

  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setAvailableTimesStatus(message, type = "info") {
  const status = document.getElementById("availableTimesStatus");
  if (!status) return;
  status.textContent = message || "";
  status.dataset.type = type;
}

async function loadAvailableReservationTimes() {
  await loadPublicReservationSettings();
  const dateInput = document.getElementById("datum");
  const peopleInput = document.getElementById("osoby");
  const timeSelect = document.getElementById("cas");
  if (!dateInput || !peopleInput || !timeSelect) return;

  const date = dateInput.value;
  const people = Number(peopleInput.value);
  const previousValue = timeSelect.value;

  if (!date || !Number.isInteger(people) || people < publicReservationSettings.min_people || people > publicReservationSettings.max_people) {
    timeSelect.innerHTML = '<option value="">Nejdřív vyber datum a počet osob</option>';
    timeSelect.disabled = true;
    setAvailableTimesStatus("");
    return;
  }

  timeSelect.disabled = true;
  timeSelect.innerHTML = '<option value="">Načítám volné časy…</option>';
  setAvailableTimesStatus("Kontroluji otevírací dobu a volné stoly…");

  try {
    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
    const urls = [
      `${SUPABASE_URL}/rest/v1/opening_hours?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&day_of_week=eq.${dayOfWeek}&select=is_open,open_time,close_time`,
      `${SUPABASE_URL}/rest/v1/blocked_times?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&select=start_time,end_time,reason`,
      `${SUPABASE_URL}/rest/v1/restaurant_tables?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&active=eq.true&capacity=gte.${people}&select=id,name,capacity,active&order=capacity.asc`,
      `${SUPABASE_URL}/rest/v1/reservations?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}&date=eq.${encodeURIComponent(date)}&status=neq.${encodeURIComponent("Zrušeno")}&select=id,date,time,duration_minutes,people,table_id,status`
    ];

    const responses = await Promise.all(urls.map(url => fetch(url, { headers, cache: "no-store" })));
    if (responses.some(response => !response.ok)) {
      throw new Error("Nepodařilo se načíst dostupné časy.");
    }

    const [hoursRows, blocks, tables, reservations] = await Promise.all(responses.map(response => response.json()));
    const hours = hoursRows[0] || { is_open: true, open_time: "10:00:00", close_time: "22:00:00" };

    if (!hours.is_open) {
      timeSelect.innerHTML = '<option value="">Tento den je zavřeno</option>';
      setAvailableTimesStatus("V tento den má restaurace zavřeno.", "error");
      return;
    }

    if (!tables.length) {
      timeSelect.innerHTML = '<option value="">Není vhodný stůl</option>';
      setAvailableTimesStatus(`Pro ${people} osob není k dispozici vhodný aktivní stůl.`, "error");
      return;
    }

    const openMinutes = timeToMinutes(hours.open_time);
    const closeMinutes = timeToMinutes(hours.close_time);
    const duration = getPublicReservationDuration(people);
    const now = new Date();
    const slots = [];

    for (let start = openMinutes; start + duration <= closeMinutes; start += 30) {
      const slotTime = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
      const slotDateTime = new Date(`${date}T${slotTime}:00`);
      const earliestAllowed = Date.now() + (Number(publicReservationSettings.min_advance_minutes || 0) * 60000);
      if (slotDateTime.getTime() < earliestAllowed) continue;
      const end = start + duration;
      const blocked = blocks.some(block => {
        const blockStart = timeToMinutes(block.start_time);
        const blockEnd = timeToMinutes(block.end_time);
        return start < blockEnd && blockStart < end;
      });
      if (blocked) continue;

      const availableTable = tables.find(table => !reservations.some(reservation => {
        if (Number(reservation.table_id) !== Number(table.id)) return false;
        const reservationStart = timeToMinutes(reservation.time);
        const reservationEnd = reservationStart + Math.max(30, Number(reservation.duration_minutes || getPublicReservationDuration(reservation.people || 1)));
        return start < reservationEnd && reservationStart < end;
      }));

      if (availableTable) {
        slots.push(`${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`);
      }
    }

    if (!slots.length) {
      timeSelect.innerHTML = '<option value="">Žádný volný čas</option>';
      setAvailableTimesStatus("Pro zvolený den a počet osob už není volný termín.", "error");
      return;
    }

    timeSelect.innerHTML = '<option value="">Vyber čas</option>' + slots.map(slot => `<option value="${slot}">${slot}</option>`).join("");
    timeSelect.disabled = false;
    if (slots.includes(previousValue)) timeSelect.value = previousValue;
    setAvailableTimesStatus(`${slots.length} volných termínů`, "success");
  } catch (error) {
    console.error(error);
    timeSelect.innerHTML = '<option value="">Časy se nepodařilo načíst</option>';
    setAvailableTimesStatus("Volné časy se nepodařilo načíst. Zkus to znovu.", "error");
  }
}

async function publicReservationAlreadyExists({ name, date, time, phone, email }) {
  const params = new URLSearchParams({
    restaurant_id: `eq.${PUBLIC_RESTAURANT_ID}`,
    date: `eq.${date}`,
    time: `eq.${time}`,
    status: "neq.Zrušeno",
    select: "id,name,phone,email"
  });

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/reservations?${params.toString()}`,
    { method: "GET", headers }
  );

  if (!response.ok) {
    throw new Error("Nepodařilo se ověřit, zda rezervace už neexistuje.");
  }

  const normalizedName = name.trim().toLowerCase();
  const normalizedPhone = phone.replace(/\s+/g, "");
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await response.json();

  return rows.some(row => {
    const sameName = String(row.name || "").trim().toLowerCase() === normalizedName;
    const samePhone = String(row.phone || "").replace(/\s+/g, "") === normalizedPhone;
    const sameEmail = String(row.email || "").trim().toLowerCase() === normalizedEmail;

    return sameName && (samePhone || sameEmail);
  });
}

async function ulozitRezervaci() {
  if (reservationSubmissionInProgress) return;
  await loadPublicReservationSettings();

  const name = document.getElementById("jmeno").value.trim();
  const lastName = document.getElementById("prijmeni").value.trim();
  const people = document.getElementById("osoby").value.trim();
  const date = document.getElementById("datum").value;
  const time = document.getElementById("cas").value;
  const phone = document.getElementById("telefon").value.trim();
  const email = document.getElementById("email").value.trim();
  const note = document.getElementById("poznamka").value.trim();
  const namePattern = /^[A-Za-zÁ-Žá-ž\s'-]{2,50}$/;

  if (!namePattern.test(name)) {
    showPublicReservationNotice("Zadej platné jméno alespoň o 2 písmenech.");
    document.getElementById("jmeno").value = "";
    return;
  }

  if (!namePattern.test(lastName)) {
    showPublicReservationNotice("Zadej platné příjmení alespoň o 2 písmenech.");
    document.getElementById("prijmeni").value = "";
    return;
  }

  const today = new Date();
  const localToday = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000
  ).toISOString().split("T")[0];

  if (!date) {
    showPublicReservationNotice("Zadej platné datum rezervace.");
    return;
  }

  if (date < localToday) {
    showPublicReservationNotice("Nelze vytvořit rezervaci na minulý den.");
    return;
  }

  const localMaxDate = localDateString(
    addLocalDays(new Date(), publicReservationSettings.max_advance_days)
  );

  if (date > localMaxDate) {
    showPublicReservationNotice(`Rezervaci lze vytvořit maximálně ${publicReservationSettings.max_advance_days} dní dopředu.`);
    return;
  }


  if (date === localToday) {
    const now = new Date();
    const currentTime =
      String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0");

    if (time <= currentTime) {
      showPublicReservationNotice("Na dnešek nelze rezervovat čas, který už proběhl.");
      return;
    }
  }

  const peopleNumber = Number(people);
  if (!Number.isInteger(peopleNumber) || peopleNumber < publicReservationSettings.min_people || peopleNumber > publicReservationSettings.max_people) {
    showPublicReservationNotice(`Počet osob musí být od ${publicReservationSettings.min_people} do ${publicReservationSettings.max_people}.`);
    return;
  }

  const phoneClean = phone.replace(/\s+/g, "");
  if (!/^\+?\d{9,15}$/.test(phoneClean)) {
    showPublicReservationNotice("Zadej platné telefonní číslo.");
    return;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    showPublicReservationNotice("Zadej platnou e-mailovou adresu.");
    return;
  }

  if (!name || !lastName || !people || !date || !time || !phone || !email) {
    showPublicReservationNotice("Vyplň jméno, příjmení, počet osob, datum, čas, telefon a e-mail.");
    return;
  }

  const reservationDurationMinutes = getPublicReservationDuration(peopleNumber);
  const requestedStart = new Date(`${date}T${time}:00`);
  const earliestAllowed = Date.now() + (Number(publicReservationSettings.min_advance_minutes || 0) * 60000);
  if (requestedStart.getTime() < earliestAllowed) {
    showPublicReservationNotice(`Rezervaci je potřeba vytvořit alespoň ${publicReservationSettings.min_advance_minutes} minut předem.`);
    return;
  }

  setPublicReservationSubmitting(true);

  try {
    const openingAvailability = await checkPublicOpeningAvailability({
      date,
      time,
      durationMinutes: reservationDurationMinutes
    });

    if (!openingAvailability.ok) {
      showPublicReservationNotice(openingAvailability.message);
      return;
    }
    const duplicateExists = await publicReservationAlreadyExists({
      name,
      date,
      time,
      phone,
      email
    });

    if (duplicateExists) {
      showPublicReservationNotice("Tato rezervace už byla uložena. Není potřeba ji odesílat znovu.");
      return;
    }

    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?date=eq.${encodeURIComponent(date)}&time=eq.${encodeURIComponent(time)}&status=neq.Zrušeno&select=id`,
      { method: "GET", headers }
    );

    if (!checkRes.ok) {
      throw new Error("Nepodařilo se ověřit dostupnost termínu.");
    }

    const existingReservations = await checkRes.json();
    if (existingReservations.length >= 7) {
      showPublicReservationNotice("Tento termín je už plně obsazený. Vyber jiný čas.");
      return;
    }

    const automaticallySelectedTable = await findBestPublicTable({
      people: peopleNumber,
      date,
      time,
      durationMinutes: reservationDurationMinutes
    });

    if (!automaticallySelectedTable) {
      showPublicReservationNotice(
        "Pro tento počet osob není v daném čase volný vhodný stůl. " +
        "Vyber jiný čas."
      );
      return;
    }

    // FINAL HARD CHECK: re-read the whole day immediately before INSERT.
    // A table is treated as the same logical table by ID OR by its visible name.
    // This also protects against accidental duplicate rows such as two records named "Stůl 3".
    const finalConflictUrl =
      `${SUPABASE_URL}/rest/v1/reservations` +
      `?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}` +
      `&date=eq.${encodeURIComponent(date)}` +
      `&status=neq.${encodeURIComponent("Zrušeno")}` +
      `&select=id,date,time,duration_minutes,people,table_id,status`;

    const finalTablesUrl =
      `${SUPABASE_URL}/rest/v1/restaurant_tables` +
      `?restaurant_id=eq.${PUBLIC_RESTAURANT_ID}` +
      `&active=eq.true` +
      `&select=id,name,capacity,active`;

    const [finalConflictResponse, finalTablesResponse] = await Promise.all([
      fetch(finalConflictUrl, { headers, cache: "no-store" }),
      fetch(finalTablesUrl, { headers, cache: "no-store" })
    ]);

    if (!finalConflictResponse.ok || !finalTablesResponse.ok) {
      throw new Error("Nepodařilo se provést finální kontrolu stolu.");
    }

    const finalTableReservations = await finalConflictResponse.json();
    const finalTables = await finalTablesResponse.json();
    const selectedName = String(automaticallySelectedTable.name || "").trim().toLocaleLowerCase("cs-CZ");
    const selectedLogicalIds = new Set(
      finalTables
        .filter(table => String(table.name || "").trim().toLocaleLowerCase("cs-CZ") === selectedName)
        .map(table => String(table.id))
    );
    selectedLogicalIds.add(String(automaticallySelectedTable.id));

    const finalDraft = {
      date,
      time,
      people: peopleNumber,
      duration_minutes: reservationDurationMinutes
    };

    const finalConflict = finalTableReservations.some(existing =>
      selectedLogicalIds.has(String(existing.table_id)) &&
      publicReservationsOverlap(finalDraft, existing)
    );

    if (finalConflict) {
      showPublicReservationNotice(
        `Stůl ${automaticallySelectedTable.name || automaticallySelectedTable.id} už je v tomto čase obsazený. ` +
        "Vyber jiný čas."
      );
      await loadAvailableReservationTimes();
      return;
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/reservations`, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        name,
        last_name: lastName,
        people: peopleNumber,
        date,
        time,
        duration_minutes: reservationDurationMinutes,
        table_id: Number(automaticallySelectedTable.id),
        phone,
        email,
        note,
        status: "Čeká",
        restaurant_id: PUBLIC_RESTAURANT_ID
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error("Chyba rezervace: " + errorText);
    }

    let emailSent = false;

    try {
      const emailRes = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${name} ${lastName}`.trim(),
          people: peopleNumber,
          date,
          time,
          phone,
          email,
          note
        })
      });

      const emailData = await emailRes.json().catch(() => ({}));
      emailSent = emailRes.ok;

      if (!emailRes.ok) {
        console.error("E-mail se nepodařilo odeslat:", emailData);
      }
    } catch (emailError) {
      console.error("E-mail se nepodařilo odeslat:", emailError);
    }

    showPublicReservationNotice(
      emailSent
        ? `✅ Rezervace uložena. Automaticky byl vybrán ${automaticallySelectedTable.name} a potvrzení bylo odesláno e-mailem!`
        : `✅ Rezervace uložena. Automaticky byl vybrán ${automaticallySelectedTable.name}. Potvrzovací e-mail se ale nepodařilo odeslat.`
    );

    ["jmeno", "prijmeni", "osoby", "datum", "cas", "telefon", "email", "poznamka"]
      .forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
      });
    loadAvailableReservationTimes();
  } catch (error) {
    console.error(error);
    showPublicReservationNotice(error.message || "Rezervaci se nepodařilo uložit.");
  } finally {
    setPublicReservationSubmitting(false);
  }
}


document.addEventListener("DOMContentLoaded", async () => {
  await loadPublicReservationSettings();
  const dateInput = document.getElementById("datum");
  const peopleInput = document.getElementById("osoby");
  const timeSelect = document.getElementById("cas");

  if (dateInput) {
    const now = new Date();
    const localToday = localDateString(now);
    const localMax = localDateString(addLocalDays(now, publicReservationSettings.max_advance_days));
    dateInput.min = localToday;
    dateInput.max = localMax;
    dateInput.addEventListener("change", loadAvailableReservationTimes);
  }

  if (peopleInput) {
    peopleInput.addEventListener("input", () => {
      clearTimeout(peopleInput._availabilityTimer);
      peopleInput._availabilityTimer = setTimeout(loadAvailableReservationTimes, 250);
    });
  }

  if (timeSelect) {
    timeSelect.addEventListener("focus", () => {
      if (timeSelect.disabled) loadAvailableReservationTimes();
    });
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const menuToggle = document.getElementById("menuToggle");
  const navLinks = document.getElementById("navLinks");

  if (!menuToggle || !navLinks) return;

  menuToggle.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");

    menuToggle.textContent = isOpen ? "✕" : "☰";
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  navLinks.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      navLinks.classList.remove("open");
      menuToggle.textContent = "☰";
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
});
loadMenu();
function openFoodDetail(id) {
  const item = menu.find(food => food.id === id);

  if (!item) return;

  document.getElementById("modalFoodName").textContent = item.name;
  document.getElementById("modalFoodPrice").textContent = `${item.price} Kč`;
  document.getElementById("modalFoodDescription").textContent =
    item.description || "Neuvedeno";
  const ingredientsText = item.ingredients
  ? item.ingredients
      .split(",")
      .map(ingredient => ingredient.trim())
      .filter(Boolean)
      .join(", ")
  : "Neuvedeno";

document.getElementById("modalFoodIngredients").textContent =
  ingredientsText;
  const weightLabel =
  item.category === "Nápoj" ? "Objem:" : "Gramáž:";

document.getElementById("modalWeightLabel").textContent = weightLabel;
  let weightText = item.weight || "Neuvedeno";

weightText = weightText
  .replace(/(\d)(g|kg|ml|l)\b/gi, "$1 $2")
  .replace(/\s+/g, " ")
  .trim();

document.getElementById("modalFoodWeight").textContent =
  weightText;
  const allergenNames = {
  1: "obiloviny obsahující lepek",
  2: "korýši",
  3: "vejce",
  4: "ryby",
  5: "arašídy",
  6: "sója",
  7: "mléko",
  8: "skořápkové plody",
  9: "celer",
  10: "hořčice",
  11: "sezam",
  12: "oxid siřičitý a siřičitany",
  13: "vlčí bob",
  14: "měkkýši"
};

let allergensText = item.allergens || "Neuvedeno";

if (/^[\d,\s]+$/.test(allergensText)) {
  allergensText = allergensText
    .split(",")
    .map(number => number.trim())
    .filter(Boolean)
    .map(number =>
      allergenNames[number]
        ? `${number} – ${allergenNames[number]}`
        : number
    )
    .join(", ");
}

document.getElementById("modalFoodAllergens").textContent =
  allergensText;
  document.getElementById("foodModal").classList.add("open");
}

function closeFoodDetail() {
  document.getElementById("foodModal").classList.remove("open");
}
document.addEventListener("DOMContentLoaded", function () {
  const foodModal = document.getElementById("foodModal");

  if (!foodModal) return;

  foodModal.addEventListener("click", function (event) {
    if (event.target === foodModal) {
      closeFoodDetail();
    }
  });
});
