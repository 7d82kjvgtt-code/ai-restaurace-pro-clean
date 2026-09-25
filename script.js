const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY = "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json"
};

let menu = [];

function resolvePublicRestaurantSlug() {
  const fromQuery = new URLSearchParams(window.location.search)
    .get("restaurant")
    ?.trim();

  if (fromQuery) return fromQuery;

  const routeMatch = window.location.pathname.match(/^\/r\/([^/?#]+)/);
  if (routeMatch?.[1]) {
    try {
      return decodeURIComponent(routeMatch[1]).trim();
    } catch (_) {
      return routeMatch[1].trim();
    }
  }

  return "";
}

const PUBLIC_RESTAURANT_SLUG = resolvePublicRestaurantSlug();
const PUBLIC_LOCALE = new URLSearchParams(window.location.search).get("lang") === "en" ? "en" : "cs";

function publicText(cs, en) {
  return PUBLIC_LOCALE === "en" ? en : cs;
}

function applyPublicLocale() {
  if (!PUBLIC_RESTAURANT_SLUG) return;
  document.documentElement.lang = PUBLIC_LOCALE;
  document.querySelectorAll("[data-en]").forEach(element => {
    element.textContent = PUBLIC_LOCALE === "en" ? element.dataset.en : element.textContent;
  });
  document.querySelectorAll("[data-en-placeholder]").forEach(element => {
    if (PUBLIC_LOCALE === "en") element.placeholder = element.dataset.enPlaceholder;
  });
  document.querySelectorAll("[data-en-aria]").forEach(element => {
    if (PUBLIC_LOCALE === "en") element.setAttribute("aria-label", element.dataset.enAria);
  });
  document.querySelectorAll("[data-en-question]").forEach(element => {
    if (PUBLIC_LOCALE === "en") element.dataset.aiQuestion = element.dataset.enQuestion;
  });

  const toggle = document.getElementById("publicLanguageToggle");
  if (toggle) {
    toggle.hidden = false;
    toggle.textContent = PUBLIC_LOCALE === "en" ? "English → Čeština" : "Čeština → English";
    toggle.setAttribute("aria-label", PUBLIC_LOCALE === "en" ? "Přepnout do češtiny" : "Switch to English");
    toggle.addEventListener("click", () => {
      const url = new URL(window.location.href);
      if (PUBLIC_LOCALE === "en") url.searchParams.delete("lang");
      else url.searchParams.set("lang", "en");
      window.location.assign(url.href);
    });
  }
}

let publicRestaurantInfo = null;
let publicRestaurantToday = "";
let publicRestaurantAiEnabled = false;
let restaurantAiRequestInProgress = false;

function applyPublicPageMode() {
  const hasRestaurant =
    Boolean(
      PUBLIC_RESTAURANT_SLUG
    );

  document
    .querySelectorAll(
      "[data-saas-only]"
    )
    .forEach(element => {
      element.hidden =
        hasRestaurant;
    });

  document
    .querySelectorAll(
      "[data-restaurant-only]"
    )
    .forEach(element => {
      element.hidden =
        !hasRestaurant;
    });

  document
    .querySelectorAll(
      "[data-restaurant-ai]"
    )
    .forEach(element => {
      element.hidden =
        true;
    });

  if (hasRestaurant) {
    document.body.classList.add(
      "restaurant-public-mode"
    );
  } else {
    document.body.classList.remove(
      "restaurant-public-mode"
    );
  }

  const brandAccent =
    document.getElementById(
      "publicRestaurantBrandAccent"
    );

  if (brandAccent) {
    brandAccent.hidden =
      hasRestaurant;
  }
}

function setRestaurantAiVisibility(
  enabled
) {
  publicRestaurantAiEnabled =
    Boolean(enabled);

  document
    .querySelectorAll(
      "[data-restaurant-ai]"
    )
    .forEach(element => {
      element.hidden =
        !publicRestaurantAiEnabled;
    });
}


function setRestaurantAiBusy(
  busy
) {
  restaurantAiRequestInProgress =
    Boolean(busy);

  const button =
    document.getElementById(
      "restaurantAiSendButton"
    );

  const input =
    document.getElementById(
      "restaurantAiInput"
    );

  if (button) {
    button.disabled =
      restaurantAiRequestInProgress;

    button.textContent =
      restaurantAiRequestInProgress
        ? publicText("Přemýšlím…", "Thinking…")
        : publicText("Zeptat se", "Ask");
  }

  if (input) {
    input.disabled =
      restaurantAiRequestInProgress;
  }
}


async function askRestaurantAi(
  questionOverride = ""
) {
  if (
    !publicRestaurantAiEnabled ||
    restaurantAiRequestInProgress
  ) {
    return;
  }

  const input =
    document.getElementById(
      "restaurantAiInput"
    );

  const answer =
    document.getElementById(
      "restaurantAiAnswer"
    );

  const question =
    String(
      questionOverride ||
      input?.value ||
      ""
    )
      .trim()
      .slice(0, 601);

  if (!question) {
    if (answer) {
      answer.textContent =
        publicText("Napište prosím dotaz.", "Please enter a question.");
    }

    input?.focus();
    return;
  }

  if (question.length > 600) {
    if (answer) {
      answer.textContent =
        publicText("Dotaz může mít maximálně 600 znaků.", "Your question can be at most 600 characters.");
    }

    return;
  }

  if (answer) {
    answer.textContent =
      publicText("Hledám odpověď v aktuálních údajích restaurace…", "Checking the restaurant's current information…");
  }

  setRestaurantAiBusy(
    true
  );

  try {
    const response =
      await fetch(
        "/api/restaurant-ai",
        {
          method:
            "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify({
              slug:
                requirePublicRestaurantSlug(),
              question,
              locale: document.documentElement.lang === "en" ? "en" : "cs"
            })
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (
      !response.ok ||
      !data?.answer
    ) {
      throw new Error(
        (PUBLIC_LOCALE === "en" ? null : data?.error) ||
        publicText("AI asistent teď není dostupný.", "The AI assistant is unavailable right now.")
      );
    }

    if (answer) {
      answer.textContent =
        String(
          data.answer
        );
    }

    if (
      input &&
      !questionOverride
    ) {
      input.value =
        "";
    }
  } catch (error) {
    console.error(
      "AI asistent restaurace:",
      error
    );

    if (answer) {
      answer.textContent =
        String(
          error?.message ||
          publicText("AI asistent teď není dostupný. Zkuste to prosím za chvíli.", "The AI assistant is unavailable. Please try again shortly.")
        );
    }
  } finally {
    setRestaurantAiBusy(
      false
    );
  }
}


function setupRestaurantAi() {
  const form =
    document.getElementById(
      "restaurantAiForm"
    );

  if (form) {
    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        askRestaurantAi();
      }
    );
  }

  document
    .querySelectorAll(
      "[data-ai-question]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const question =
            String(
              button.dataset
                .aiQuestion ||
              ""
            ).trim();

          if (question) {
            askRestaurantAi(
              question
            );
          }
        }
      );
    });
}


