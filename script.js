const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY = "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json"
};

let menu = [];


const PUBLIC_RESTAURANT_ID = 1;
const PUBLIC_RESERVATION_DURATION_MINUTES = 120;

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
    Number(first.duration_minutes || PUBLIC_RESERVATION_DURATION_MINUTES)
  );
  const secondEnd = secondStart + Math.max(
    30,
    Number(second.duration_minutes || PUBLIC_RESERVATION_DURATION_MINUTES)
  );

  return firstStart < secondEnd && secondStart < firstEnd;
}

async function findBestPublicTable({ people, date, time }) {
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
    `&select=id,date,time,duration_minutes,table_id,status`;

  const [tablesResponse, reservationsResponse] = await Promise.all([
    fetch(tablesUrl, { headers }),
    fetch(reservationsUrl, { headers })
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
    duration_minutes: PUBLIC_RESERVATION_DURATION_MINUTES
  };

  return tables.find(table => {
    return !reservationsForDate.some(reservation => {
      if (Number(reservation.table_id) !== Number(table.id)) {
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
    return {
      ok: false,
      message: conflictingBlock.reason
        ? `Tento čas je blokovaný: ${conflictingBlock.reason}`
        : "Tento čas je momentálně blokovaný. Vyber jiný čas."
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
  return document.querySelector('button[onclick*="ulozitRezervaci"]');
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

  const name = document.getElementById("jmeno").value.trim();
  const people = document.getElementById("osoby").value.trim();
  const date = document.getElementById("datum").value;
  const time = document.getElementById("cas").value;
  const phone = document.getElementById("telefon").value.trim();
  const email = document.getElementById("email").value.trim();
  const note = document.getElementById("poznamka").value.trim();
  const namePattern = /^[A-Za-zÁ-Žá-ž\s'-]{2,50}$/;

  if (!namePattern.test(name)) {
    alert("Zadej platné jméno alespoň o 2 písmenech.");
    document.getElementById("jmeno").value = "";
    return;
  }

  const today = new Date();
  const localToday = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000
  ).toISOString().split("T")[0];

  if (!date) {
    alert("Zadej platné datum rezervace.");
    return;
  }

  if (date < localToday) {
    alert("Nelze vytvořit rezervaci na minulý den.");
    return;
  }

  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 1);
  const localMaxDate = new Date(
    maxDate.getTime() - maxDate.getTimezoneOffset() * 60000
  ).toISOString().split("T")[0];

  if (date > localMaxDate) {
    alert("Rezervaci lze vytvořit maximálně 1 rok dopředu.");
    return;
  }


  if (date === localToday) {
    const now = new Date();
    const currentTime =
      String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0");

    if (time <= currentTime) {
      alert("Na dnešek nelze rezervovat čas, který už proběhl.");
      return;
    }
  }

  const peopleNumber = Number(people);
  if (!Number.isInteger(peopleNumber) || peopleNumber < 1 || peopleNumber > 20) {
    alert("Počet osob musí být od 1 do 20.");
    return;
  }

  const phoneClean = phone.replace(/\s+/g, "");
  if (!/^\+?\d{9,15}$/.test(phoneClean)) {
    alert("Zadej platné telefonní číslo.");
    return;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    alert("Zadej platnou e-mailovou adresu.");
    return;
  }

  if (!name || !people || !date || !time || !phone || !email) {
    alert("Vyplň jméno, počet osob, datum, čas, telefon a e-mail.");
    return;
  }

  setPublicReservationSubmitting(true);

  try {
    const openingAvailability = await checkPublicOpeningAvailability({
      date,
      time,
      durationMinutes: PUBLIC_RESERVATION_DURATION_MINUTES
    });

    if (!openingAvailability.ok) {
      alert(openingAvailability.message);
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
      alert("Tato rezervace už byla uložena. Není potřeba ji odesílat znovu.");
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
      alert("Tento termín je už plně obsazený. Vyber jiný čas.");
      return;
    }

    const automaticallySelectedTable = await findBestPublicTable({
      people: peopleNumber,
      date,
      time
    });

    if (!automaticallySelectedTable) {
      alert(
        "Pro tento počet osob není v daném čase volný vhodný stůl. " +
        "Vyber jiný čas."
      );
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
        people: peopleNumber,
        date,
        time,
        duration_minutes: PUBLIC_RESERVATION_DURATION_MINUTES,
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
          name,
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

    alert(
      emailSent
        ? `✅ Rezervace uložena. Automaticky byl vybrán ${automaticallySelectedTable.name} a potvrzení bylo odesláno e-mailem!`
        : `✅ Rezervace uložena. Automaticky byl vybrán ${automaticallySelectedTable.name}. Potvrzovací e-mail se ale nepodařilo odeslat.`
    );

    ["jmeno", "osoby", "datum", "cas", "telefon", "email", "poznamka"]
      .forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
      });
  } catch (error) {
    console.error(error);
    alert(error.message || "Rezervaci se nepodařilo uložit.");
  } finally {
    setPublicReservationSubmitting(false);
  }
}

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