function getSafePublicHttpUrl(
  value
) {
  const raw =
    String(
      value || ""
    ).trim();

  if (!raw) {
    return "";
  }

  try {
    const url =
      new URL(
        raw,
        window.location.origin
      );

    const safe =
      url.protocol ===
        "https:" ||
      (
        url.protocol ===
          "http:" &&
        [
          "localhost",
          "127.0.0.1"
        ].includes(
          url.hostname
        )
      );

    return safe
      ? url.href
      : "";
  } catch {
    return "";
  }
}


function renderPublicRestaurantContact(
  restaurant = {}
) {
  const container =
    document.getElementById(
      "publicRestaurantContact"
    );

  if (!container) {
    return;
  }

  container.replaceChildren();

  const address =
    String(
      restaurant.address || ""
    ).trim();

  const phone =
    String(
      restaurant.phone || ""
    ).trim();

  const email =
    String(
      restaurant.email || ""
    ).trim();

  const website =
    getSafePublicHttpUrl(
      restaurant.website_url
    );

  const appendItem =
    ({
      icon,
      text,
      href = ""
    }) => {
      if (!text) {
        return;
      }

      const element =
        href
          ? document.createElement(
              "a"
            )
          : document.createElement(
              "span"
            );

      element.className =
        "restaurant-contact-item";

      if (href) {
        element.href =
          href;

        if (
          href.startsWith(
            "http"
          )
        ) {
          element.target =
            "_blank";

          element.rel =
            "noopener";
        }
      }

      const iconSpan =
        document.createElement(
          "span"
        );

      iconSpan.setAttribute(
        "aria-hidden",
        "true"
      );

      iconSpan.textContent =
        icon;

      const textSpan =
        document.createElement(
          "span"
        );

      textSpan.textContent =
        text;

      element.append(
        iconSpan,
        textSpan
      );

      container.appendChild(
        element
      );
    };

  appendItem({
    icon: "📍",
    text:
      address
  });

  if (phone) {
    const hrefPhone =
      phone.replace(
        /[^+0-9]/g,
        ""
      );

    appendItem({
      icon: "☎️",
      text:
        phone,
      href:
        hrefPhone
          ? "tel:" +
            hrefPhone
          : ""
    });
  }

  if (
    email &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  ) {
    appendItem({
      icon: "✉️",
      text:
        email,
      href:
        "mailto:" +
        email
    });
  }

  if (website) {
    let websiteLabel =
      "Web restaurace";

    try {
      websiteLabel =
        new URL(
          website
        ).hostname.replace(
          /^www\./,
          ""
        );
    } catch {
      // Fallback label stays.
    }

    appendItem({
      icon: "🌐",
      text:
        websiteLabel,
      href:
        website
    });
  }

  container.hidden =
    container.children.length ===
    0;
}


async function loadPublicRestaurantInfo() {
  const slug =
    requirePublicRestaurantSlug();

  const response =
    await fetch(
      "/api/send-email",
      {
        method:
          "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify({
            action:
              "restaurant-info",
            slug
          })
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (
    !response.ok ||
    !data?.restaurant
  ) {
    throw new Error(
      (PUBLIC_LOCALE === "en" ? null : data?.error) ||
      publicText("Restauraci se nepodařilo načíst.", "The restaurant could not be loaded.")
    );
  }

  publicRestaurantInfo =
    data.restaurant;

  publicRestaurantToday =
    String(
      data.restaurant_date ||
      ""
    ).trim();

  setRestaurantAiVisibility(
    data.ai_enabled === true
  );

  const name =
    String(
      data.restaurant.name ||
      "Restaurace"
    ).trim() ||
    "Restaurace";

  document.title =
    `${name} | ${publicText("Rezervace a menu", "Reservations and menu")}`;

  const brand =
    document.getElementById(
      "publicRestaurantBrand"
    );

  const brandName =
    document.getElementById(
      "publicRestaurantBrandName"
    );

  const brandMonogram =
    document.getElementById(
      "publicRestaurantMonogram"
    );

  const brandLogo =
    document.getElementById(
      "publicRestaurantLogo"
    );

  const brandAccent =
    document.getElementById(
      "publicRestaurantBrandAccent"
    );

  if (brandName) {
    brandName.textContent =
      name;
  }

  const safeLogoUrl =
    getSafePublicHttpUrl(
      data.restaurant.logo_url
    );

  if (brandLogo) {
    brandLogo.onerror = () => {
      brandLogo.hidden = true;
      if (brandMonogram) brandMonogram.hidden = false;
    };

    brandLogo.src =
      safeLogoUrl || "";

    brandLogo.alt =
      safeLogoUrl
        ? `${name} – logo`
        : "";

    brandLogo.hidden =
      !safeLogoUrl;
  }

  if (brandMonogram) {
    const initial =
      Array.from(name)[0] || "R";

    brandMonogram.textContent =
      initial.toLocaleUpperCase("cs-CZ");

    brandMonogram.hidden =
      Boolean(
        safeLogoUrl
      );
  }

  if (brandAccent) {
    brandAccent.hidden =
      true;
  }

  if (brand) {
    brand.href =
      `/r/${encodeURIComponent(
        String(
          data.restaurant.slug ||
          slug
        )
      )}${PUBLIC_LOCALE === "en" ? "?lang=en" : ""}`;
  }

  const accentColor =
    /^#[0-9a-fA-F]{6}$/.test(
      String(
        data.restaurant
          .accent_color ||
        ""
      )
    )
      ? String(
          data.restaurant
            .accent_color
        )
      : "#f59e0b";

  document.body.style.setProperty(
    "--restaurant-accent",
    accentColor
  );

  renderPublicRestaurantContact(
    data.restaurant
  );

  const badge =
    document.getElementById(
      "publicRestaurantBadge"
    );

  if (badge) {
    badge.textContent =
      publicText("Online rezervace a aktuální menu", "Online reservations and current menu");
  }

  const title =
    document.getElementById(
      "publicRestaurantHeroTitle"
    );

  if (title) {
    title.textContent =
      name;
  }

  const subtitle =
    document.getElementById(
      "publicRestaurantHeroSubtitle"
    );

  if (subtitle) {
    subtitle.textContent =
      String(
        data.restaurant
          .short_description ||
        ""
      ).trim() ||
      publicText("Prohlédněte si aktuální menu a rezervujte si stůl online.", "Browse the current menu and book a table online.");
  }

  return data.restaurant;
}

function showPublicRestaurantUnavailable(
  message = "Restaurace není dostupná."
) {
  setRestaurantAiVisibility(
    false
  );

  document.title =
    publicText("Restaurace není dostupná | AI Restaurace PRO", "Restaurant unavailable | AI Restaurace PRO");

  document
    .querySelectorAll(
      "[data-restaurant-only]"
    )
    .forEach(element => {
      element.hidden =
        true;
    });

  const badge =
    document.getElementById(
      "publicRestaurantBadge"
    );

  if (badge) {
    badge.textContent =
      publicText("Veřejná stránka není dostupná", "Public page unavailable");
  }

  const title =
    document.getElementById(
      "publicRestaurantHeroTitle"
    );

  if (title) {
    title.textContent =
      publicText("Restaurace není dostupná", "Restaurant unavailable");
  }

  const subtitle =
    document.getElementById(
      "publicRestaurantHeroSubtitle"
    );

  if (subtitle) {
    subtitle.textContent =
      PUBLIC_LOCALE === "en"
        ? "Please check the restaurant link."
        : String(message || "Zkontrolujte prosím odkaz restaurace.");
  }

  const brand =
    document.getElementById(
      "publicRestaurantBrand"
    );

  const brandName =
    document.getElementById(
      "publicRestaurantBrandName"
    );

  const brandMonogram =
    document.getElementById(
      "publicRestaurantMonogram"
    );

  const brandLogo =
    document.getElementById(
      "publicRestaurantLogo"
    );

  const brandAccent =
    document.getElementById(
      "publicRestaurantBrandAccent"
    );

  if (brandName) {
    brandName.textContent =
      "AI Restaurace";
  }

  if (brandLogo) {
    brandLogo.src =
      "";

    brandLogo.alt =
      "";

    brandLogo.hidden =
      true;
  }

  if (brandMonogram) {
    brandMonogram.textContent =
      "🍽️";

    brandMonogram.hidden =
      false;
  }

  const contact =
    document.getElementById(
      "publicRestaurantContact"
    );

  if (contact) {
    contact.replaceChildren();
    contact.hidden =
      true;
  }

  document.body.style.removeProperty(
    "--restaurant-accent"
  );

  if (brandAccent) {
    brandAccent.hidden =
      false;
  }

  if (brand) {
    brand.href =
      "/";
  }
}

async function publicRpc(functionName, body = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const internalMessage =
      await response
        .text()
        .catch(() => "");

    console.error(
      `Veřejné RPC ${functionName} selhalo:`,
      internalMessage || response.status
    );

    const error =
      new Error(
        "Veřejná data restaurace se nepodařilo načíst."
      );

    error.status =
      response.status;

    throw error;
  }

  return response.json();
}

function requirePublicRestaurantSlug() {
  if (!PUBLIC_RESTAURANT_SLUG) {
    throw new Error("V odkazu chybí restaurace. Otevři veřejnou stránku přes /r/slug nebo ?restaurant=slug.");
  }
  return PUBLIC_RESTAURANT_SLUG;
}

console.info("[AI Restaurace PRO] public slug flow loaded", PUBLIC_RESTAURANT_SLUG || "missing-slug");
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
    const slug = requirePublicRestaurantSlug();
    const rows = await publicRpc("get_public_reservation_settings_safe", { p_slug: slug });
    const row = Array.isArray(rows) ? (rows[0] || {}) : (rows || {});

    if (!row || Object.keys(row).length === 0) {
      throw new Error("Restaurace nemá veřejné nastavení rezervací.");
    }

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
    console.error("Veřejné nastavení rezervací se nepodařilo načíst:", error);
    publicReservationSettingsLoaded = false;
    showPublicReservationNotice(publicText("Nastavení rezervací není dostupné. Zkuste to prosím za chvíli.", "Booking settings are unavailable. Please try again shortly."));
    return null;
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

function getEffectiveReservationDuration(reservation) {
  const stored = Number(reservation?.duration_minutes);
  const byPeople = getPublicReservationDuration(Number(reservation?.people || 1));

  // Starší testovací rezervace mohou mít uloženou příliš krátkou délku
  // (např. 0/30 min). Pro kontrolu kolizí nikdy nepoužijeme kratší
  // interval, než jaký aktuálně vychází z pravidel podle počtu hostů.
  return Math.max(
    30,
    Number.isFinite(stored) ? stored : 0,
    Number.isFinite(byPeople) ? byPeople : 0
  );
}

function publicReservationsOverlap(first, second) {
  if (!first?.date || !second?.date || first.date !== second.date) {
    return false;
  }

  const firstStart = timeToMinutes(first.time);
  const secondStart = timeToMinutes(second.time);
  const firstEnd = firstStart + getEffectiveReservationDuration(first);
  const secondEnd = secondStart + getEffectiveReservationDuration(second);

  return firstStart < secondEnd && secondStart < firstEnd;
}

async function findBestPublicTable({ people }) {
  const slug = requirePublicRestaurantSlug();
  const rows = await publicRpc("get_public_restaurant_tables_safe", { p_slug: slug });
  const tables = Array.isArray(rows) ? rows : [];

  return tables
    .filter(table => table.active !== false && Number(table.capacity) >= Number(people))
    .sort((a, b) => Number(a.capacity) - Number(b.capacity) || Number(a.id) - Number(b.id))[0] || null;
}

async function checkPublicOpeningAvailability({ date, time, durationMinutes }) {
  const slug = requirePublicRestaurantSlug();
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  const endMinutes = timeToMinutes(time) + Number(durationMinutes || 120);

  const [hoursRowsRaw, blocksRaw] = await Promise.all([
    publicRpc("get_public_opening_hours_safe", { p_slug: slug }),
    publicRpc("get_public_blocked_times_safe", { p_slug: slug })
  ]);

  const hoursRows = (Array.isArray(hoursRowsRaw) ? hoursRowsRaw : []).filter(
    row => Number(row.day_of_week) === Number(dayOfWeek)
  );
  const blocks = (Array.isArray(blocksRaw) ? blocksRaw : []).filter(
    row => String(row.date || "") === String(date)
  );
  const hours = hoursRows[0];

  if (!hours || !hours.is_open) {
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
  try {
    const slug = requirePublicRestaurantSlug();
    const rows = await publicRpc("get_public_menu_safe", { p_slug: slug });
    menu = Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error("Veřejné menu se nepodařilo načíst:", error);
    menu = [];
  }
  renderPublicMenu();
}

function renderPublicMenu() {
  const container = document.getElementById("publicMenu");
  if (!container) return;

  container.replaceChildren();

  if (!menu.length) {
    const empty = document.createElement("p");
    empty.textContent = publicText("Menu je prázdné.", "The menu is empty.");
    container.appendChild(empty);
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
    .map(item => String(item.category || "Hlavní jídlo").trim())
    .filter(Boolean);

  const categories = [
    ...categoryOrder,
    ...categoriesFromMenu.filter(category => !categoryOrder.includes(category))
  ].filter((category, index, array) => array.indexOf(category) === index);

  container.className = "";
  container.style.display = "block";

  categories.forEach(category => {
    const items = menu.filter(
      item => String(item.category || "Hlavní jídlo").trim() === category
    );
    if (!items.length) return;

    const section = document.createElement("section");
    section.className = "menu-category";
    section.style.cssText = "width:100%;margin-bottom:70px;";

    const heading = document.createElement("h2");
    heading.style.cssText = "font-size:clamp(26px,5vw,36px);color:var(--restaurant-accent,#f59e0b);margin-bottom:25px;border-left:6px solid var(--restaurant-accent,#f59e0b);padding-left:15px;text-transform:uppercase;";
    heading.textContent = publicText(category, ({ "Předkrm": "Starters", "Hlavní jídlo": "Main courses", "Těstoviny": "Pasta", "Dezert": "Desserts", "Sladká jídla": "Sweet dishes", "Nápoj": "Drinks" })[category] || category);
    section.appendChild(heading);

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),260px));justify-content:center;gap:30px;";

    items.forEach(item => {
      const card = document.createElement("div");
      card.className = "food-card";
      card.addEventListener("click", () => openFoodDetail(item.id));

      if (item.image_url) {
        try {
          const imageUrl = new URL(String(item.image_url), window.location.origin);
          if (imageUrl.protocol === "https:" || (imageUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(imageUrl.hostname))) {
            const img = document.createElement("img");
            img.src = imageUrl.href;
            img.alt = String(item.name || publicText("Jídlo", "Dish"));
            img.loading = "lazy";
            img.style.cssText = "width:100%;height:180px;object-fit:cover;border-radius:18px;margin-bottom:18px;display:block;";
            card.appendChild(img);
          }
        } catch (_) {
          // Neplatnou URL obrázku bezpečně ignorujeme.
        }
      }

      if (!card.querySelector("img")) {
        const emoji = document.createElement("div");
        emoji.style.cssText = "width:100%;height:180px;display:flex;align-items:center;justify-content:center;font-size:64px;border-radius:18px;margin-bottom:18px;background:#111827;";
        emoji.textContent = String(item.emoji || "🍽️");
        card.appendChild(emoji);
      }

      const name = document.createElement("h3");
      name.textContent = String(item.name || "");
      card.appendChild(name);

      const price = document.createElement("p");
      price.textContent = `${String(item.price ?? "")} Kč`;
      card.appendChild(price);

      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}

function odpoved() {
  const input =
    document.getElementById(
      "dotaz"
    );

  const vysledek =
    document.getElementById(
      "vysledek"
    );

  if (
    !input ||
    !vysledek
  ) {
    return;
  }

  const text =
    input.value
      .toLowerCase()
      .trim();

  if (
    text.includes("menu")
  ) {
    vysledek.textContent =
      "🍽️ Menu se spravuje v dashboardu a hosté vždy vidí aktuální nabídku na veřejné stránce restaurace.";
  } else if (
    text.includes("otev")
  ) {
    vysledek.textContent =
      "🕒 Každá restaurace si nastaví vlastní otevírací dobu a blokované časy. Rezervační systém je automaticky respektuje.";
  } else if (
    text.includes("rezerv")
  ) {
    vysledek.textContent =
      "📅 Online rezervace hlídají kapacitu, provozní dobu, blokace a dostupnost stolů.";
  } else {
    vysledek.textContent =
      "Zkus napsat: menu, otevřeno nebo rezervace.";
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
    button.dataset.originalText = button.textContent.trim() || publicText("Potvrdit rezervaci", "Confirm reservation");
  }

  button.disabled = isSubmitting;
  button.setAttribute("aria-busy", String(isSubmitting));
  button.textContent = isSubmitting
    ? publicText("Ukládám rezervaci…", "Saving reservation…")
    : button.dataset.originalText;
}


function showPublicReservationNotice(message, type = null) {
  const notice = document.getElementById("reservationNotice");
  if (!notice) {
    console[type === "success" ? "log" : "warn"](message);
    return;
  }

  const text = String(message || "").trim();
  const resolvedType = type === "success" || (!type && text.startsWith("✅"))
    ? "success"
    : "error";

  notice.hidden = false;
  notice.className = `reservation-notice ${resolvedType}`;
  notice.replaceChildren();

  const icon = document.createElement("span");
  icon.className = "reservation-notice-icon";
  icon.textContent = resolvedType === "success" ? "✓" : "!";

  const messageText = document.createElement("span");
  messageText.textContent = text.replace(/^✅\s*/, "");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "reservation-notice-close";
  closeButton.setAttribute("aria-label", publicText("Zavřít", "Close"));
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => {
    notice.hidden = true;
  });

  notice.append(icon, messageText, closeButton);
  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setAvailableTimesStatus(message, type = "info") {
  const status = document.getElementById("availableTimesStatus");
  if (!status) return;
  status.textContent = message || "";
  status.dataset.type = type;
}

let availabilityRequestSequence = 0;
let availabilityAbortController = null;

async function loadAvailableReservationTimes() {
  const requestId = ++availabilityRequestSequence;
  if (availabilityAbortController) availabilityAbortController.abort();
  availabilityAbortController = new AbortController();

  const settings = await loadPublicReservationSettings();
  if (requestId !== availabilityRequestSequence) return;
  const dateInput = document.getElementById("datum");
  const peopleInput = document.getElementById("osoby");
  const timeSelect = document.getElementById("cas");
  if (!dateInput || !peopleInput || !timeSelect) return;

  if (!settings) {
    timeSelect.innerHTML = `<option value="">${publicText("Časy nejsou dostupné", "Times unavailable")}</option>`;
    timeSelect.disabled = true;
    setAvailableTimesStatus(publicText("Nastavení rezervací se nepodařilo načíst. Zkuste to prosím znovu.", "Booking settings could not be loaded. Please try again."), "error");
    return;
  }

  const date = dateInput.value;
  const people = Number(peopleInput.value);
  const previousValue = timeSelect.value;

  if (!date || !Number.isInteger(people) || people < publicReservationSettings.min_people || people > publicReservationSettings.max_people) {
    timeSelect.innerHTML = `<option value="">${publicText("Nejdřív vyber datum a počet osob", "Choose a date and number of guests first")}</option>`;
    timeSelect.disabled = true;
    setAvailableTimesStatus("");
    return;
  }

  const restaurantToday = publicRestaurantToday || localDateString(new Date());
  const maxAllowedDate = localDateString(
    addLocalDays(new Date(`${restaurantToday}T12:00:00`), publicReservationSettings.max_advance_days)
  );

  if (date > maxAllowedDate) {
    timeSelect.innerHTML = `<option value="">${publicText("Datum je mimo povolený rozsah", "Date is outside the booking window")}</option>`;
    timeSelect.disabled = true;
    setAvailableTimesStatus(
      publicText(`Rezervaci lze vytvořit maximálně ${publicReservationSettings.max_advance_days} dní dopředu.`, `Bookings can be made up to ${publicReservationSettings.max_advance_days} days ahead.`),
      "error"
    );
    return;
  }

  timeSelect.disabled = true;
  timeSelect.innerHTML = `<option value="">${publicText("Načítám volné časy…", "Loading available times…")}</option>`;
  setAvailableTimesStatus(publicText("Kontroluji otevírací dobu a skutečně volné stoly…", "Checking opening hours and available tables…"));

  try {
    // DŮLEŽITÉ: dostupnost počítá server se SERVICE ROLE klíčem.
    // Veřejný Supabase klient nemusí kvůli RLS vidět všechny rezervace,
    // a proto už o volných časech nerozhoduje přímo prohlížeč.
    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache"
      },
      cache: "no-store",
      signal: availabilityAbortController.signal,
      body: JSON.stringify({
        action: "available-times",
        slug: requirePublicRestaurantSlug(),
        date,
        people,
        _ts: Date.now()
      })
    });

    if (requestId !== availabilityRequestSequence) return;

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(PUBLIC_LOCALE === "en" ? "Available times could not be loaded." : data.error || "Volné časy se nepodařilo načíst.");
    }

    const slots = Array.isArray(data.slots) ? data.slots : [];
    if (!slots.length) {
      timeSelect.innerHTML = `<option value="">${publicText("Žádný volný čas", "No available times")}</option>`;
      setAvailableTimesStatus(PUBLIC_LOCALE === "en" ? "No tables are available for this date and party size." : data.message || "Pro zvolený den a počet osob už není volný termín.", "error");
      return;
    }

    timeSelect.replaceChildren();
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = publicText("Vyber čas", "Choose a time");
    timeSelect.appendChild(placeholderOption);

    slots.forEach(slot => {
      const safeSlot = String(slot || "");
      if (!/^\d{2}:\d{2}$/.test(safeSlot)) return;
      const option = document.createElement("option");
      option.value = safeSlot;
      option.textContent = safeSlot;
      timeSelect.appendChild(option);
    });
    timeSelect.disabled = timeSelect.options.length <= 1;
    if (slots.includes(previousValue)) timeSelect.value = previousValue;
    setAvailableTimesStatus(PUBLIC_LOCALE === "en" ? `${slots.length} available times` : data.message || `${slots.length} volných termínů`, "success");
  } catch (error) {
    if (error?.name === "AbortError" || requestId !== availabilityRequestSequence) return;
    console.error(error);
    timeSelect.innerHTML = `<option value="">${publicText("Časy se nepodařilo načíst", "Times could not be loaded")}</option>`;
    setAvailableTimesStatus(PUBLIC_LOCALE === "en" ? "Available times could not be loaded. Please try again." : error.message || "Volné časy se nepodařilo načíst. Zkus to znovu.", "error");
  }
}

async function ulozitRezervaci() {
  if (reservationSubmissionInProgress) return;
  if (!publicReservationSettingsLoaded) {
    showPublicReservationNotice(publicText("Nastavení rezervací se ještě načítá. Zkus to prosím za chvíli.", "Booking settings are still loading. Please try again shortly."));
    return;
  }

  const name = document.getElementById("jmeno").value.trim();
  const lastName = document.getElementById("prijmeni").value.trim();
  const people = document.getElementById("osoby").value.trim();
  const date = document.getElementById("datum").value;
  const time = document.getElementById("cas").value;
  const phone = document.getElementById("telefon").value.trim();
  const email = document.getElementById("email").value.trim();
  const note = document.getElementById("poznamka").value.trim();
  const namePattern = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]{1,79}$/u;

  if (!namePattern.test(name)) {
    showPublicReservationNotice(publicText("Zadej platné jméno alespoň o 2 písmenech.", "Enter a valid first name with at least 2 letters."));
    document.getElementById("jmeno").value = "";
    return;
  }

  if (!namePattern.test(lastName)) {
    showPublicReservationNotice(publicText("Zadej platné příjmení alespoň o 2 písmenech.", "Enter a valid last name with at least 2 letters."));
    document.getElementById("prijmeni").value = "";
    return;
  }

  const today =
    new Date();

  const localToday =
    publicRestaurantToday ||
    new Date(
      today.getTime() -
      today.getTimezoneOffset() * 60000
    )
      .toISOString()
      .split("T")[0];

  if (!date) {
    showPublicReservationNotice(publicText("Zadej platné datum rezervace.", "Choose a valid booking date."));
    return;
  }

  if (!time) {
    showPublicReservationNotice(publicText("Vyber volný čas rezervace.", "Choose an available booking time."));
    return;
  }

  if (date < localToday) {
    showPublicReservationNotice(publicText("Nelze vytvořit rezervaci na minulý den.", "You cannot book a date in the past."));
    return;
  }

  const maxDateBase =
    new Date(
      `${localToday}T12:00:00`
    );

  const localMaxDate =
    localDateString(
      addLocalDays(
        maxDateBase,
        publicReservationSettings.max_advance_days
      )
    );

  if (date > localMaxDate) {
    showPublicReservationNotice(publicText(`Rezervaci lze vytvořit maximálně ${publicReservationSettings.max_advance_days} dní dopředu.`, `Bookings can be made up to ${publicReservationSettings.max_advance_days} days ahead.`));
    return;
  }


  const peopleNumber = Number(people);
  if (!Number.isInteger(peopleNumber) || peopleNumber < publicReservationSettings.min_people || peopleNumber > publicReservationSettings.max_people) {
    showPublicReservationNotice(publicText(`Počet osob musí být od ${publicReservationSettings.min_people} do ${publicReservationSettings.max_people}.`, `The number of guests must be between ${publicReservationSettings.min_people} and ${publicReservationSettings.max_people}.`));
    return;
  }

  const phoneClean = phone.replace(/\s+/g, "");
  if (!/^\+?\d{9,15}$/.test(phoneClean)) {
    showPublicReservationNotice(publicText("Zadej platné telefonní číslo.", "Enter a valid phone number."));
    return;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    showPublicReservationNotice(publicText("Zadej platnou e-mailovou adresu.", "Enter a valid email address."));
    return;
  }

  if (!name || !lastName || !people || !date || !time || !phone || !email) {
    showPublicReservationNotice(publicText("Vyplň jméno, příjmení, počet osob, datum, čas, telefon a e-mail.", "Fill in your name, number of guests, date, time, phone and email."));
    return;
  }

  const reservationDurationMinutes =
    getPublicReservationDuration(
      peopleNumber
    );

  setPublicReservationSubmitting(true);

  try {
    // Kritická kontrola kolizí a výběr stolu probíhá na serveru.
    // Veřejný (anon) Supabase klient kvůli RLS nemusí vidět existující rezervace,
    // proto už nesmí rozhodovat o tom, který stůl je volný.
    const createResponse = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create-reservation",
        slug: requirePublicRestaurantSlug(),
        name,
        last_name: lastName,
        people: peopleNumber,
        date,
        time,
        phone,
        email,
        note,
        locale: document.documentElement.lang === "en" ? "en" : "cs"
      })
    });

    const createData = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok) {
      showPublicReservationNotice(PUBLIC_LOCALE === "en" ? (createResponse.status === 409 ? "This time is no longer available. Please choose another." : "The reservation could not be saved. Please check your details and try again.") : createData.error || "Rezervaci se nepodařilo uložit.");
      await loadAvailableReservationTimes();
      return;
    }

    showPublicReservationNotice(
      createData.email?.sent === true
        ? publicText("Rezervace byla úspěšně vytvořena. Potvrzení jsme poslali na zadaný e-mail.", "Your reservation was created. We sent a confirmation to your email.")
        : publicText("Rezervace byla úspěšně vytvořena, ale potvrzovací e-mail se nepodařilo odeslat. Kontaktujte prosím restauraci, pokud potřebujete potvrzení.", "Your reservation was created, but we could not send the email. Contact the restaurant if you need confirmation."),
      "success"
    );

    ["jmeno", "prijmeni", "osoby", "datum", "cas", "telefon", "email", "poznamka"]
      .forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
      });
    loadAvailableReservationTimes();
  } catch (error) {
    console.error(error);
    showPublicReservationNotice(PUBLIC_LOCALE === "en" ? "The reservation could not be saved. Please try again." : error.message || "Rezervaci se nepodařilo uložit.");
  } finally {
    setPublicReservationSubmitting(false);
  }
}


document.addEventListener("DOMContentLoaded", async () => {
  applyPublicPageMode();
  applyPublicLocale();
  setupRestaurantAi();

  if (
    !PUBLIC_RESTAURANT_SLUG
  ) {
    return;
  }

  try {
    await Promise.all([
      loadPublicRestaurantInfo(),
      loadPublicReservationSettings(),
      loadMenu()
    ]);
  } catch (error) {
    console.error(
      "Veřejná stránka restaurace se nepodařila kompletně načíst:",
      error
    );

    showPublicRestaurantUnavailable(
      (PUBLIC_LOCALE === "en" ? null : error?.message) ||
      publicText("Zkontrolujte prosím odkaz restaurace.", "Please check the restaurant link.")
    );

    return;
  }

  const dateInput =
    document.getElementById(
      "datum"
    );

  const peopleInput =
    document.getElementById(
      "osoby"
    );

  const timeSelect =
    document.getElementById(
      "cas"
    );

  if (dateInput) {
    const restaurantToday =
      publicRestaurantToday ||
      localDateString(
        new Date()
      );

    const maxDateBase =
      new Date(
        `${restaurantToday}T12:00:00`
      );

    const localMax =
      localDateString(
        addLocalDays(
          maxDateBase,
          publicReservationSettings.max_advance_days
        )
      );

    dateInput.min =
      restaurantToday;

    dateInput.max =
      localMax;

    dateInput.addEventListener(
      "change",
      loadAvailableReservationTimes
    );
  }

  if (peopleInput) {
    peopleInput.addEventListener(
      "input",
      () => {
        clearTimeout(
          peopleInput
            ._availabilityTimer
        );

        peopleInput
          ._availabilityTimer =
            setTimeout(
              loadAvailableReservationTimes,
              250
            );
      }
    );
  }

  if (timeSelect) {
    timeSelect.addEventListener(
      "focus",
      () => {
        if (
          timeSelect.disabled
        ) {
          loadAvailableReservationTimes();
        }
      }
    );
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
function openFoodDetail(id) {
  const item = menu.find(food => food.id === id);

  if (!item) return;

  document.getElementById("modalFoodName").textContent = item.name;
  document.getElementById("modalFoodPrice").textContent = `${item.price} Kč`;
  document.getElementById("modalFoodDescription").textContent =
    item.description || publicText("Neuvedeno", "Not provided");
  const ingredientsText = item.ingredients
  ? item.ingredients
      .split(",")
      .map(ingredient => ingredient.trim())
      .filter(Boolean)
      .join(", ")
  : publicText("Neuvedeno", "Not provided");

document.getElementById("modalFoodIngredients").textContent =
  ingredientsText;
  const weightLabel =
  item.category === "Nápoj" ? publicText("Objem:", "Volume:") : publicText("Gramáž:", "Weight:");

document.getElementById("modalWeightLabel").textContent = weightLabel;
  let weightText = item.weight || publicText("Neuvedeno", "Not provided");

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
const englishAllergenNames = {
  1: "cereals containing gluten", 2: "crustaceans", 3: "eggs", 4: "fish",
  5: "peanuts", 6: "soybeans", 7: "milk", 8: "tree nuts",
  9: "celery", 10: "mustard", 11: "sesame", 12: "sulphur dioxide and sulphites",
  13: "lupin", 14: "molluscs"
};

let allergensText = item.allergens || publicText("Neuvedeno", "Not provided");

if (/^[\d,\s]+$/.test(allergensText)) {
  allergensText = allergensText
    .split(",")
    .map(number => number.trim())
    .filter(Boolean)
    .map(number =>
      allergenNames[number]
        ? `${number} – ${(PUBLIC_LOCALE === "en" ? englishAllergenNames : allergenNames)[number]}`
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
