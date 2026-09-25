const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY = "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const RESTAURANT_LOGO_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"]
]);

const MAX_RESTAURANT_LOGO_BYTES =
  5 * 1024 * 1024;

let reservations = [];
let foods = [];
let restaurantTables = [];
let tableGroups = [];
let customerProfiles = [];

let currentRestaurantId = null;
let currentRestaurantName = "";
let currentRestaurantSlug = "";
let currentRestaurantIsPublished = false;
let currentRestaurantBranding = null;
let currentDashboardAiEnabled = false;
let dashboardAiRequestInProgress = false;
let openingHoursConfigured = false;
let reservationSettingsConfigured = false;
let currentUserRole = null;
let currentUserId = null;
let teamMembers = [];

let editingFoodId = null;
let editingImageUrl = "";
let editingTableId = null;

let pendingTableX = null;
let pendingTableY = null;

let selectedRoom = "Hlavní sál";

let mergeModeActive = false;
let selectedTablesForMerge = [];

let upcomingReservationTimer = null;
const shownUpcomingReservationAlerts = new Set();

function showDashboardNotice(message, type = "auto") {
  const text = String(message || "").trim();
  if (!text) return;

  let resolvedType = type;
  if (resolvedType === "auto") {
    const lower = text.toLowerCase();
    resolvedType = /úspěš|uložen|spojen|rozpojen/.test(lower)
      ? "success"
      : /obsazen|nepodař|nenalezen|vyplň|vyber|pouze|nemá přístup/.test(lower)
        ? "error"
        : "info";
  }

  let container = document.getElementById("dashboardNoticeContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "dashboardNoticeContainer";
    container.className = "dashboard-notice-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }

  const notice = document.createElement("div");
  notice.className = `dashboard-notice dashboard-notice--${resolvedType}`;
  notice.setAttribute("role", resolvedType === "error" ? "alert" : "status");

  const icon = resolvedType === "success" ? "✓" : resolvedType === "error" ? "!" : "i";
  notice.innerHTML = `
    <span class="dashboard-notice__icon">${icon}</span>
    <span class="dashboard-notice__text"></span>
    <button class="dashboard-notice__close" type="button" aria-label="Zavřít">×</button>
  `;
  notice.querySelector(".dashboard-notice__text").textContent = text;

  const close = () => {
    if (notice.classList.contains("is-leaving")) return;
    notice.classList.add("is-leaving");
    window.setTimeout(() => notice.remove(), 220);
  };

  notice.querySelector(".dashboard-notice__close").addEventListener("click", close);
  container.appendChild(notice);
  requestAnimationFrame(() => notice.classList.add("is-visible"));
  window.setTimeout(close, resolvedType === "error" ? 6500 : 4200);
}

function toggleMergeMode() {
  mergeModeActive = !mergeModeActive;

  const btn = document.getElementById("mergeModeButton");

  if (btn) {
    btn.textContent = mergeModeActive
      ? "✕ Zrušit spojování"
      : "🔗 Spojit stoly";
  }

  renderFloorMap();
}

  async function confirmTableMerge() {
  if (selectedTablesForMerge.length < 2) {
    showDashboardNotice("Vyber alespoň 2 stoly.");
    return;
  }

  try {
    await Promise.all([
      fetchReservationsSnapshot(),
      loadTables()
    ]);
  } catch (error) {
    console.error(
      "Čerstvý stav stolů a rezervací se nepodařilo načíst:",
      error
    );

    showDashboardNotice(
      "Stoly teď nelze bezpečně spojit. Obnov stránku a zkus to znovu."
    );
    return;
  }

  const selectedTables = restaurantTables.filter((table) =>
    selectedTablesForMerge.includes(Number(table.id))
  );

  if (selectedTables.length < 2) {
    showDashboardNotice("Vybrané stoly se nepodařilo najít.");
    return;
  }

  const inactiveTable =
    selectedTables.find(
      table =>
        table.active === false
    );

  if (inactiveTable) {
    showDashboardNotice(
      `${inactiveTable.name || "Vybraný stůl"} je neaktivní. Spojit lze jen aktivní stoly.`
    );
    return;
  }

  const groupedTable =
    selectedTables.find(
      table =>
        isTableInActiveGroup(
          table.id
        )
    );

  if (groupedTable) {
    showDashboardNotice(
      `${groupedTable.name || "Vybraný stůl"} už je součástí aktivní skupiny.`
    );
    return;
  }

  const reservedTable =
    selectedTables.find(
      table =>
        getReservationsUsingTableResource(
          table.id
        ).some(
          reservation =>
            reservationHasNotEnded(
              reservation
            )
        )
    );

  if (reservedTable) {
    showDashboardNotice(
      `${reservedTable.name || "Vybraný stůl"} má aktuální nebo budoucí rezervaci. Spoj ho až po přesunu nebo zrušení rezervace.`
    );
    return;
  }

  const rooms = [...new Set(
    selectedTables.map((table) => table.room || "Hlavní sál")
  )];

  if (rooms.length > 1) {
    showDashboardNotice("Spojit lze pouze stoly ze stejné místnosti.");
    return;
  }

  const totalCapacity = selectedTables.reduce(
    (sum, table) => sum + Number(table.capacity || 0),
    0
  );

  const groupName = selectedTables
    .map((table) => table.name || `Stůl ${table.id}`)
    .join(" + ");

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/table_groups`,
      {
        method: "POST",
        headers: getHeaders({
          Prefer: "return=minimal"
        }),
        body: JSON.stringify({
          restaurant_id: currentRestaurantId,
          room: rooms[0],
          name: groupName,
          table_ids: selectedTablesForMerge,
          total_capacity: totalCapacity
        })
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    showDashboardNotice("Stoly byly úspěšně spojeny.");

    selectedTablesForMerge = [];
    mergeModeActive = false;

    const mergeButton =
      document.getElementById("mergeModeButton");

    const confirmButton =
      document.getElementById("confirmMergeButton");

    const info =
      document.getElementById("mergeSelectionInfo");

    if (mergeButton) {
      mergeButton.textContent = "🔗 Spojit stoly";
    }

    if (confirmButton) {
      confirmButton.style.display = "none";
    }

    if (info) {
      info.textContent = "Vybráno: 0 stolů";
    }

   await loadTables();
  } catch (error) {
    console.error(error);
    showDashboardNotice("Spojení stolů se nepodařilo uložit.");
  }
}
  
let reservationChart = null;
let statusChart = null;

// Brání dvojkliku / paralelní změně stavu stejné rezervace.
// Jeden probíhající požadavek na rezervaci = maximálně jeden e-mail z tohoto UI.
const reservationStatusUpdatesInFlight = new Set();

function setReservationStatusButtonsBusy(id, busy) {
  const reservationId = Number(id);

  document
    .querySelectorAll(
      `[data-reservation-status-id="${reservationId}"]`
    )
    .forEach(button => {
      if (busy) {
        button.dataset.previousDisabled =
          button.disabled ? "1" : "0";
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.style.opacity = "0.55";
        button.style.pointerEvents = "none";
        return;
      }

      // Obnovíme jen tlačítka, která jsme skutečně zamkli.
      if (
        Object.prototype.hasOwnProperty.call(
          button.dataset,
          "previousDisabled"
        )
      ) {
        button.disabled =
          button.dataset.previousDisabled === "1";
        delete button.dataset.previousDisabled;
      }

      button.removeAttribute("aria-busy");
      button.style.opacity = "";
      button.style.pointerEvents = "";
    });
}

document.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  setupMobileNavigation();
  setupDashboardAi();
  setupRestaurantBrandingInputs();
document.querySelectorAll(".room-switch").forEach((button) => {
    button.addEventListener("click", () => {
        selectedRoom = button.dataset.room;

        document
            .querySelectorAll(".room-switch")
            .forEach((b) => b.classList.remove("active"));

        button.classList.add("active");

        renderFloorMap();
    });
});
  
  document
    .getElementById("search")
    ?.addEventListener("input", applyFilters);

  document
    .getElementById("statusFilter")
    ?.addEventListener("change", applyFilters);

  if (await ensureValidSession()) {
    // Po návratu z pozvánky může členství dorazit o zlomek sekundy později.
    // Krátký retry odstraní nutnost ručního refreshu.
    const restaurantLoaded = await loadRestaurantContextWithRetry();

    if (restaurantLoaded) {
      hideLogin();
      history.replaceState(null, "", "#prehled");
      await loadDashboardData();
    } else {
      clearSession();
      showLogin();
      showDashboardNotice("Účet není přiřazený k žádné aktivní restauraci.");
    }
  } else {
    showLogin();
  }
});

async function loadCurrentRestaurantInfo() {
  const link =
    document.getElementById(
      "publicRestaurantLink"
    );

  const label =
    document.getElementById(
      "currentRestaurantNameLabel"
    );

  if (!currentRestaurantId) {
    currentRestaurantName =
      "";

    currentRestaurantSlug =
      "";

    currentRestaurantIsPublished =
      false;

    currentRestaurantBranding =
      null;

    currentDashboardAiEnabled =
      false;

    if (link) {
      link.hidden =
        true;
    }

    if (label) {
      label.textContent =
        "Přehled provozu restaurace";
    }

    return null;
  }

  try {
    const response =
      await authorizedFetch(
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
                "dashboard-restaurant-info",
              restaurant_id:
                Number(
                  currentRestaurantId
                )
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
        data?.error ||
        "Údaje restaurace se nepodařilo načíst."
      );
    }

    currentRestaurantName =
      String(
        data.restaurant.name ||
        ""
      ).trim();

    if (currentRestaurantName) {
      document.title =
        `${currentRestaurantName} | AI Restaurace PRO`;
    }

    currentRestaurantSlug =
      String(
        data.restaurant.slug ||
        ""
      ).trim();

    if (label) {
      label.textContent =
        currentRestaurantName ||
        "Přehled provozu restaurace";
    }

    currentRestaurantIsPublished =
      data.restaurant
        .is_published ===
      true;

    currentDashboardAiEnabled =
      data.restaurant
        .ai_enabled ===
      true;

    currentRestaurantBranding =
      {
        ...data.restaurant
      };

    renderRestaurantBrandingForm(
      currentRestaurantBranding
    );

    if (
      link &&
      currentRestaurantSlug &&
      currentRestaurantIsPublished
    ) {
      link.href =
        `/r/${encodeURIComponent(
          currentRestaurantSlug
        )}`;

      link.hidden =
        false;

      link.target =
        "_blank";

      link.rel =
        "noopener";
    } else if (link) {
      link.hidden =
        true;
    }

    return data.restaurant;
  } catch (error) {
    console.error(
      "Údaje restaurace se nepodařilo načíst:",
      error
    );

    currentRestaurantName =
      "";

    currentRestaurantSlug =
      "";

    currentRestaurantIsPublished =
      false;

    currentRestaurantBranding =
      null;

    currentDashboardAiEnabled =
      false;

    if (link) {
      link.hidden =
        true;
    }

    if (label) {
      label.textContent =
        "Přehled provozu restaurace";
    }

    return null;
  }
}

function setDashboardAiBusy(
  busy
) {
  dashboardAiRequestInProgress =
    Boolean(busy);

  const button =
    document.getElementById(
      "dashboardAiSendButton"
    );

  const input =
    document.getElementById(
      "dashboardAiInput"
    );

  if (button) {
    button.disabled =
      dashboardAiRequestInProgress;

    button.textContent =
      dashboardAiRequestInProgress
        ? "Analyzuji…"
        : "Zeptat se";
  }

  if (input) {
    input.disabled =
      dashboardAiRequestInProgress;
  }

  document
    .querySelectorAll(
      "[data-dashboard-ai-question]"
    )
    .forEach(buttonElement => {
      buttonElement.disabled =
        dashboardAiRequestInProgress;
    });
}


function renderDashboardAiSnapshot(
  snapshot = {}
) {
  const values = {
    dashboardAiTodayReservations:
      snapshot
        .today_active_reservations,
    dashboardAiTodayGuests:
      snapshot
        .today_guests,
    dashboardAiLast30:
      snapshot
        .last_30_days_active_reservations,
    dashboardAiNext7:
      snapshot
        .next_7_days_active_reservations
  };

  Object.entries(
    values
  ).forEach(
    ([id, value]) => {
      const element =
        document.getElementById(
          id
        );

      if (!element) {
        return;
      }

      element.textContent =
        Number.isFinite(
          Number(value)
        )
          ? String(
              Number(value)
            )
          : "–";
    }
  );
}


async function askDashboardAi(
  questionOverride = ""
) {
  if (
    currentUserRole !==
      "owner" ||
    !currentDashboardAiEnabled ||
    !currentRestaurantId ||
    dashboardAiRequestInProgress
  ) {
    return;
  }

  const input =
    document.getElementById(
      "dashboardAiInput"
    );

  const answer =
    document.getElementById(
      "dashboardAiAnswer"
    );

  const question =
    String(
      questionOverride ||
      input?.value ||
      ""
    )
      .trim()
      .slice(
        0,
        601
      );

  if (!question) {
    if (answer) {
      answer.textContent =
        "Napiš prosím dotaz k provozu restaurace.";
    }

    input?.focus();
    return;
  }

  if (
    question.length >
    600
  ) {
    if (answer) {
      answer.textContent =
        "Dotaz může mít maximálně 600 znaků.";
    }

    return;
  }

  if (answer) {
    answer.textContent =
      "Analyzuji aktuální provozní data restaurace…";
  }

  setDashboardAiBusy(
    true
  );

  try {
    const response =
      await authorizedFetch(
        "/api/dashboard-ai",
        {
          method:
            "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify({
              restaurant_id:
                Number(
                  currentRestaurantId
                ),
              question
            })
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (
      !response.ok ||
      !data?.answer
    ) {
      throw new Error(
        data?.error ||
        "AI přehled teď není dostupný."
      );
    }

    if (answer) {
      answer.textContent =
        String(
          data.answer
        );
    }

    renderDashboardAiSnapshot(
      data.snapshot ||
      {}
    );

    if (
      input &&
      !questionOverride
    ) {
      input.value =
        "";
    }
  } catch (error) {
    console.error(
      "Dashboard AI:",
      error
    );

    if (answer) {
      answer.textContent =
        String(
          error?.message ||
          "AI přehled teď není dostupný. Zkus to prosím za chvíli."
        );
    }
  } finally {
    setDashboardAiBusy(
      false
    );
  }
}


function setupDashboardAi() {
  const form =
    document.getElementById(
      "dashboardAiForm"
    );

  if (
    form &&
    form.dataset.bound !==
      "true"
  ) {
    form.dataset.bound =
      "true";

    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        askDashboardAi();
      }
    );
  }

  document
    .querySelectorAll(
      "[data-dashboard-ai-question]"
    )
    .forEach(button => {
      if (
        button.dataset.bound ===
        "true"
      ) {
        return;
      }

      button.dataset.bound =
        "true";

      button.addEventListener(
        "click",
        () => {
          const question =
            String(
              button.dataset
                .dashboardAiQuestion ||
              ""
            ).trim();

          if (question) {
            askDashboardAi(
              question
            );
          }
        }
      );
    });
}


function normalizeRestaurantWebsiteUrl(
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
      new URL(raw);

    if (
      url.protocol !==
        "https:" &&
      url.protocol !==
        "http:"
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}


function updateRestaurantBrandingPreview() {
  const name =
    String(
      document
        .getElementById(
          "restaurantBrandName"
        )
        ?.value ||
      currentRestaurantName ||
      "Restaurace"
    ).trim() ||
    "Restaurace";

  const description =
    String(
      document
        .getElementById(
          "restaurantBrandDescription"
        )
        ?.value ||
      ""
    ).trim();

  const address =
    String(
      document
        .getElementById(
          "restaurantBrandAddress"
        )
        ?.value ||
      ""
    ).trim();

  const phone =
    String(
      document
        .getElementById(
          "restaurantBrandPhone"
        )
        ?.value ||
      ""
    ).trim();

  const email =
    String(
      document
        .getElementById(
          "restaurantBrandEmail"
        )
        ?.value ||
      ""
    ).trim();

  const accent =
    String(
      document
        .getElementById(
          "restaurantBrandAccent"
        )
        ?.value ||
      "#f59e0b"
    ).trim();

  const previewName =
    document.getElementById(
      "restaurantBrandPreviewName"
    );

  const previewDescription =
    document.getElementById(
      "restaurantBrandPreviewDescription"
    );

  const previewContact =
    document.getElementById(
      "restaurantBrandPreviewContact"
    );

  const fallback =
    document.getElementById(
      "restaurantLogoFallback"
    );

  const accentValue =
    document.getElementById(
      "restaurantBrandAccentValue"
    );

  const logoPreview =
    document.getElementById(
      "restaurantLogoPreview"
    );

  if (previewName) {
    previewName.textContent =
      name;
  }

  if (previewDescription) {
    previewDescription.textContent =
      description ||
      "Krátký popis restaurace se zobrazí tady.";
  }

  if (previewContact) {
    const parts =
      [
        address,
        phone,
        email
      ].filter(Boolean);

    previewContact.textContent =
      parts.length
        ? parts.join(" · ")
        : "Kontaktní údaje se doplní po uložení.";
  }

  if (fallback) {
    fallback.textContent =
      (
        Array.from(name)[0] ||
        "R"
      ).toLocaleUpperCase(
        "cs-CZ"
      );
  }

  if (accentValue) {
    accentValue.textContent =
      accent;
  }

  if (
    logoPreview &&
    /^#[0-9a-fA-F]{6}$/.test(
      accent
    )
  ) {
    logoPreview.style.setProperty(
      "--restaurant-accent",
      accent
    );
  }
}


function renderRestaurantBrandingForm(
  restaurant = {}
) {
  const get =
    id =>
      document.getElementById(
        id
      );

  const name =
    String(
      restaurant.name ||
      currentRestaurantName ||
      ""
    );

  const slug =
    String(
      restaurant.slug ||
      currentRestaurantSlug ||
      ""
    );

  const address =
    String(
      restaurant.address ||
      ""
    );

  const phone =
    String(
      restaurant.phone ||
      ""
    );

  const email =
    String(
      restaurant.email ||
      ""
    );

  const websiteUrl =
    normalizeRestaurantWebsiteUrl(
      restaurant.website_url
    );

  const description =
    String(
      restaurant.short_description ||
      ""
    );

  const accent =
    /^#[0-9a-fA-F]{6}$/.test(
      String(
        restaurant.accent_color ||
        ""
      )
    )
      ? String(
          restaurant.accent_color
        )
      : "#f59e0b";

  if (get("restaurantBrandName")) {
    get("restaurantBrandName").value =
      name;
  }

  if (get("restaurantBrandSlug")) {
    get("restaurantBrandSlug").value =
      slug;
  }

  if (get("restaurantBrandAddress")) {
    get("restaurantBrandAddress").value =
      address;
  }

  if (get("restaurantBrandPhone")) {
    get("restaurantBrandPhone").value =
      phone;
  }

  if (get("restaurantBrandEmail")) {
    get("restaurantBrandEmail").value =
      email;
  }

  if (get("restaurantBrandWebsite")) {
    get("restaurantBrandWebsite").value =
      websiteUrl;
  }

  if (get("restaurantBrandDescription")) {
    get("restaurantBrandDescription").value =
      description;
  }

  if (get("restaurantBrandAccent")) {
    get("restaurantBrandAccent").value =
      accent;
  }

  if (get("restaurantBrandPublished")) {
    get("restaurantBrandPublished").checked =
      restaurant.is_published ===
      true;
  }

  const logoUrl =
    getSafeHttpImageUrl(
      restaurant.logo_url
    );

  const logoImage =
    get(
      "restaurantLogoPreviewImage"
    );

  const logoFallback =
    get(
      "restaurantLogoFallback"
    );

  const removeLogoButton =
    get(
      "restaurantBrandRemoveLogoButton"
    );

  if (logoImage) {
    logoImage.onerror = () => {
      logoImage.hidden = true;
      if (logoFallback) logoFallback.hidden = false;
    };

    logoImage.hidden =
      !logoUrl;

    logoImage.src =
      logoUrl || "";
  }

  if (logoFallback) {
    logoFallback.hidden =
      Boolean(logoUrl);
  }

  if (removeLogoButton) {
    removeLogoButton.hidden =
      !logoUrl;
  }

  const publicLink =
    get(
      "restaurantBrandingPublicLink"
    );

  if (
    publicLink &&
    slug &&
    restaurant.is_published ===
      true
  ) {
    publicLink.href =
      `/r/${encodeURIComponent(
        slug
      )}`;

    publicLink.hidden =
      false;
  } else if (publicLink) {
    publicLink.hidden =
      true;
  }

  updateRestaurantBrandingPreview();
}


function canPublishRestaurantFromDashboard() {
  return (
    restaurantTables.some(
      table =>
        table?.active ===
        true
    ) &&
    openingHoursConfigured &&
    reservationSettingsConfigured &&
    foods.length > 0
  );
}


async function uploadRestaurantLogo(
  file
) {
  const extension =
    RESTAURANT_LOGO_TYPES.get(
      file?.type
    );

  if (!extension) {
    throw new Error(
      "Logo musí být JPG, PNG, WebP nebo AVIF."
    );
  }

  if (
    !file?.size ||
    file.size >
      MAX_RESTAURANT_LOGO_BYTES
  ) {
    throw new Error(
      "Logo může mít maximálně 5 MB."
    );
  }

  const fileName =
    "logo-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .slice(2) +
    "." +
    extension;

  const objectPath =
    `${Number(
      currentRestaurantId
    )}/branding/${fileName}`;

  const response =
    await authorizedFetch(
      `${SUPABASE_URL}/storage/v1/object/food-images/${objectPath}`,
      {
        method:
          "POST",
        headers:
          getHeaders({
            "Content-Type":
              file.type,
            "x-upsert":
              "false"
          }),
        body:
          file
      }
    );

  if (!response.ok) {
    throw new Error(
      "Logo se nepodařilo nahrát."
    );
  }

  return (
    `${SUPABASE_URL}/storage/v1/object/public/food-images/${objectPath}`
  );
}


async function saveRestaurantBranding() {
  if (
    currentUserRole !==
      "owner" ||
    !currentRestaurantId
  ) {
    showDashboardNotice(
      "Branding restaurace může upravovat pouze majitel.",
      "error"
    );
    return;
  }

  const name =
    String(
      document
        .getElementById(
          "restaurantBrandName"
        )
        ?.value ||
      ""
    ).trim();

  const address =
    String(
      document
        .getElementById(
          "restaurantBrandAddress"
        )
        ?.value ||
      ""
    ).trim();

  const phone =
    String(
      document
        .getElementById(
          "restaurantBrandPhone"
        )
        ?.value ||
      ""
    ).trim();

  const email =
    String(
      document
        .getElementById(
          "restaurantBrandEmail"
        )
        ?.value ||
      ""
    ).trim();

  const rawWebsite =
    String(
      document
        .getElementById(
          "restaurantBrandWebsite"
        )
        ?.value ||
      ""
    ).trim();

  const description =
    String(
      document
        .getElementById(
          "restaurantBrandDescription"
        )
        ?.value ||
      ""
    ).trim();

  const accent =
    String(
      document
        .getElementById(
          "restaurantBrandAccent"
        )
        ?.value ||
      "#f59e0b"
    ).trim();

  const published =
    document
      .getElementById(
        "restaurantBrandPublished"
      )
      ?.checked ===
    true;

  const logoFile =
    document
      .getElementById(
        "restaurantBrandLogo"
      )
      ?.files?.[0];

  if (
    !name ||
    name.length > 120 ||
    address.length > 300 ||
    phone.length > 40 ||
    email.length > 320 ||
    description.length > 500 ||
    rawWebsite.length > 1000 ||
    !/^#[0-9a-fA-F]{6}$/.test(
      accent
    )
  ) {
    showDashboardNotice(
      "Zkontroluj název, kontaktní údaje, popis a barvu restaurace.",
      "error"
    );
    return;
  }

  if (
    !isValidOptionalEmail(
      email
    )
  ) {
    showDashboardNotice(
      "Zadej platný e-mail, nebo ho nech prázdný.",
      "error"
    );
    return;
  }

  const websiteUrl =
    rawWebsite
      ? normalizeRestaurantWebsiteUrl(
          rawWebsite
        )
      : "";

  if (
    rawWebsite &&
    !websiteUrl
  ) {
    showDashboardNotice(
      "Web musí začínat http:// nebo https://.",
      "error"
    );
    return;
  }

  if (
    published &&
    !canPublishRestaurantFromDashboard()
  ) {
    showDashboardNotice(
      "Před zveřejněním dokonči aktivní stůl, provozní dobu, pravidla rezervací a alespoň jedno jídlo.",
      "error"
    );
    return;
  }

  const saveButton =
    document.getElementById(
      "restaurantBrandSaveButton"
    );

  if (saveButton) {
    saveButton.disabled =
      true;

    saveButton.textContent =
      "Ukládám…";
  }

  try {
    let logoUrl =
      getSafeHttpImageUrl(
        currentRestaurantBranding
          ?.logo_url
      );

    if (logoFile) {
      logoUrl =
        await uploadRestaurantLogo(
          logoFile
        );
    }

    const response =
      await authorizedFetch(
        `${SUPABASE_URL}/rest/v1/restaurants?id=eq.${Number(
          currentRestaurantId
        )}&select=id,name,slug,address,phone,email,logo_url,short_description,website_url,accent_color,is_published`,
        {
          method:
            "PATCH",
          headers:
            getHeaders({
              Prefer:
                "return=representation"
            }),
          body:
            JSON.stringify({
              name,
              address:
                address ||
                null,
              phone:
                phone ||
                null,
              email:
                email ||
                null,
              logo_url:
                logoUrl ||
                null,
              short_description:
                description ||
                null,
              website_url:
                websiteUrl ||
                null,
              accent_color:
                accent,
              is_published:
                published
            })
        }
      );

    const rows =
      await response
        .json()
        .catch(
          () => []
        );

    if (
      !response.ok ||
      !Array.isArray(
        rows
      ) ||
      !rows[0]
    ) {
      throw new Error(
        "Restauraci se nepodařilo uložit."
      );
    }

    currentRestaurantBranding =
      rows[0];

    currentRestaurantName =
      String(
        rows[0].name ||
        ""
      ).trim();

    currentRestaurantSlug =
      String(
        rows[0].slug ||
        ""
      ).trim();

    currentRestaurantIsPublished =
      rows[0].is_published ===
      true;

    const nameLabel =
      document.getElementById(
        "currentRestaurantNameLabel"
      );

    if (nameLabel) {
      nameLabel.textContent =
        currentRestaurantName ||
        "Přehled provozu restaurace";
    }

    if (currentRestaurantName) {
      document.title =
        `${currentRestaurantName} | AI Restaurace PRO`;
    }

    const mainPublicLink =
      document.getElementById(
        "publicRestaurantLink"
      );

    if (
      mainPublicLink &&
      currentRestaurantSlug &&
      currentRestaurantIsPublished
    ) {
      mainPublicLink.href =
        `/r/${encodeURIComponent(
          currentRestaurantSlug
        )}`;

      mainPublicLink.hidden =
        false;
    } else if (mainPublicLink) {
      mainPublicLink.hidden =
        true;
    }

    const fileInput =
      document.getElementById(
        "restaurantBrandLogo"
      );

    if (fileInput) {
      fileInput.value =
        "";
    }

    renderRestaurantBrandingForm(
      currentRestaurantBranding
    );

    renderSetupChecklist();

    showDashboardNotice(
      "Údaje restaurace byly uloženy.",
      "success"
    );
  } catch (error) {
    console.error(
      error
    );

    showDashboardNotice(
      String(
        error?.message ||
        "Restauraci se nepodařilo uložit."
      ),
      "error"
    );
  } finally {
    if (saveButton) {
      saveButton.disabled =
        false;

      saveButton.textContent =
        "Uložit restauraci";
    }
  }
}


async function removeRestaurantLogo() {
  if (
    currentUserRole !==
      "owner" ||
    !currentRestaurantId
  ) {
    return;
  }

  try {
    const response =
      await authorizedFetch(
        `${SUPABASE_URL}/rest/v1/restaurants?id=eq.${Number(
          currentRestaurantId
        )}&select=id,name,slug,address,phone,email,logo_url,short_description,website_url,accent_color,is_published`,
        {
          method:
            "PATCH",
          headers:
            getHeaders({
              Prefer:
                "return=representation"
            }),
          body:
            JSON.stringify({
              logo_url:
                null
            })
        }
      );

    const rows =
      await response
        .json()
        .catch(
          () => []
        );

    if (
      !response.ok ||
      !Array.isArray(
        rows
      ) ||
      !rows[0]
    ) {
      throw new Error(
        "Logo se nepodařilo odebrat."
      );
    }

    currentRestaurantBranding =
      rows[0];

    const fileInput =
      document.getElementById(
        "restaurantBrandLogo"
      );

    if (fileInput) {
      fileInput.value = "";
    }

    renderRestaurantBrandingForm(
      currentRestaurantBranding
    );

    showDashboardNotice(
      "Logo bylo odebráno.",
      "success"
    );
  } catch (error) {
    console.error(
      error
    );

    showDashboardNotice(
      String(
        error?.message ||
        "Logo se nepodařilo odebrat."
      ),
      "error"
    );
  }
}


function setupRestaurantBrandingInputs() {
  [
    "restaurantBrandName",
    "restaurantBrandAddress",
    "restaurantBrandPhone",
    "restaurantBrandEmail",
    "restaurantBrandDescription",
    "restaurantBrandAccent"
  ].forEach(
    id => {
      document
        .getElementById(
          id
        )
        ?.addEventListener(
          "input",
          updateRestaurantBrandingPreview
        );
    }
  );

  document
    .getElementById(
      "restaurantBrandLogo"
    )
    ?.addEventListener(
      "change",
      event => {
        const file =
          event.target
            ?.files?.[0];

        if (!file) {
          renderRestaurantBrandingForm(
            currentRestaurantBranding ||
            {}
          );
          return;
        }

        const extension =
          RESTAURANT_LOGO_TYPES.get(
            file.type
          );

        if (
          !extension ||
          file.size <= 0 ||
          file.size >
            MAX_RESTAURANT_LOGO_BYTES
        ) {
          showDashboardNotice(
            "Logo musí být JPG, PNG, WebP nebo AVIF a mít maximálně 5 MB.",
            "error"
          );

          event.target.value =
            "";

          return;
        }

        const logoImage =
          document.getElementById(
            "restaurantLogoPreviewImage"
          );

        const fallback =
          document.getElementById(
            "restaurantLogoFallback"
          );

        if (logoImage) {
          logoImage.src =
            URL.createObjectURL(
              file
            );

          logoImage.hidden =
            false;
        }

        if (fallback) {
          fallback.hidden =
            true;
        }
      }
    );

  document
    .getElementById(
      "restaurantBrandAccent"
    )
    ?.addEventListener(
      "change",
      updateRestaurantBrandingPreview
    );
}


function setSetupStepState(elementId, completed) {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.classList.toggle("is-complete", Boolean(completed));

  const status = element.querySelector(".setup-step-status");
  if (status) {
    status.textContent = completed ? "✓" : "○";
  }

  const action = element.querySelector(".setup-step-action:not(.setup-public-link)");
  if (action) {
    action.textContent = completed ? "Hotovo" : "Nastavit →";
  }
}

function renderSetupChecklist() {
  const panel = document.getElementById("setupChecklistPanel");
  if (!panel) return;

  const activeSection =
    window.location.hash.replace("#", "") || "prehled";

  if (
    currentUserRole !== "owner" ||
    activeSection !== "prehled"
  ) {
    panel.hidden = true;
    return;
  }

  const brandingReady =
    Boolean(
      currentRestaurantBranding &&
      String(
        currentRestaurantBranding.name ||
        ""
      ).trim() &&
      (
        String(
          currentRestaurantBranding.address ||
          ""
        ).trim() ||
        String(
          currentRestaurantBranding.phone ||
          ""
        ).trim() ||
        String(
          currentRestaurantBranding.email ||
          ""
        ).trim() ||
        String(
          currentRestaurantBranding.logo_url ||
          ""
        ).trim() ||
        String(
          currentRestaurantBranding.short_description ||
          ""
        ).trim()
      )
    );

  const checks = {
    tables:
      restaurantTables.some(
        table =>
          table?.active ===
          true
      ),
    hours:
      openingHoursConfigured,
    settings:
      reservationSettingsConfigured,
    menu:
      foods.length > 0,
    branding:
      brandingReady,
    public:
      currentRestaurantIsPublished &&
      Boolean(
        currentRestaurantSlug
      )
  };

  const completed =
    Object.values(checks).filter(Boolean).length;

  const total =
    Object.keys(checks).length;

  if (completed >= total) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;

  const percentage =
    Math.round((completed / total) * 100);

  const summary =
    document.getElementById("setupChecklistSummary");

  const progressValue =
    document.getElementById("setupProgressValue");

  const progressBar =
    document.getElementById("setupProgressBar");

  if (summary) {
    summary.textContent =
      `Hotovo ${completed} z ${total} kroků. Dokonči základní nastavení a restaurace bude připravená pro pilot.`;
  }

  if (progressValue) {
    progressValue.textContent =
      `${percentage} %`;
  }

  if (progressBar) {
    progressBar.style.width =
      `${percentage}%`;
  }

  setSetupStepState(
    "setupStepTables",
    checks.tables
  );
  setSetupStepState(
    "setupStepHours",
    checks.hours
  );
  setSetupStepState(
    "setupStepSettings",
    checks.settings
  );
  setSetupStepState(
    "setupStepMenu",
    checks.menu
  );
  setSetupStepState(
    "setupStepBranding",
    checks.branding
  );
  setSetupStepState(
    "setupStepPublic",
    checks.public
  );

  const publicHint =
    document.getElementById("setupPublicHint");

  const publicLink =
    document.getElementById("setupPublicLink");

  if (publicHint) {
    publicHint.textContent =
      checks.public
        ? "Veřejná stránka restaurace je aktivní."
        : "Veřejný web aktivujeme při spuštění pilotu.";
  }

  if (publicLink) {
    if (checks.public) {
      publicLink.href =
        `/r/${encodeURIComponent(currentRestaurantSlug)}`;
      publicLink.hidden =
        false;
    } else {
      publicLink.href =
        "#";
      publicLink.hidden =
        true;
    }
  }
}

async function loadDashboardData() {
  // Role a navigace se aplikují HNED po načtení kontextu uživatele.
  // Zaměstnanec tak po aktivaci pozvánky neuvidí výchozí stav Majitele
  // a nemusí stránku ručně obnovovat.
  applyRolePermissions();
  const requestedSection = window.location.hash.replace("#", "") || "prehled";
  showDashboardSection(requestedSection, { notifyDenied: true });

  await Promise.all([
    loadCurrentRestaurantInfo(),
    loadTables(),
    loadFoods(),
    loadOpeningHours(),
    loadBlockedTimes(),
    loadReservationSettings(),
    loadReservationHistory(),
    loadCustomerProfiles(),
    loadTeamMembers()
  ]);

  await loadReservations();
  renderSetupChecklist();

  // Po načtení dat ještě jednou sjednotíme navigaci a oprávnění.
  applyRolePermissions();
  showDashboardSection(window.location.hash.replace("#", "") || "prehled", { notifyDenied: false });

  if (!window.__reservationNotificationPoll) {
    window.__reservationNotificationPoll = setInterval(() => {
      if (currentRestaurantId) loadReservations();
    }, 30000);
  }
}

function setupMobileNavigation() {
  const button = document.getElementById("mobileMenuButton");
  const sidebar = document.getElementById("dashboardSidebar");
  const overlay = document.getElementById("mobileMenuOverlay");

  if (!button || !sidebar || !overlay) return;

  const closeMenu = () => {
    sidebar.classList.remove("mobile-open");
    overlay.classList.remove("visible");
    document.body.classList.remove("mobile-menu-open");
    button.setAttribute("aria-expanded", "false");
  };

  const openMenu = () => {
    sidebar.classList.add("mobile-open");
    overlay.classList.add("visible");
    document.body.classList.add("mobile-menu-open");
    button.setAttribute("aria-expanded", "true");
  };

  button.addEventListener("click", () => {
    sidebar.classList.contains("mobile-open") ? closeMenu() : openMenu();
  });

  overlay.addEventListener("click", closeMenu);

  sidebar.querySelectorAll("nav a").forEach(link => {
    link.addEventListener("click", closeMenu);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1100) closeMenu();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });
}

function setupNavigation() {
  document.querySelectorAll(".sidebar nav a").forEach(link => {
    link.addEventListener("click", function () {
      document
        .querySelectorAll(".sidebar nav a")
        .forEach(item => item.classList.remove("active"));

      this.classList.add("active");
    });
  });
}

/* =========================================================
   PŘIHLÁŠENÍ
========================================================= */

function showLogin() {
  document.getElementById("loginScreen").style.display = "flex";
}

function hideLogin() {
  document.getElementById("loginScreen").style.display = "none";
}

function consumeDashboardSessionHandoff() {
  try {
    const raw = localStorage.getItem("dashboardSessionHandoff");
    if (!raw) return false;

    const handoff = JSON.parse(raw);
    const age = Date.now() - Number(handoff?.created_at || 0);

    // Předání je jen krátkodobé a jednorázové.
    if (!handoff?.access_token || age < 0 || age > 10 * 60 * 1000) {
      localStorage.removeItem("dashboardSessionHandoff");
      return false;
    }

    sessionStorage.setItem("dashboardLoggedIn", "true");
    sessionStorage.setItem("supabaseAccessToken", handoff.access_token);
    if (handoff.refresh_token) {
      sessionStorage.setItem("supabaseRefreshToken", handoff.refresh_token);
    }

    localStorage.removeItem("dashboardSessionHandoff");
    return true;
  } catch (error) {
    localStorage.removeItem("dashboardSessionHandoff");
    return false;
  }
}

function getAccessToken() {
  let token = sessionStorage.getItem("supabaseAccessToken");
  if (!token && consumeDashboardSessionHandoff()) {
    token = sessionStorage.getItem("supabaseAccessToken");
  }
  return token;
}

function getRefreshToken() {
  if (!sessionStorage.getItem("supabaseRefreshToken")) {
    consumeDashboardSessionHandoff();
  }
  return sessionStorage.getItem("supabaseRefreshToken");
}

function clearSession() {
  sessionStorage.removeItem("dashboardLoggedIn");
  sessionStorage.removeItem("supabaseAccessToken");
  sessionStorage.removeItem("supabaseRefreshToken");
  localStorage.removeItem("dashboardSessionHandoff");

  currentRestaurantId =
    null;

  currentRestaurantName =
    "";

  currentRestaurantSlug =
    "";

  currentRestaurantIsPublished =
    false;

  currentRestaurantBranding =
    null;

  currentDashboardAiEnabled =
    false;

  dashboardAiRequestInProgress =
    false;

  openingHoursConfigured =
    false;

  reservationSettingsConfigured =
    false;

  currentUserRole =
    null;

  currentUserId =
    null;
}


function getHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${getAccessToken()}`,
    "Content-Type": "application/json",
    ...extra
  };
}

function parseJwt(token) {
  try {
    const part = token
      .split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    return JSON.parse(
      decodeURIComponent(
        atob(part)
          .split("")
          .map(character => {
            return (
              "%" +
              character
                .charCodeAt(0)
                .toString(16)
                .padStart(2, "0")
            );
          })
          .join("")
      )
    );
  } catch {
    return null;
  }
}
async function loadRestaurantContext() {
  const token =
    getAccessToken();

  const payload =
    parseJwt(token);

  if (!payload?.sub) {
    return false;
  }

  try {
    // 1) Nejdřív hledáme AKTIVNÍ členství v restaurant_team.
    // To je hlavní zdroj oprávnění pro manager/staff a případně i owner.
    const teamResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/restaurant_team?user_id=eq.${encodeURIComponent(
          payload.sub
        )}&active=eq.true&select=restaurant_id,role&order=id.asc&limit=2`,
        {
          method: "GET",
          headers: getHeaders()
        }
      );

    if (teamResponse.ok) {
      const memberships =
        await teamResponse.json();

      if (
        Array.isArray(memberships) &&
        memberships.length > 1
      ) {
        console.error(
          "Účet má více aktivních restaurací. Přepínač restaurací zatím není ve V1 podporovaný."
        );

        return false;
      }

      const membership =
        memberships?.[0];

      if (
        membership?.restaurant_id
      ) {
        const teamRole =
          String(
            membership.role || ""
          )
            .toLowerCase()
            .trim();

        if (
          [
            "owner",
            "manager",
            "staff"
          ].includes(teamRole)
        ) {
          currentUserId =
            payload.sub;

          currentRestaurantId =
            membership.restaurant_id;

          currentUserRole =
            teamRole;

          return true;
        }
      }
    }

    // 2) Když aktivní team membership není nalezený,
    // zkontrolujeme profiles.
    //
    // DŮLEŽITÉ:
    // fallback přes profiles dovolujeme JEN ownerovi.
    // Manager/staff tímto nesmí obejít deaktivaci v restaurant_team.
    const profileResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(
          payload.sub
        )}&select=restaurant_id,role`,
        {
          method: "GET",
          headers: getHeaders()
        }
      );

    if (!profileResponse.ok) {
      throw new Error(
        await profileResponse.text()
      );
    }

    const profiles =
      await profileResponse.json();

    const profile =
      profiles?.[0];

    const profileRole =
      String(
        profile?.role || ""
      )
        .toLowerCase()
        .trim();

    if (
      profile?.restaurant_id &&
      profileRole === "owner"
    ) {
      currentUserId =
        payload.sub;

      currentRestaurantId =
        profile.restaurant_id;

      currentUserRole =
        "owner";

      return true;
    }

    // Pokud je uživatel manager/staff bez aktivního membershipu,
    // přístup zůstane správně zablokovaný.
    if (
      profile?.restaurant_id &&
      [
        "manager",
        "staff"
      ].includes(profileRole)
    ) {
      console.error(
        "Uživatel nemá aktivní členství v restaurant_team."
      );

      return false;
    }

    console.error(
      "Uživatel není přiřazený k aktivní restauraci."
    );

    return false;
  } catch (error) {
    console.error(
      "Nepodařilo se načíst restauraci:",
      error
    );

    return false;
  }
}

async function loadRestaurantContextWithRetry(attempts = 5, delayMs = 350) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await loadRestaurantContext()) return true;
    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

let roleRefreshInProgress = false;
let lastRoleRefreshAt = 0;

async function refreshCurrentUserContext(options = {}) {
  const { force = false } = options;
  if (!getAccessToken() || roleRefreshInProgress) return;
  if (!force && Date.now() - lastRoleRefreshAt < 5000) return;

  roleRefreshInProgress = true;
  try {
    if (!(await ensureValidSession())) return;
    const previousRole = currentUserRole;
    const previousRestaurantId = currentRestaurantId;
    const ok = await loadRestaurantContextWithRetry(3, 250);

    if (!ok) {
      clearSession();
      showLogin();
      return;
    }

    lastRoleRefreshAt = Date.now();
    applyRolePermissions();
    showDashboardSection(window.location.hash.replace("#", "") || "prehled", { notifyDenied: false });

    // Když majitel změnil zaměstnanci roli nebo restauraci, přenačteme data
    // automaticky při návratu do aplikace.
    if (previousRole && (previousRole !== currentUserRole || previousRestaurantId !== currentRestaurantId)) {
      history.replaceState(null, "", "#prehled");
      await loadDashboardData();
      showDashboardNotice(`Přístup byl aktualizován: ${roleLabel(currentUserRole)}.`, "success");
    }
  } catch (error) {
    console.error("Aktualizace role se nepodařila:", error);
  } finally {
    roleRefreshInProgress = false;
  }
}

window.addEventListener("focus", () => refreshCurrentUserContext());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshCurrentUserContext();
});
window.addEventListener("pageshow", () => refreshCurrentUserContext({ force: true }));

// Role se může změnit na jiném zařízení (např. Majitel změní Obsluhu na Manažera).
// Pravidelná tichá kontrola znamená, že zaměstnanec nemusí ručně obnovovat stránku.
const roleRefreshTimer = setInterval(() => {
  if (document.visibilityState === "visible" && getAccessToken()) {
    refreshCurrentUserContext();
  }
}, 10000);

function tokenNeedsRefresh() {
  const token = getAccessToken();

  if (!token) {
    return true;
  }

  const payload = parseJwt(token);

  return (
    !payload?.exp ||
    payload.exp * 1000 <= Date.now() + 60000
  );
}

async function refreshSession() {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          refresh_token: refreshToken
        })
      }
    );

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      return false;
    }

    sessionStorage.setItem(
      "dashboardLoggedIn",
      "true"
    );

    sessionStorage.setItem(
      "supabaseAccessToken",
      data.access_token
    );

    if (data.refresh_token) {
      sessionStorage.setItem(
        "supabaseRefreshToken",
        data.refresh_token
      );
    }

    return true;
  } catch {
    return false;
  }
}

async function ensureValidSession() {
  if (!getAccessToken()) {
    return false;
  }

  if (!tokenNeedsRefresh()) {
    return true;
  }

  const refreshed = await refreshSession();

  if (!refreshed) {
    clearSession();
  }

  return refreshed;
}

async function authorizedFetch(url, options = {}) {
  if (!(await ensureValidSession())) {
    showLogin();
    throw new Error("Přihlášení vypršelo.");
  }

  let response = await fetch(url, {
    ...options,
   headers: {
    ...getHeaders(),
    ...(options.headers || {})
}
  });

  if (
    response.status === 401 &&
    await refreshSession()
  ) {
    response = await fetch(url, {
      ...options,
     headers: {
    ...getHeaders(),
    ...(options.headers || {})
}
    });
  }

  if (response.status === 401) {
    clearSession();
    showLogin();
  }

  return response;
}

async function login(event) {
  event?.preventDefault();

  const emailInput =
    document.getElementById("loginEmail");

  const passwordInput =
    document.getElementById("password");

  const error =
    document.getElementById("error");

  const button =
    document.getElementById("loginButton");

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    error.textContent =
      "Vyplň e-mail a heslo.";

    return;
  }

  button.disabled = true;
  error.textContent = "Přihlašuji...";

  try {
    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      }
    );

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      error.textContent =
        "Nesprávný e-mail nebo heslo.";

      passwordInput.value = "";
      return;
    }

    sessionStorage.setItem(
      "dashboardLoggedIn",
      "true"
    );

    sessionStorage.setItem(
      "supabaseAccessToken",
      data.access_token
    );

    sessionStorage.setItem(
      "supabaseRefreshToken",
      data.refresh_token
    );

    passwordInput.value = "";
    error.textContent = "";

    // Po přihlášení MUSÍME nejdřív načíst restauraci a roli. Dříve se
    // dashboard načetl bez nového kontextu a správná role se někdy objevila
    // až po ručním refreshi.
    const restaurantLoaded = await loadRestaurantContextWithRetry();
    if (!restaurantLoaded) {
      clearSession();
      showLogin();
      error.textContent = "Účet není přiřazený k aktivní restauraci.";
      return;
    }

    hideLogin();
    history.replaceState(null, "", "#prehled");
    await loadDashboardData();
  } catch (loginError) {
    console.error(loginError);

    error.textContent =
      "Přihlášení se nepodařilo.";
  } finally {
    button.disabled = false;
  }
}

async function logoutDashboard() {
  const accessToken = getAccessToken();
  clearSession();
  showLogin();

  try {
    if (accessToken) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${accessToken}`
        },
        signal: AbortSignal.timeout(5000)
      });
    }
  } catch (error) {
    console.error("Odhlášení ze serveru se nepodařilo:", error);
  } finally {
    location.reload();
  }
}

/* =========================================================
   POMOCNÉ FUNKCE
========================================================= */

function getLocalDateString(date = new Date()) {
  return new Date(
    date.getTime() -
    date.getTimezoneOffset() * 60000
  )
    .toISOString()
    .split("T")[0];
}

function formatDate(date) {
  if (!date) {
    return "-";
  }

  const parts = date.split("-");

  return parts.length === 3
    ? `${parts[2]}.${parts[1]}.${parts[0]}`
    : date;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getReservationGuestName(reservation) {
  return [reservation?.name, reservation?.last_name]
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .join(" ") || "-";
}

function isValidOptionalEmail(value) {
  const email = String(value || "").trim();

  return (
    !email ||
    (
      email.length <= 320 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
  );
}

/* =========================================================
   REZERVACE
========================================================= */

async function fetchReservationsSnapshot() {
  const response =
    await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/reservations?restaurant_id=eq.${currentRestaurantId}&select=*&order=id.desc`,
      {
        headers:
          getHeaders({
            "Cache-Control":
              "no-cache"
          })
      }
    );

  const data =
    await response
      .json()
      .catch(() => []);

  if (!response.ok) {
    throw new Error(
      JSON.stringify(
        data
      )
    );
  }

  const snapshot =
    Array.isArray(data)
      ? data
      : [];

  reservations =
    snapshot;

  return snapshot;
}

async function loadReservations() {
  const table =
    document.getElementById(
      "reservationTable"
    );

  try {
    await fetchReservationsSnapshot();

    updateStatistics();
    renderReservations(
      reservations
    );
    refreshReservationNotifications();
    renderCalendar();
    renderCharts();
    renderFloorMap();
    renderUpcomingReservations();
    startUpcomingReservationTimer();
    renderCustomers();
    return true;
  } catch (error) {
    console.error(
      error
    );

    if (table) {
      table.innerHTML = `
        <tr>
          <td colspan="10">
            Nepodařilo se načíst rezervace.
          </td>
        </tr>
      `;
    }
    return false;
  }
}

function reservationNotificationStorageKey() {
  return `reservationNotificationsReadThrough:${currentRestaurantId || "default"}`;
}

function getReservationReadThroughId() {
  return Number(localStorage.getItem(reservationNotificationStorageKey()) || 0);
}

function setReservationReadThroughId(id) {
  localStorage.setItem(reservationNotificationStorageKey(), String(Number(id) || 0));
}

function getIndividuallyReadReservationIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(reservationNotificationStorageKey() + ":items") || "[]");
    return new Set(Array.isArray(ids) ? ids.filter(id => Number.isSafeInteger(id) && id > 0) : []);
  } catch {
    return new Set();
  }
}

function markReservationNotificationRead(id) {
  const readThrough = getReservationReadThroughId();
  if (!Number.isSafeInteger(id) || id <= readThrough) return;
  const ids = getIndividuallyReadReservationIds();
  ids.add(id);
  localStorage.setItem(reservationNotificationStorageKey() + ":items", JSON.stringify([...ids]));
}

function getReservationNotificationItems() {
  const readThrough = getReservationReadThroughId();
  const individuallyRead = getIndividuallyReadReservationIds();
  const sorted = [...reservations]
    .filter(item => Number(item?.id) > 0 && Number(item.id) > readThrough && !individuallyRead.has(Number(item.id)))
    .sort((a, b) => Number(b.id) - Number(a.id));

  // Při prvním spuštění upozornění zobrazíme jen několik nejnovějších,
  // aby staré testovací rezervace nezaplnily celý zvonek.
  return sorted.slice(0, readThrough ? 20 : 8);
}

function refreshReservationNotifications() {
  const badge = document.getElementById("reservationNotificationBadge");
  const list = document.getElementById("reservationNotificationList");
  const overview = document.getElementById("reservationAlertOverview");
  const title = document.getElementById("reservationAlertOverviewTitle");
  const text = document.getElementById("reservationAlertOverviewText");
  if (!badge || !list) return;

  const unread = getReservationNotificationItems();
  const readThrough = getReservationReadThroughId();
  const individuallyRead = getIndividuallyReadReservationIds();
  const count = readThrough
    ? reservations.filter(item => Number(item?.id) > readThrough && !individuallyRead.has(Number(item.id))).length
    : unread.length;

  badge.textContent = String(count);
  badge.hidden = count === 0;

  if (overview) overview.classList.toggle("has-unread", count > 0);

  if (!count) {
    list.innerHTML = `
      <div class="reservation-notification-empty">
        <span>✓</span>
        <div>
          <strong>Žádná nepřečtená upozornění</strong>
          <small>Nové rezervace se objeví automaticky.</small>
        </div>
      </div>`;
    if (title) title.textContent = "Žádná nepřečtená upozornění";
    if (text) text.textContent = "Jakmile přijde nová rezervace, objeví se tady i ve zvonku nahoře.";
    return;
  }

  list.innerHTML = unread.map(reservation => {
    const fullName = getReservationGuestName(reservation) === "-" ? "Nový host" : getReservationGuestName(reservation);
    const tableLabel = getReservationTableLabel(reservation);
    const people = Number(reservation.people || 0);
    return `
      <button type="button" class="reservation-notification-item unread" onclick="openReservationFromNotification(${Number(reservation.id)})">
        <span class="reservation-notification-dot"></span>
        <span class="reservation-notification-copy">
          <strong>${escapeHtml(fullName)}</strong>
          <small>${escapeHtml(formatDate(reservation.date))} · ${escapeHtml(String(reservation.time || "").slice(0,5))} · ${people} ${people === 1 ? "osoba" : "osob"}</small>
          <em>${escapeHtml(tableLabel || "Bez stolu")}</em>
        </span>
      </button>`;
  }).join("");

  if (title) title.textContent = count === 1 ? "1 nepřečtené upozornění" : `${count} nepřečtených upozornění`;
  if (text) {
    const newest = unread[0];
    const guest = getReservationGuestName(newest) === "-" ? "Nový host" : getReservationGuestName(newest);
    text.textContent = `${guest} · ${String(newest.time || "").slice(0,5)} · ${getReservationTableLabel(newest)}` +
      (count > unread.length ? ` · Ve zvonku je zobrazeno ${unread.length} nejnovějších.` : "");
  }
}

function toggleReservationNotifications(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const panel = document.getElementById("reservationNotificationPanel");
  const button = document.getElementById("reservationNotificationButton");
  if (!panel) return;
  const open = !panel.classList.contains("open");
  panel.classList.toggle("open", open);
  if (button) button.setAttribute("aria-expanded", String(open));
}

function markAllReservationNotificationsRead() {
  const maxId = reservations.reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0);
  setReservationReadThroughId(maxId);
  localStorage.removeItem(reservationNotificationStorageKey() + ":items");
  refreshReservationNotifications();
}

function openReservationFromNotification(id) {
  const reservation = reservations.find(item => Number(item.id) === Number(id));
  if (!reservation) return;

  markReservationNotificationRead(Number(id));
  refreshReservationNotifications();

  showDashboardSection("rezervace", { notifyDenied: false });
  history.replaceState(null, "", "#rezervace");

  setTimeout(() => {
    const row = document.querySelector(`[data-reservation-id="${Number(id)}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 100);
}

// Zavřít panel kliknutím mimo něj.
document.addEventListener("click", event => {
  const wrapper = document.getElementById("reservationNotificationWrapper");
  const panel = document.getElementById("reservationNotificationPanel");
  const button = document.getElementById("reservationNotificationButton");
  if (!wrapper || !panel || wrapper.contains(event.target)) return;
  panel.classList.remove("open");
  if (button) button.setAttribute("aria-expanded", "false");
});

function parseReservationDateTime(reservation) {
  if (!reservation?.date || !reservation?.time) return null;

  const time = String(reservation.time).slice(0, 5);
  const parsed = new Date(`${reservation.date}T${time}:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isCancelledReservation(reservation) {
  const status = String(reservation?.status || "").toLowerCase();
  return ["zrušeno", "zruseno", "cancelled", "canceled"].includes(status);
}

function getReservationTableLabel(reservation) {
  if (reservation?.table_group_id) {
    const group = tableGroups.find(
      item => Number(item.id) === Number(reservation.table_group_id)
    );

    if (group) {
      if (group.name) return group.name;

      const memberNames = (Array.isArray(group.table_ids) ? group.table_ids : [])
        .map(id => restaurantTables.find(table => Number(table.id) === Number(id))?.name)
        .filter(Boolean);

      if (memberNames.length) return memberNames.join(" + ");
      return `Spojené stoly #${reservation.table_group_id}`;
    }

    return `Spojené stoly #${reservation.table_group_id}`;
  }

  if (!reservation?.table_id) return "Bez stolu";

  const table = restaurantTables.find(
    item => Number(item.id) === Number(reservation.table_id)
  );

  return table?.name || `Stůl ${reservation.table_id}`;
}

function formatUpcomingTime(minutes) {
  if (minutes <= 0) return "Právě teď";
  if (minutes < 60) return `Za ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `Za ${hours} h ${rest} min` : `Za ${hours} h`;
}

function getUpcomingReservations() {
  const now = new Date();
  const today = getLocalDateString(now);

  return reservations
    .filter(reservation => reservation.date === today && !isCancelledReservation(reservation))
    .map(reservation => {
      const startsAt = parseReservationDateTime(reservation);
      const minutesUntil = startsAt
        ? Math.ceil((startsAt.getTime() - now.getTime()) / 60000)
        : null;

      return { reservation, startsAt, minutesUntil };
    })
    .filter(item => item.startsAt && item.minutesUntil >= 0 && item.minutesUntil <= 120)
    .sort((a, b) => a.startsAt - b.startsAt);
}

function renderUpcomingReservations() {
  const list = document.getElementById("upcomingReservationsList");
  if (!list) return;

  const upcoming = getUpcomingReservations();

  if (!upcoming.length) {
    list.innerHTML = `
      <div class="upcoming-empty-state">
        <span>✓</span>
        <div>
          <strong>V příštích 2 hodinách nic nepřijde</strong>
          <small>Seznam se automaticky aktualizuje každou minutu.</small>
        </div>
      </div>
    `;
    return;
  }

  list.innerHTML = upcoming.map(({ reservation, minutesUntil }) => {
    const statusClass = getCalendarStatusClass(reservation.status);
    const people = Number(reservation.people || 0);
    const isImminent = minutesUntil <= 30;

    return `
      <button
        type="button"
        class="upcoming-reservation-card ${statusClass}${isImminent ? " imminent" : ""}"
        onclick="editReservation(${Number(reservation.id)})"
      >
        <span class="upcoming-time-block">
          <strong>${escapeHtml(String(reservation.time || "").slice(0, 5))}</strong>
          <small>${escapeHtml(formatUpcomingTime(minutesUntil))}</small>
        </span>
        <span class="upcoming-main-info">
          <strong>${escapeHtml(getReservationGuestName(reservation) === "-" ? "Bez jména" : getReservationGuestName(reservation))}</strong>
          <small>${people} ${people === 1 ? "osoba" : people >= 2 && people <= 4 ? "osoby" : "osob"} · ${escapeHtml(getReservationTableLabel(reservation))}</small>
        </span>
        <span class="upcoming-status">${isImminent ? "Brzy přijde" : escapeHtml(getCalendarStatusLabel(reservation.status))}</span>
      </button>
    `;
  }).join("");

  upcoming.forEach(({ reservation, minutesUntil }) => {
    if (minutesUntil < 0 || minutesUntil > 30) return;

    const alertKey = `${reservation.id}:${reservation.date}:${String(reservation.time).slice(0, 5)}`;
    if (shownUpcomingReservationAlerts.has(alertKey)) return;

    shownUpcomingReservationAlerts.add(alertKey);
    const tableLabel = getReservationTableLabel(reservation);
    showDashboardNotice(
      `${formatUpcomingTime(minutesUntil)} přijde ${getReservationGuestName(reservation) === "-" ? "rezervace" : getReservationGuestName(reservation)} – ${reservation.people || 0} osob, ${tableLabel}.`,
      "info"
    );
  });
}

function startUpcomingReservationTimer() {
  if (upcomingReservationTimer) return;

  upcomingReservationTimer = window.setInterval(() => {
    renderUpcomingReservations();
  }, 60000);
}

function updateStatistics() {
  const today = getLocalDateString();

  document.getElementById(
    "todayCount"
  ).textContent = reservations.filter(
    reservation => reservation.date === today
  ).length;

  document.getElementById(
    "totalCount"
  ).textContent = reservations.length;

  document.getElementById(
    "pendingCount"
  ).textContent = reservations.filter(
    reservation =>
      (reservation.status || "Čeká") === "Čeká"
  ).length;
}

function renderReservations(data) {
  const table =
    document.getElementById("reservationTable");

  if (!data.length) {
    const hasActiveFilter =
      Boolean(
        document
          .getElementById("search")
          ?.value
          ?.trim()
      ) ||
      Boolean(
        document
          .getElementById("statusFilter")
          ?.value
      );

    const emptyMessage =
      reservations.length &&
      hasActiveFilter
        ? "Žádné rezervace neodpovídají aktuálnímu filtru."
        : "Zatím tu nejsou žádné rezervace. Jakmile host odešle veřejný formulář, objeví se tady.";

    table.innerHTML = `
      <tr>
        <td colspan="10">
          <div class="emptyState">
            ${escapeHtml(emptyMessage)}
          </div>
        </td>
      </tr>
    `;

    return;
  }

  table.innerHTML = data
    .map(reservation => {
      const currentStatus =
        String(
          reservation.status || "Čeká"
        );

      const currentReservationId =
        Number(reservation.id);

      const statusBusy =
        reservationStatusUpdatesInFlight.has(
          currentReservationId
        );

      return `
        <tr>

          <td data-label="Jméno">
            ${escapeHtml(
              getReservationGuestName(reservation)
            )}
          </td>

          <td data-label="Osob">
            ${escapeHtml(
              reservation.people || "-"
            )}
          </td>

          <td data-label="Datum">
            ${escapeHtml(
              formatDate(reservation.date)
            )}
          </td>

          <td data-label="Čas">
            ${escapeHtml(
              reservation.time || "-"
            )}
          </td>

          <td data-label="Stůl">
            ${renderTableSelect(reservation)}
          </td>

          <td data-label="Telefon">
            ${
              reservation.phone
                ? `
                  <a
                    class="contactLink"
                    href="tel:${escapeHtml(
                      reservation.phone
                    )}"
                  >
                    ${escapeHtml(
                      reservation.phone
                    )}
                  </a>
                `
                : "-"
            }
          </td>

          <td data-label="E-mail">
            ${
              reservation.email
                ? `
                  <a
                    class="contactLink"
                    href="mailto:${escapeHtml(
                      reservation.email
                    )}"
                  >
                    ${escapeHtml(
                      reservation.email
                    )}
                  </a>
                `
                : "-"
            }
          </td>

          <td data-label="Poznámka">
            ${escapeHtml(
              reservation.note || "-"
            )}
          </td>

          <td data-label="Stav">
            <span
              class="status ${escapeHtml(
                currentStatus
              )}"
            >
              ${escapeHtml(
                currentStatus
              )}
            </span>
          </td>

          <td data-label="Akce">
            <div class="tableActions">

  <button
    type="button"
    title="Automaticky doporučit stůl"
    onclick="autoAssignTable(
      ${Number(reservation.id)}
    )"
  >
    🪄
  </button>

  <button
    class="editBtn"
    type="button"
    title="Upravit rezervaci"
    onclick="editReservation(
      ${Number(reservation.id)}
    )"
  >
    ✏️
  </button>
              <button
                type="button"
                title="${
                  currentStatus === "Potvrzeno"
                    ? "Rezervace už je potvrzená"
                    : "Potvrdit rezervaci"
                }"
                data-reservation-status-id="${
                  currentReservationId
                }"
                data-reservation-status-value="Potvrzeno"
                ${
                  statusBusy ||
                  currentStatus === "Potvrzeno"
                    ? "disabled"
                    : ""
                }
                onclick="updateStatus(
                  ${currentReservationId},
                  'Potvrzeno'
                )"
              >
                ✅
              </button>

              <button
                type="button"
                title="${
                  currentStatus === "Zrušeno"
                    ? "Rezervace už je zrušená"
                    : "Zrušit rezervaci"
                }"
                data-reservation-status-id="${
                  currentReservationId
                }"
                data-reservation-status-value="Zrušeno"
                ${
                  statusBusy ||
                  currentStatus === "Zrušeno"
                    ? "disabled"
                    : ""
                }
                onclick="updateStatus(
                  ${currentReservationId},
                  'Zrušeno'
                )"
              >
                ❌
              </button>

              ${currentUserRole === "owner" ? `<button
                class="deleteBtn"
                type="button"
                title="Smazat rezervaci"
                onclick="deleteReservation(
                  ${Number(reservation.id)}
                )"
              >
                🗑️
              </button>` : ""}

            </div>
          </td>

        </tr>
      `;
    })
    .join("");
}

async function updateReservationStatusRequest(id, status) {
  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(
      () => controller.abort(),
      20000
    );

  try {
    const response =
      await authorizedFetch(
        "/api/send-email",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          signal:
            controller.signal,

          body:
            JSON.stringify({
              action:
                "update-reservation-status",

              reservation_id:
                Number(id),

              status
            })
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      throw new Error(
        data?.error ||
        "Stav rezervace se nepodařilo změnit."
      );
    }

    return data;
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "Změna stavu trvala příliš dlouho. Obnov stránku a zkontroluj výsledek."
      );
    }

    throw error;
  } finally {
    clearTimeout(
      timeoutId
    );
  }
}

async function updateStatus(id, status) {
  const reservationId =
    Number(id);

  const nextStatus =
    String(status || "").trim();

  if (
    !Number.isInteger(
      reservationId
    ) ||
    reservationId < 1 ||
    ![
      "Potvrzeno",
      "Zrušeno"
    ].includes(nextStatus)
  ) {
    showDashboardNotice(
      "Neplatná změna stavu rezervace.",
      "error"
    );

    return false;
  }

  const reservationIndex =
    reservations.findIndex(
      reservation =>
        Number(reservation.id) ===
        reservationId
    );

  const currentReservation =
    reservationIndex >= 0
      ? reservations[
          reservationIndex
        ]
      : null;

  const currentStatus =
    String(
      currentReservation?.status ||
      "Čeká"
    );

  if (
    currentStatus ===
    nextStatus
  ) {
    showDashboardNotice(
      nextStatus === "Potvrzeno"
        ? "Rezervace už je potvrzená."
        : "Rezervace už je zrušená.",
      "info"
    );

    return false;
  }

  // Ochrana proti dvojkliku v prohlížeči.
  // Hlavní ochrana je nově i na serveru.
  if (
    reservationStatusUpdatesInFlight.has(
      reservationId
    )
  ) {
    return false;
  }

  reservationStatusUpdatesInFlight.add(
    reservationId
  );

  setReservationStatusButtonsBusy(
    reservationId,
    true
  );

  // Optimisticky zobrazíme nový stav hned.
  // Kdyby server změnu odmítl, stav vrátíme zpět.
  if (
    reservationIndex >= 0
  ) {
    reservations[
      reservationIndex
    ] = {
      ...currentReservation,
      status:
        nextStatus
    };

    renderReservations(
      reservations
    );

    updateStatistics();
    renderCharts();
    renderCalendar();
    renderUpcomingReservations();
    renderCustomers();
  }

  showDashboardNotice(
    nextStatus === "Potvrzeno"
      ? "Potvrzuji rezervaci…"
      : "Ruším rezervaci…",
    "info"
  );

  try {
    const result =
      await updateReservationStatusRequest(
        reservationId,
        nextStatus
      );

    if (
      result?.changed ===
      false
    ) {
      // Jiný request už stejný stav provedl.
      // Server kvůli tomu neposlal druhý e-mail.
      await loadReservations();

      showDashboardNotice(
        nextStatus === "Potvrzeno"
          ? "Rezervace už byla potvrzena."
          : "Rezervace už byla zrušena.",
        "info"
      );

      return false;
    }

    await Promise.allSettled([
      loadReservations(),
      loadReservationHistory()
    ]);

    if (
      result?.email_sent
    ) {
      showDashboardNotice(
        nextStatus === "Potvrzeno"
          ? "Rezervace byla potvrzena a zákazníkovi byl odeslán e-mail."
          : "Rezervace byla zrušena a zákazníkovi byl odeslán e-mail.",
        "success"
      );
    } else if (
      result?.email_error
    ) {
      showDashboardNotice(
        `Stav rezervace byl změněn, ale e-mail se nepodařilo odeslat: ${result.email_error}`,
        "error"
      );
    } else {
      showDashboardNotice(
        "Stav rezervace byl změněn.",
        "success"
      );
    }

    return true;
  } catch (error) {
    console.error(
      error
    );

    // Server změnu nepotvrdil -> vrátíme původní stav v UI.
    if (
      reservationIndex >= 0
    ) {
      reservations[
        reservationIndex
      ] = {
        ...reservations[
          reservationIndex
        ],
        status:
          currentStatus
      };

      renderReservations(
        reservations
      );

      updateStatistics();
      renderCharts();
      renderCalendar();
      renderUpcomingReservations();
      renderCustomers();
    }

    showDashboardNotice(
      error?.message ||
      "Nepodařilo se změnit stav rezervace.",
      "error"
    );

    return false;
  } finally {
    reservationStatusUpdatesInFlight.delete(
      reservationId
    );

    setReservationStatusButtonsBusy(
      reservationId,
      false
    );

    renderReservations(
      reservations
    );
  }
}

async function deleteReservation(id) {
  if (currentUserRole !== "owner") {
    showDashboardNotice("Rezervaci může smazat jen vlastník restaurace.");
    return;
  }

  if (!confirm("Opravdu smazat rezervaci?")) {
    return;
  }

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${Number(id)}&restaurant_id=eq.${currentRestaurantId}`,
      {
        method: "DELETE",
        headers: { ...getHeaders(), Prefer: "return=representation" }
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const deleted = await response.json();
    if (!Array.isArray(deleted) || deleted.length !== 1) {
      throw new Error("Rezervace nebyla smazána.");
    }

    await loadReservations();
    await loadReservationHistory();
    return true;
  } catch (error) {
    console.error(error);

    showDashboardNotice(
      "Nepodařilo se smazat rezervaci."
    );
  }
}


let reservationHistory = [];

function historyActionLabel(action) {
  if (action === "created") return "Vytvořeno";
  if (action === "deleted") return "Smazáno";
  return "Upraveno";
}

function historyFieldLabel(field) {
  const labels = {
    name: "Jméno",
    last_name: "Příjmení",
    people: "Počet osob",
    date: "Datum",
    time: "Čas",
    duration_minutes: "Délka",
    table_id: "Stůl",
    table_group_id: "Skupina stolů",
    status: "Stav",
    phone: "Telefon",
    email: "E-mail",
    note: "Poznámka"
  };
  return labels[field] || field;
}

function formatHistoryValue(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "date") return formatDate(value);
  if (field === "time") return String(value).slice(0, 5);
  if (field === "duration_minutes") return `${value} min`;
  if (field === "table_id") {
    return value
      ? (getTableName(value) || `Stůl ${value}`)
      : "Bez stolu";
  }

  if (field === "table_group_id") {
    if (!value) {
      return "Bez skupiny";
    }

    const group =
      tableGroups.find(
        item =>
          Number(item.id) ===
          Number(value)
      );

    return (
      group?.name ||
      `Spojené stoly #${value}`
    );
  }

  return String(value);
}

function getHistoryChanges(entry) {
  if (entry.action === "created") return ["Rezervace byla vytvořena."];
  if (entry.action === "deleted") return ["Rezervace byla smazána."];

  const before = entry.before_data || {};
  const after = entry.after_data || {};
  const tracked = ["name", "last_name", "people", "date", "time", "duration_minutes", "table_id", "table_group_id", "status", "phone", "email", "note"];

  return tracked
    .filter(field => String(before[field] ?? "") !== String(after[field] ?? ""))
    .map(field => `${historyFieldLabel(field)}: ${formatHistoryValue(field, before[field])} → ${formatHistoryValue(field, after[field])}`);
}

function renderReservationHistory() {
  const list = document.getElementById("reservationHistoryList");
  if (!list) return;

  const filter = document.getElementById("historyActionFilter")?.value || "";
  const data = filter ? reservationHistory.filter(item => item.action === filter) : reservationHistory;

  if (!data.length) {
    list.innerHTML = `<div class="history-empty">Zatím tu není žádná historie.</div>`;
    return;
  }

  list.innerHTML = data.map(entry => {
    const changes = getHistoryChanges(entry);
    const name =
      entry.reservation_name ||
      (
        entry.after_data
          ? getReservationGuestName(
              entry.after_data
            )
          : ""
      ) ||
      (
        entry.before_data
          ? getReservationGuestName(
              entry.before_data
            )
          : ""
      ) ||
      "Rezervace";
    const actor = entry.actor_email || (entry.action === "created" ? "Veřejný formulář / systém" : "Systém");
    const when = entry.created_at ? new Date(entry.created_at).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" }) : "—";

    return `
      <article class="history-card history-${escapeHtml(entry.action || "updated")}">
        <div class="history-card-top">
          <div>
            <span class="history-action-badge">${escapeHtml(historyActionLabel(entry.action))}</span>
            <strong>${escapeHtml(name)}</strong>
          </div>
          <time>${escapeHtml(when)}</time>
        </div>
        <div class="history-changes">
          ${(changes.length ? changes : ["Rezervace byla upravena."]).map(change => `<div>${escapeHtml(change)}</div>`).join("")}
        </div>
        <div class="history-meta">Provedl: ${escapeHtml(actor)}</div>
      </article>
    `;
  }).join("");
}

async function loadReservationHistory() {
  if (!currentRestaurantId) return;
  const list = document.getElementById("reservationHistoryList");

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/reservation_history?restaurant_id=eq.${currentRestaurantId}&select=*&order=created_at.desc&limit=300`,
      { headers: getHeaders() }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    reservationHistory = await response.json();
    renderReservationHistory();
  } catch (error) {
    console.error("Historii rezervací se nepodařilo načíst:", error);
    if (list) {
      list.innerHTML = `<div class="history-empty">Historii rezervací se teď nepodařilo načíst. Zkus stránku obnovit.</div>`;
    }
  }
}

document.getElementById("historyActionFilter")?.addEventListener("change", renderReservationHistory);


/* =========================================================
   ZÁKAZNÍCI / STÁLÍ HOSTÉ
========================================================= */
function normalizeCustomerPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");

  // České číslo bereme stejně ve tvarech 608123456, +420 608 123 456
  // i 00420 608 123 456. U ostatních zemí prefix ponecháváme.
  if (digits.startsWith("00420") && digits.length === 14) {
    digits = digits.slice(5);
  } else if (digits.startsWith("420") && digits.length === 12) {
    digits = digits.slice(3);
  }

  return digits;
}

function normalizeCustomerEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getCustomerKey(reservation) {
  const phone = normalizeCustomerPhone(reservation?.phone);
  const email = normalizeCustomerEmail(reservation?.email);

  // CRM identita: telefon má vždy přednost. E-mail používáme jen tehdy,
  // když telefon chybí. Podle jména zákazníky nikdy neslučujeme.
  if (phone) return `phone:${phone}`;
  if (email) return `email:${email}`;

  // Rezervace bez telefonu i e-mailu zůstanou samostatné.
  return `reservation:${reservation?.id ?? Math.random().toString(36).slice(2)}`;
}

function getCustomerProfile(customerKey) {
  return customerProfiles.find(item => item.customer_key === customerKey) || null;
}

function getCustomerProfileForCustomer(customer) {
  const exact = getCustomerProfile(customer?.key);
  if (exact) return exact;

  const phone = normalizeCustomerPhone(customer?.phone);
  if (phone) {
    const byPhone = customerProfiles.find(item =>
      normalizeCustomerPhone(item?.phone) === phone
    );
    if (byPhone) return byPhone;

    // Kompatibilita se starší verzí CRM, která profil klíčovala e-mailem
    // i v případech, kdy byl telefon vyplněný.
    const email = normalizeCustomerEmail(customer?.email);
    if (email) {
      const legacyByEmailKey = customerProfiles.find(item =>
        item?.customer_key === `email:${email}`
      );
      if (legacyByEmailKey) return legacyByEmailKey;
    }

    return null;
  }

  const email = normalizeCustomerEmail(customer?.email);
  if (!email) return null;
  return customerProfiles.find(item =>
    normalizeCustomerEmail(item?.email) === email ||
    item?.customer_key === `email:${email}`
  ) || null;
}

function buildCustomers() {
  const groups = new Map();

  reservations.forEach(reservation => {
    const key = getCustomerKey(reservation);
    if (!key || key === "name:") return;

    const guestName =
      getReservationGuestName(reservation);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: guestName === "-" ? "Host" : guestName,
        phone: reservation.phone || "",
        email: reservation.email || "",
        reservations: [],
        totalPeople: 0
      });
    }

    const customer = groups.get(key);
    customer.reservations.push(reservation);
    customer.totalPeople += Number(reservation.people || 0);
    if (!customer.phone && reservation.phone) customer.phone = reservation.phone;
    if (!customer.email && reservation.email) customer.email = reservation.email;
    if (guestName !== "-") customer.name = guestName;
  });

  return [...groups.values()].map(customer => {
    const sorted = [...customer.reservations].sort((a, b) => {
      return String(`${b.date || ""} ${b.time || ""}`).localeCompare(String(`${a.date || ""} ${a.time || ""}`));
    });
    const profile = getCustomerProfileForCustomer(customer);
    const completedOrActive = sorted.filter(item => !isCancelledReservation(item));

    return {
      ...customer,
      reservations: sorted,
      reservationCount: sorted.length,
      activeReservationCount: completedOrActive.length,
      lastReservation: completedOrActive[0] || sorted[0] || null,
      note: profile?.note || "",
      isRegular: Boolean(profile?.is_regular),
      profileId: profile?.id || null
    };
  }).sort((a, b) => {
    if (a.isRegular !== b.isRegular) return a.isRegular ? -1 : 1;
    return b.reservationCount - a.reservationCount;
  });
}

function renderCustomerSummary(customers) {
  const summary = document.getElementById("customerSummary");
  if (!summary) return;
  const regulars = customers.filter(c => c.isRegular).length;
  const returning = customers.filter(c => c.reservationCount >= 2).length;
  summary.innerHTML = `
    <div><strong>${customers.length}</strong><span>Zákazníků</span></div>
    <div><strong>${returning}</strong><span>Vracejících se</span></div>
    <div><strong>${regulars}</strong><span>Stálých hostů</span></div>
  `;
}

function renderCustomers() {
  const list = document.getElementById("customerList");
  if (!list) return;

  const allCustomers = buildCustomers();
  renderCustomerSummary(allCustomers);

  const search = String(document.getElementById("customerSearch")?.value || "").trim().toLowerCase();
  const filter = document.getElementById("customerTypeFilter")?.value || "";

  const customers = allCustomers.filter(customer => {
    const haystack = `${customer.name} ${customer.phone} ${customer.email}`.toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (filter === "regular" && !customer.isRegular) return false;
    if (filter === "returning" && customer.reservationCount < 2) return false;
    return true;
  });

  if (!customers.length) {
    const hasCustomerFilter =
      Boolean(search) ||
      Boolean(filter);

    list.innerHTML =
      allCustomers.length &&
      hasCustomerFilter
        ? `<div class="history-empty">Žádní zákazníci neodpovídají filtru.</div>`
        : `<div class="history-empty">Zákazníci se vytvoří automaticky z prvních rezervací.</div>`;

    return;
  }

  list.innerHTML = customers.map((customer, index) => {
    const last = customer.lastReservation;
    const lastText = last ? `${formatDate(last.date)} ${String(last.time || "").slice(0,5)}` : "—";
    const autoHint = !customer.isRegular && customer.reservationCount >= 3
      ? `<span class="customer-hint">Častý host · vhodný k označení ⭐</span>` : "";
    const history = customer.reservations.map(r => `
      <div class="customer-reservation-row">
        <span>${escapeHtml(formatDate(r.date))} ${escapeHtml(String(r.time || "").slice(0,5))}</span>
        <span>${escapeHtml(String(r.people || 0))} osob</span>
        <span>${escapeHtml(getReservationTableLabel(r))}</span>
        <span class="status ${escapeHtml(r.status || "Čeká")}">${escapeHtml(r.status || "Čeká")}</span>
      </div>
    `).join("");

    return `
      <article class="customer-card ${customer.isRegular ? "is-regular" : ""}">
        <div class="customer-card-head">
          <div>
            <div class="customer-name-line">
              <h3>${customer.isRegular ? "⭐ " : ""}${escapeHtml(customer.name)}</h3>
              ${autoHint}
            </div>
            <div class="customer-contact">
              <span>📞 ${escapeHtml(customer.phone || "Bez telefonu")}</span>
              <span>✉️ ${escapeHtml(customer.email || "Bez e-mailu")}</span>
            </div>
          </div>
          <label class="regular-toggle">
            <input type="checkbox" ${customer.isRegular ? "checked" : ""} class="customer-regular-input" data-customer-key="${escapeHtml(encodeURIComponent(customer.key))}">
            <span>Stálý host</span>
          </label>
        </div>
        <div class="customer-stats-grid">
          <div><strong>${customer.reservationCount}</strong><span>rezervací</span></div>
          <div><strong>${customer.totalPeople}</strong><span>hostů celkem</span></div>
          <div><strong>${escapeHtml(lastText)}</strong><span>poslední rezervace</span></div>
        </div>
        <div class="customer-note-row">
          <textarea id="customerNote-${index}" placeholder="Interní poznámka k hostovi…">${escapeHtml(customer.note)}</textarea>
          <button type="button" class="primary-btn customer-note-save" data-customer-key="${escapeHtml(encodeURIComponent(customer.key))}" data-note-id="customerNote-${index}">Uložit poznámku</button>
        </div>
        <button type="button" class="customer-history-toggle" onclick="toggleCustomerHistory('customerHistory-${index}', this)">Zobrazit historii rezervací (${customer.reservationCount})</button>
        <div id="customerHistory-${index}" class="customer-reservation-history" hidden>${history}</div>
      </article>
    `;
  }).join("");

  list.querySelectorAll(".customer-regular-input").forEach(input => {
    input.addEventListener("change", () => {
      let customerKey = "";
      try {
        customerKey = decodeURIComponent(input.dataset.customerKey || "");
      } catch (_) {
        return;
      }
      saveCustomerProfile(customerKey, { is_regular: input.checked });
    });
  });

  list.querySelectorAll(".customer-note-save").forEach(button => {
    button.addEventListener("click", () => {
      let customerKey = "";
      try {
        customerKey = decodeURIComponent(button.dataset.customerKey || "");
      } catch (_) {
        return;
      }
      saveCustomerNote(customerKey, button.dataset.noteId || "");
    });
  });
}


async function refreshCustomers(button) {
  const originalText = button?.textContent || "↻ Obnovit";
  if (button) {
    button.disabled = true;
    button.textContent = "Obnovuji…";
  }

  try {
    // Znovu načteme rezervace i uložené profily zákazníků z databáze.
    // Samotné renderCustomers() jen překresluje data, která už jsou v paměti.
    await loadReservations();
    await loadCustomerProfiles();
    renderCustomers();
    showDashboardNotice("Zákazníci byli aktualizováni.", "success");
  } catch (error) {
    console.error("Obnovení zákazníků selhalo:", error);
    showDashboardNotice("Zákazníky se nepodařilo aktualizovat.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function loadCustomerProfiles() {
  if (!currentRestaurantId) return;
  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/customer_profiles?restaurant_id=eq.${encodeURIComponent(currentRestaurantId)}&select=*`,
      { headers: getHeaders({ "Cache-Control": "no-cache" }) }
    );
    if (!response.ok) throw new Error(await response.text());

    const rows = await response.json();
    customerProfiles = Array.isArray(rows) ? rows : [];
    renderCustomers();
  } catch (error) {
    console.warn("Profily zákazníků zatím nejsou dostupné:", error);
    // Nemažeme lokální profily při dočasné chybě načtení, aby se právě
    // uložená poznámka nebo označení stálého hosta neztratily z UI.
    renderCustomers();
  }
}

async function saveCustomerProfile(customerKey, changes) {
  const customer = buildCustomers().find(item => item.key === customerKey);
  if (!customer) return;

  const existing = getCustomerProfileForCustomer(customer);
  const payload = {
    restaurant_id: Number(currentRestaurantId),
    customer_key: customerKey,
    name: customer.name || null,
    phone: customer.phone || null,
    email: customer.email || null,
    note: existing?.note || "",
    is_regular: Boolean(existing?.is_regular),
    ...changes,
    updated_at: new Date().toISOString()
  };

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/customer_profiles?on_conflict=restaurant_id,customer_key`,
      {
        method: "POST",
        headers: getHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) throw new Error(await response.text());

    const savedRows = await response.json();
    const saved = Array.isArray(savedRows) && savedRows[0] ? savedRows[0] : payload;
    const index = customerProfiles.findIndex(item => item.customer_key === customerKey);
    if (index >= 0) {
      customerProfiles[index] = { ...customerProfiles[index], ...saved };
    } else {
      customerProfiles.push(saved);
    }
    renderCustomers();

    // Následně znovu načteme databázi, aby bylo jisté, že hodnota opravdu
    // přežila refresh a není jen lokálně v prohlížeči.
    await loadCustomerProfiles();

    const persisted = getCustomerProfile(customerKey);
    if (Object.prototype.hasOwnProperty.call(changes, "note") &&
        String(persisted?.note || "") !== String(changes.note || "")) {
      throw new Error("Poznámka se po uložení nenačetla zpět z databáze.");
    }
    if (Object.prototype.hasOwnProperty.call(changes, "is_regular") &&
        Boolean(persisted?.is_regular) !== Boolean(changes.is_regular)) {
      throw new Error("Označení stálého hosta se po uložení nenačetlo zpět z databáze.");
    }

    showDashboardNotice("Profil zákazníka byl uložen.", "success");
  } catch (error) {
    console.error(error);
    showDashboardNotice("Profil zákazníka se nepodařilo trvale uložit.", "error");
  }
}

function saveCustomerNote(customerKey, textareaId) {
  const note = document.getElementById(textareaId)?.value || "";
  return saveCustomerProfile(customerKey, { note });
}

function toggleCustomerHistory(id, button) {
  const element = document.getElementById(id);
  if (!element) return;
  element.hidden = !element.hidden;
  if (button) button.textContent = element.hidden ? `Zobrazit historii rezervací (${element.children.length})` : "Skrýt historii rezervací";
}

document.getElementById("customerSearch")?.addEventListener("input", renderCustomers);
document.getElementById("customerTypeFilter")?.addEventListener("change", renderCustomers);

function getFilteredReservations() {
  const search =
    document
      .getElementById("search")
      .value
      .toLowerCase()
      .trim();

  const status =
    document.getElementById(
      "statusFilter"
    ).value;

  return reservations.filter(reservation => {
    const tableName =
      getReservationTableLabel(reservation);

    const text = [
      reservation.name,
      reservation.last_name,
      reservation.phone,
      reservation.email,
      reservation.note,
      tableName
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch =
      text.includes(search);

    const matchesStatus =
      !status ||
      (reservation.status || "Čeká") ===
        status;

    return matchesSearch && matchesStatus;
  });
}

function applyFilters() {
  renderReservations(
    getFilteredReservations()
  );
}

function resetFilters() {
  document.getElementById("search").value = "";

  document.getElementById(
    "statusFilter"
  ).value = "";

  renderReservations(reservations);
}

function editReservation(id) {
    const reservation = reservations.find(
        item => Number(item.id) === Number(id)
    );

    if (!reservation) {
        showDashboardNotice("Rezervace nebyla nalezena.");
        return;
    }

    document.getElementById("editReservationId").value =
        reservation.id;

    document.getElementById("editReservationName").value =
        getReservationGuestName(reservation) === "-"
            ? ""
            : getReservationGuestName(reservation);

    document.getElementById("editReservationPeople").value =
        reservation.people || "";

    document.getElementById("editReservationDate").value =
        reservation.date || "";

    document.getElementById("editReservationTime").value =
        reservation.time || "";
  
const durationSelect =
    document.getElementById("editReservationDuration");

if (durationSelect) {
    durationSelect.value = String(
        reservation.duration_minutes || 120
    );
}
    document.getElementById("editReservationPhone").value =
        reservation.phone || "";

    document.getElementById("editReservationEmail").value =
        reservation.email || "";

    document.getElementById("editReservationNote").value =
        reservation.note || "";

    document.getElementById("editReservationStatus").value =
        reservation.status || "Čeká";

    updateEditReservationTableOptions(
        reservation.table_id,
        reservation.table_group_id
    );

    [
        "editReservationPeople",
        "editReservationDate",
        "editReservationTime",
        "editReservationDuration",
        "editReservationStatus"
    ].forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
            element.onchange = () => updateEditReservationTableOptions();
            element.oninput = () => updateEditReservationTableOptions();
        }
    });

    document
        .getElementById("reservationModal")
        .classList.add("show");
}


function updateEditReservationTableOptions(
  preferredTableId = undefined,
  preferredGroupId = undefined
) {
  const tableSelect =
    document.getElementById(
      "editReservationTable"
    );

  const idInput =
    document.getElementById(
      "editReservationId"
    );

  const peopleInput =
    document.getElementById(
      "editReservationPeople"
    );

  const dateInput =
    document.getElementById(
      "editReservationDate"
    );

  const timeInput =
    document.getElementById(
      "editReservationTime"
    );

  const durationInput =
    document.getElementById(
      "editReservationDuration"
    );

  const statusInput =
    document.getElementById(
      "editReservationStatus"
    );

  if (
    !tableSelect ||
    !idInput ||
    !peopleInput ||
    !dateInput ||
    !timeInput ||
    !durationInput ||
    !statusInput
  ) {
    return;
  }

  let previousValue =
    tableSelect.value;

  if (
    preferredGroupId !==
      undefined &&
    preferredGroupId !==
      null
  ) {
    previousValue =
      `group:${Number(
        preferredGroupId
      )}`;
  } else if (
    preferredTableId !==
      undefined
  ) {
    previousValue =
      preferredTableId === null
        ? ""
        : String(
            preferredTableId
          );
  }

  const reservationId =
    Number(
      idInput.value || 0
    );

  const people =
    Number(
      peopleInput.value || 0
    );

  const proposedReservation = {
    id:
      reservationId,
    people,
    date:
      dateInput.value,
    time:
      timeInput.value,
    duration_minutes:
      Number(
        durationInput.value ||
        120
      ),
    status:
      statusInput.value ||
      "Čeká"
  };

  tableSelect.replaceChildren(
    createTableOption({
      value: "",
      label:
        "Bez stolu"
    })
  );

  const groupedTableIds =
    getActiveGroupedTableIds();

  restaurantTables
    .filter(
      table =>
        (
          table.active &&
          !groupedTableIds.has(
            Number(table.id)
          )
        ) ||
        String(table.id) ===
          previousValue
    )
    .sort(
      (a, b) =>
        Number(a.capacity) -
        Number(b.capacity)
    )
    .forEach(table => {
      const inActiveGroup =
        groupedTableIds.has(
          Number(table.id)
        );

      const tooSmall =
        people >
        Number(
          table.capacity || 0
        );

      const occupied =
        proposedReservation.status !==
          "Zrušeno" &&
        proposedReservation.date &&
        proposedReservation.time &&
        hasTableConflict(
          table.id,
          proposedReservation,
          reservationId
        );

      const unavailable =
        !table.active ||
        inActiveGroup ||
        tooSmall ||
        occupied;

      let label =
        `${table.name} (${table.capacity} míst)`;

      if (!table.active) {
        label +=
          " — neaktivní";
      } else if (
        inActiveGroup
      ) {
        label +=
          " — součást spojených stolů";
      } else if (
        tooSmall
      ) {
        label +=
          " — malá kapacita";
      } else if (
        occupied
      ) {
        label +=
          " — obsazený";
      } else {
        label +=
          " — volný";
      }

      tableSelect.appendChild(
        createTableOption({
          value:
            Number(table.id),
          label,
          disabled:
            unavailable
        })
      );
    });

  tableGroups
    .filter(
      group =>
        isUsableTableGroup(
          group
        ) ||
        `group:${Number(
          group.id
        )}` ===
          previousValue
    )
    .sort(
      (a, b) =>
        Number(
          a.total_capacity || 0
        ) -
        Number(
          b.total_capacity || 0
        )
    )
    .forEach(group => {
      const usable =
        isUsableTableGroup(
          group
        );

      const capacity =
        Number(
          group.total_capacity ||
          0
        );

      const tooSmall =
        people >
        capacity;

      const occupied =
        proposedReservation.status !==
          "Zrušeno" &&
        proposedReservation.date &&
        proposedReservation.time &&
        hasTableGroupConflict(
          group.id,
          proposedReservation,
          reservationId
        );

      const unavailable =
        !usable ||
        tooSmall ||
        occupied;

      let label =
        `🔗 ${group.name || "Spojené stoly"} (${capacity} míst)`;

      if (!usable) {
        label +=
          " — neaktivní";
      } else if (
        tooSmall
      ) {
        label +=
          " — malá kapacita";
      } else if (
        occupied
      ) {
        label +=
          " — obsazená";
      } else {
        label +=
          " — volná";
      }

      tableSelect.appendChild(
        createTableOption({
          value:
            `group:${Number(
              group.id
            )}`,
          label,
          disabled:
            unavailable
        })
      );
    });

  const preferredOption =
    [
      ...tableSelect.options
    ].find(
      option =>
        option.value ===
        previousValue
    );

  if (preferredOption) {
    preferredOption.disabled =
      false;

    tableSelect.value =
      previousValue;
  } else {
    tableSelect.value =
      "";
  }
}

function closeReservationModal() {
    document
        .getElementById("reservationModal")
        .classList.remove("show");
}

async function saveReservationChanges() {
  const id =
    Number(
      document.getElementById(
        "editReservationId"
      ).value
    );

  const name =
    document
      .getElementById(
        "editReservationName"
      )
      .value
      .trim();

  const people =
    Number(
      document.getElementById(
        "editReservationPeople"
      ).value
    );

  const date =
    document.getElementById(
      "editReservationDate"
    ).value;

  const time =
    document.getElementById(
      "editReservationTime"
    ).value;

  const durationMinutes =
    Number(
      document.getElementById(
        "editReservationDuration"
      ).value
    );

  const resourceValue =
    String(
      document.getElementById(
        "editReservationTable"
      ).value || ""
    );

  const tableGroupId =
    resourceValue.startsWith(
      "group:"
    )
      ? Number(
          resourceValue.slice(6)
        )
      : null;

  const tableId =
    resourceValue &&
    tableGroupId === null
      ? Number(
          resourceValue
        )
      : null;

  const status =
    String(
      document.getElementById(
        "editReservationStatus"
      ).value || ""
    ).trim();

  const phone =
    document
      .getElementById(
        "editReservationPhone"
      )
      .value
      .trim();

  const email =
    document
      .getElementById(
        "editReservationEmail"
      )
      .value
      .trim();

  const note =
    document
      .getElementById(
        "editReservationNote"
      )
      .value
      .trim();

  if (
    !Number.isInteger(id) ||
    id < 1 ||
    !name ||
    !date ||
    !time ||
    !Number.isInteger(
      people
    ) ||
    people < 1 ||
    people > 30 ||
    !Number.isFinite(
      durationMinutes
    ) ||
    durationMinutes < 30 ||
    durationMinutes > 360 ||
    ![
      "Čeká",
      "Potvrzeno",
      "Zrušeno"
    ].includes(status) ||
    (
      resourceValue.startsWith(
        "group:"
      ) &&
      (
        !Number.isInteger(
          tableGroupId
        ) ||
        tableGroupId < 1
      )
    ) ||
    (
      resourceValue &&
      !resourceValue.startsWith(
        "group:"
      ) &&
      (
        !Number.isInteger(
          tableId
        ) ||
        tableId < 1
      )
    )
  ) {
    showDashboardNotice(
      "Vyplň správně jméno, počet osob, datum, čas, délku, místo a stav."
    );
    return;
  }

  if (
    !isValidOptionalEmail(
      email
    )
  ) {
    showDashboardNotice(
      "Zadej platný e-mail, nebo pole nech prázdné."
    );
    return;
  }

  try {
    await fetchReservationsSnapshot();
  } catch (error) {
    console.error(
      "Čerstvý stav rezervací se nepodařilo načíst:",
      error
    );

    showDashboardNotice(
      "Rezervaci teď nelze bezpečně upravit. Obnov stránku a zkus to znovu."
    );
    return;
  }

  const currentReservation =
    reservations.find(
      reservation =>
        Number(
          reservation.id
        ) === id
    );

  if (!currentReservation) {
    showDashboardNotice(
      "Rezervace nebyla nalezena."
    );
    return;
  }

  const openingAvailability =
    await checkDashboardOpeningAvailability({
      date,
      time,
      durationMinutes
    });

  if (
    !openingAvailability.ok &&
    status !== "Zrušeno"
  ) {
    showDashboardNotice(
      openingAvailability.message
    );
    return;
  }

  const updatedReservation = {
    id,
    name,
    last_name:
      null,
    people,
    date,
    time,
    duration_minutes:
      durationMinutes,
    table_id:
      tableId,
    table_group_id:
      tableGroupId,
    phone,
    email,
    note,
    status
  };

  if (
    tableId !== null
  ) {
    const selectedTable =
      restaurantTables.find(
        table =>
          Number(table.id) ===
          tableId
      );

    if (!selectedTable) {
      showDashboardNotice(
        "Vybraný stůl nebyl nalezen."
      );
      return;
    }

    if (
      isTableInActiveGroup(
        tableId
      ) &&
      Number(
        currentReservation.table_id
      ) !== tableId
    ) {
      showDashboardNotice(
        `${selectedTable.name} je součástí spojených stolů. Vyber skupinu nebo jiný stůl.`
      );
      return;
    }

    if (
      people >
      Number(
        selectedTable.capacity
      )
    ) {
      showDashboardNotice(
        `${selectedTable.name} má jen ${selectedTable.capacity} míst.`
      );
      return;
    }

    if (
      status !== "Zrušeno" &&
      hasTableConflict(
        tableId,
        updatedReservation,
        id
      )
    ) {
      showDashboardNotice(
        `${selectedTable.name} je v tomto čase obsazený.\n\nVyber jiné místo nebo jiný čas.`
      );
      return;
    }
  }

  if (
    tableGroupId !== null
  ) {
    const selectedGroup =
      tableGroups.find(
        group =>
          Number(group.id) ===
          tableGroupId
      );

    const preservingCurrentGroup =
      Number(
        currentReservation
          .table_group_id
      ) === tableGroupId;

    if (
      !selectedGroup ||
      (
        !preservingCurrentGroup &&
        !isUsableTableGroup(
          selectedGroup
        )
      )
    ) {
      showDashboardNotice(
        "Vybraná skupina stolů není dostupná."
      );
      return;
    }

    const groupCapacity =
      Number(
        selectedGroup
          .total_capacity ||
        0
      );

    if (
      people >
      groupCapacity
    ) {
      showDashboardNotice(
        `${selectedGroup.name || "Spojené stoly"} mají jen ${groupCapacity} míst.`
      );
      return;
    }

    if (
      status !== "Zrušeno" &&
      hasTableGroupConflict(
        tableGroupId,
        updatedReservation,
        id
      )
    ) {
      showDashboardNotice(
        `${selectedGroup.name || "Spojené stoly"} jsou v tomto čase obsazené.\n\nVyber jiné místo nebo jiný čas.`
      );
      return;
    }
  }

  try {
    const response =
      await authorizedFetch(
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
                "update-reservation",
              reservation_id:
                id,
              name,
              people,
              date,
              time,
              duration_minutes:
                durationMinutes,
              table_id:
                tableId,
              table_group_id:
                tableGroupId,
              phone,
              email,
              note,
              status
            })
        }
      );

    const statusResult =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      throw new Error(
        statusResult?.error ||
        "Rezervaci se nepodařilo upravit."
      );
    }

    closeReservationModal();
    closeTableModal();

    await Promise.all([
      loadReservations(),
      loadReservationHistory()
    ]);

    renderTables();

    if (
      statusResult &&
      statusResult.email_sent
    ) {
      showDashboardNotice(
        status === "Potvrzeno"
          ? "Rezervace byla upravena, potvrzena a zákazníkovi byl odeslán e-mail."
          : "Rezervace byla upravena, zrušena a zákazníkovi byl odeslán e-mail.",
        "success"
      );
    } else if (
      statusResult &&
      statusResult.email_error
    ) {
      showDashboardNotice(
        `Rezervace byla upravena a stav změněn, ale e-mail se nepodařilo odeslat: ${statusResult.email_error}`,
        "error"
      );
    } else {
      showDashboardNotice(
        "Rezervace byla úspěšně upravena.",
        "success"
      );
    }
  } catch (error) {
    console.error(
      error
    );

    showDashboardNotice(
      String(
        error?.message ||
        "Rezervaci se nepodařilo kompletně upravit."
      ),
      "error"
    );

    await Promise.allSettled([
      loadReservations(),
      loadReservationHistory()
    ]);
  }
}

async function updateReservation(id, data = {}) {
  const reservationId =
    Number(id);

  const current =
    reservations.find(
      item =>
        Number(item.id) ===
        reservationId
    );

  if (
    !Number.isInteger(
      reservationId
    ) ||
    reservationId < 1 ||
    !current
  ) {
    showDashboardNotice(
      "Rezervace nebyla nalezena."
    );
    return false;
  }

  const has =
    key =>
      Object.prototype
        .hasOwnProperty
        .call(
          data,
          key
        );

  const payload = {
    action:
      "update-reservation",
    reservation_id:
      reservationId,
    name:
      has("name")
        ? String(
            data.name || ""
          ).trim()
        : String(
            current.name || ""
          ).trim(),
    last_name:
      has("last_name")
        ? data.last_name
        : (
            current.last_name ??
            null
          ),
    people:
      has("people")
        ? Number(
            data.people
          )
        : Number(
            current.people
          ),
    date:
      has("date")
        ? String(
            data.date || ""
          )
        : String(
            current.date || ""
          ),
    time:
      has("time")
        ? String(
            data.time || ""
          )
        : String(
            current.time || ""
          ).slice(0, 5),
    duration_minutes:
      has("duration_minutes")
        ? Number(
            data.duration_minutes
          )
        : Math.max(
            30,
            Number(
              current.duration_minutes ||
              120
            ) || 120
          ),
    table_id:
      has("table_id")
        ? data.table_id
        : (
            current.table_id ??
            null
          ),
    table_group_id:
      has("table_group_id")
        ? data.table_group_id
        : (
            current.table_group_id ??
            null
          ),
    phone:
      has("phone")
        ? String(
            data.phone || ""
          )
        : String(
            current.phone || ""
          ),
    email:
      has("email")
        ? String(
            data.email || ""
          )
        : String(
            current.email || ""
          ),
    note:
      has("note")
        ? String(
            data.note || ""
          )
        : String(
            current.note || ""
          ),
    status:
      has("status")
        ? String(
            data.status || ""
          )
        : String(
            current.status ||
            "Čeká"
          )
  };

  try {
    const response =
      await authorizedFetch(
        "/api/send-email",
        {
          method:
            "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify(
              payload
            )
        }
      );

    const result =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      throw new Error(
        result?.error ||
        "Nepodařilo se upravit rezervaci."
      );
    }

    await Promise.all([
      loadReservations(),
      loadReservationHistory()
    ]);

    return true;
  } catch (error) {
    console.error(error);

    showDashboardNotice(
      String(
        error?.message ||
        "Nepodařilo se upravit rezervaci."
      ),
      "error"
    );

    await Promise.allSettled([
      loadReservations(),
      loadReservationHistory()
    ]);

    return false;
  }
}

function sanitizeCsvCell(value) {
  const text =
    String(
      value ?? ""
    );

  if (
    /^[=+\-@]/.test(
      text.trimStart()
    )
  ) {
    return `'${text}`;
  }

  return text;
}

function exportReservations() {
  const data =
    getFilteredReservations();

  if (!data.length) {
    showDashboardNotice(
      "Nejsou žádné rezervace ke stažení."
    );
    return;
  }

  const columns = [
    "Jméno",
    "Počet osob",
    "Datum",
    "Čas",
    "Stůl / skupina",
    "Telefon",
    "E-mail",
    "Poznámka",
    "Stav"
  ];

  const rows =
    data.map(
      reservation => [
        getReservationGuestName(
          reservation
        ) === "-"
          ? ""
          : getReservationGuestName(
              reservation
            ),
        reservation.people || "",
        reservation.date || "",
        reservation.time || "",
        getReservationTableLabel(
          reservation
        ),
        reservation.phone || "",
        reservation.email || "",
        reservation.note || "",
        reservation.status || "Čeká"
      ]
    );

  const quote = value => {
    const safe =
      sanitizeCsvCell(
        value
      );

    return `"${safe.replace(
      /"/g,
      '""'
    )}"`;
  };

  const csv = [
    columns
      .map(quote)
      .join(";"),
    ...rows.map(
      row =>
        row
          .map(quote)
          .join(";")
    )
  ].join("\n");

  const blob =
    new Blob(
      ["\uFEFF" + csv],
      {
        type:
          "text/csv;charset=utf-8;"
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      "a"
    );

  link.href =
    url;

  link.download =
    `rezervace-${getLocalDateString()}.csv`;

  document.body.appendChild(
    link
  );

  link.click();
  link.remove();

  URL.revokeObjectURL(
    url
  );
}

/* =========================================================
   GRAFY
========================================================= */

function renderCharts() {
  if (typeof Chart === "undefined") {
    return;
  }

  Chart.defaults.color = "#cbd5e1";
  Chart.defaults.borderColor =
    "rgba(148,163,184,.15)";

  const labels = [];
  const counts = [];

  for (let index = 6; index >= 0; index--) {
    const date = new Date();

    date.setDate(
      date.getDate() - index
    );

    const key =
      getLocalDateString(date);

    labels.push(
      date.toLocaleDateString("cs-CZ", {
        weekday: "short",
        day: "numeric",
        month: "numeric"
      })
    );

    counts.push(
      reservations.filter(
        reservation =>
          reservation.date === key
      ).length
    );
  }

  reservationChart?.destroy();

  reservationChart = new Chart(
    document.getElementById(
      "reservationChart"
    ),
    {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Rezervace",
            data: counts,
            backgroundColor:
              "rgba(255,90,31,.75)",
            borderColor: "#ff5a1f",
            borderWidth: 1,
            borderRadius: 8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0
            }
          },
          x: {
            grid: {
              display: false
            }
          }
        }
      }
    }
  );

  const statuses = [
    "Čeká",
    "Potvrzeno",
    "Zrušeno"
  ];

  statusChart?.destroy();

  statusChart = new Chart(
    document.getElementById(
      "statusChart"
    ),
    {
      type: "doughnut",
      data: {
        labels: statuses,
        datasets: [
          {
            data: statuses.map(status => {
              return reservations.filter(
                reservation =>
                  (
                    reservation.status ||
                    "Čeká"
                  ) === status
              ).length;
            }),
            backgroundColor: [
              "#f59e0b",
              "#22c55e",
              "#ef4444"
            ],
            borderWidth: 0,
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              padding: 18,
              usePointStyle: true
            }
          }
        }
      }
    }
  );
}

/* =========================================================
   STOLY
========================================================= */

async function loadTables() {
  const list =
    document.getElementById("tableList");

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/restaurant_tables?restaurant_id=eq.${currentRestaurantId}&select=*&order=name.asc`
    );
const groupsResponse = await authorizedFetch(
  `${SUPABASE_URL}/rest/v1/table_groups?restaurant_id=eq.${currentRestaurantId}&select=*&order=id.asc`
);
    const data = await response.json();
const groupsData = await groupsResponse.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }
if (!groupsResponse.ok) {
  throw new Error(JSON.stringify(groupsData));
}
    restaurantTables =
      Array.isArray(data) ? data : [];
    
tableGroups =
  Array.isArray(groupsData) ? groupsData : [];
    
    document.getElementById(
      "tableCount"
    ).textContent = restaurantTables.filter(
      table => table.active
    ).length;

    renderTables();
    renderFloorMap();
    renderReservations(getFilteredReservations());
    renderSetupChecklist();
  } catch (error) {
    console.error(error);

    restaurantTables = [];
    tableGroups = [];
    document.getElementById(
      "tableCount"
    ).textContent = "–";

    if (list) {
      list.innerHTML = `
        <div class="emptyState">
          Nepodařilo se načíst stoly.
        </div>
      `;
    }
  }
}
function getReservationLiveStatus(
  reservation,
  now = new Date()
) {
  if (
    !reservation ||
    (reservation.status || "Čeká") === "Zrušeno"
  ) {
    return "free";
  }

  const start =
    new Date(
      `${reservation.date}T${String(
        reservation.time || ""
      ).slice(0, 5)}`
    );

  if (
    Number.isNaN(
      start.getTime()
    )
  ) {
    return "free";
  }

  const durationMinutes =
    Math.max(
      30,
      Number(
        reservation.duration_minutes || 120
      ) || 120
    );

  const end =
    new Date(
      start.getTime() +
      durationMinutes * 60000
    );

  const minutesUntilStart =
    (start.getTime() - now.getTime()) /
    60000;

  if (
    now >= start &&
    now < end
  ) {
    return "occupied";
  }

  if (
    minutesUntilStart > 0 &&
    minutesUntilStart <= 30
  ) {
    return "busy";
  }

  return "free";
}

function combineLiveStatuses(statuses) {
  if (statuses.includes("occupied")) {
    return "occupied";
  }

  if (statuses.includes("busy")) {
    return "busy";
  }

  return "free";
}

function getTableStatus(tableId) {
  const relevantReservations =
    reservations.filter(
      reservation =>
        Number(reservation.table_id) ===
          Number(tableId) &&
        (reservation.status || "Čeká") !==
          "Zrušeno"
    );

  return combineLiveStatuses(
    relevantReservations.map(
      reservation =>
        getReservationLiveStatus(
          reservation
        )
    )
  );
}

function getTableGroupStatus(group) {
  const groupId =
    Number(group?.id);

  const memberIds =
    new Set(
      Array.isArray(group?.table_ids)
        ? group.table_ids.map(Number)
        : []
    );

  const relevantReservations =
    reservations.filter(
      reservation =>
        (
          Number(
            reservation.table_group_id
          ) === groupId ||
          memberIds.has(
            Number(
              reservation.table_id
            )
          )
        ) &&
        (reservation.status || "Čeká") !==
          "Zrušeno"
    );

  return combineLiveStatuses(
    relevantReservations.map(
      reservation =>
        getReservationLiveStatus(
          reservation
        )
    )
  );
}

function renderFloorMap() {
  const floorMap = document.getElementById("floorMap");

  if (!floorMap) return;

  const activeTables = restaurantTables.filter((table) => {
    const tableRoom = table.room || "Hlavní sál";

    return table.active && tableRoom === selectedRoom;
  });

  const activeGroups = tableGroups.filter((group) => {
    const groupRoom = group.room || "Hlavní sál";
    return (
      group.active !== false &&
      groupRoom === selectedRoom
    );
  });

  const groupedTableIds = new Set(
    activeGroups.flatMap((group) =>
      Array.isArray(group.table_ids)
        ? group.table_ids.map(Number)
        : []
    )
  );

  const separateTables = activeTables.filter(
    (table) => !groupedTableIds.has(Number(table.id))
  );

  const groupTables = activeGroups
    .map((group) => {
      const memberIds = Array.isArray(group.table_ids)
        ? group.table_ids.map(Number)
        : [];

      const members = activeTables.filter((table) =>
        memberIds.includes(Number(table.id))
      );

      if (members.length === 0) return null;

      const fallbackX =
        members.reduce(
          (sum, table) => sum + Number(table.x ?? 100),
          0
        ) / members.length;

      const fallbackY =
        members.reduce(
          (sum, table) => sum + Number(table.y ?? 100),
          0
        ) / members.length;

      const x =
        group.x !== null && group.x !== undefined
          ? Number(group.x)
          : fallbackX;

      const y =
        group.y !== null && group.y !== undefined
          ? Number(group.y)
          : fallbackY;

      const statusClass =
        getTableGroupStatus(group);

      return {
        id: group.id,
        name: group.name || "Spojené stoly",
        capacity: Number(group.total_capacity || 0),
        x,
        y,
        statusClass,
        isGroup: true
      };
    })
    .filter(Boolean);

  const renderItems = [
    ...separateTables.map((table) => ({
      ...table,
      isGroup: false
    })),
    ...groupTables
  ];

  if (renderItems.length === 0) {
    floorMap.replaceChildren();

    const emptyState = document.createElement("div");
    emptyState.className = "emptyState";
    emptyState.append(
      document.createTextNode("V místnosti "),
      Object.assign(document.createElement("strong"), {
        textContent: String(selectedRoom || "")
      }),
      document.createTextNode(" zatím nejsou žádné stoly.")
    );

    floorMap.appendChild(emptyState);
    return;
  }

  floorMap.innerHTML = renderItems
    .map((item) => {
      const statusClass = item.isGroup
        ? item.statusClass
        : getTableStatus(item.id);

      const statusLabel =
        statusClass === "occupied"
          ? "Obsazený"
          : statusClass === "busy"
            ? "Rezervace brzy"
            : "Volný";

      const capacity =
        item.capacity || item.seats || 0;

      const safeItemId = Number(item.id);
      const safeX = Number.isFinite(Number(item.x)) ? Number(item.x) : 0;
      const safeY = Number.isFinite(Number(item.y)) ? Number(item.y) : 0;

      const clickAction = item.isGroup
        ? `onclick="openTableGroup(${safeItemId})"`
        : `onclick="handleTableClick(event, ${safeItemId})"`;
      const groupClass = item.isGroup
        ? " table-group"
        : "";

      return `
        <div
          class="table ${statusClass}${groupClass}"
          ${
            item.isGroup
              ? `data-group-id="${safeItemId}"`
              : `data-table-id="${safeItemId}"`
          }
          style="left:${safeX}px; top:${safeY}px;"
          title="${escapeHtml(item.name || `Stůl ${item.id}`)} • ${Number(capacity) || 0} míst • ${escapeHtml(statusLabel)}"
          ${clickAction}
        >
          <span class="table-map-name">
            ${escapeHtml(item.name || `Stůl ${item.id}`)}
          </span>

          <span class="table-map-capacity">
            👥 ${Number(capacity) || 0}
          </span>

          <span class="table-map-status">
            ${statusLabel}
          </span>
        </div>
      `;
    })
    .join("");
}
let selectedTableId = null;
let selectedTableReservationId = null;
function handleTableClick(event, tableId) {
  if (tableWasDragged) {
    return;
}
  if (mergeModeActive) {
  const numericTableId = Number(tableId);
  const tableElement = event.currentTarget;

  const alreadySelected =
    selectedTablesForMerge.includes(numericTableId);

  if (alreadySelected) {
    selectedTablesForMerge =
      selectedTablesForMerge.filter(
        id => id !== numericTableId
      );

    tableElement.classList.remove("merge-selected");
  } else {
    selectedTablesForMerge.push(numericTableId);
    tableElement.classList.add("merge-selected");
  }

  const mergeSelectionInfo =
    document.getElementById("mergeSelectionInfo");

  const confirmMergeButton =
    document.getElementById("confirmMergeButton");

  if (mergeSelectionInfo) {
    mergeSelectionInfo.textContent =
      `Vybráno: ${selectedTablesForMerge.length} stolů`;
  }

  if (confirmMergeButton) {
    confirmMergeButton.style.display =
      selectedTablesForMerge.length >= 2
        ? "inline-block"
        : "none";
  }

  return;
}
  openTable(tableId);
}
function openTableGroup(groupId) {
  selectedTableId =
    null;

  selectedTableReservationId =
    null;

  const group = tableGroups.find(
    (item) => Number(item.id) === Number(groupId)
  );

  if (!group) return;

  const primaryButton = document.getElementById(
    "tableModalPrimaryButton"
  );

  const deleteButton = document.getElementById(
    "deleteTableButton"
  );

  document.getElementById("tableModalTitle").textContent =
    group.name || "Spojené stoly";

  document.getElementById("tableModalCapacity").textContent =
    group.total_capacity || 0;

  document.getElementById("tableModalStatus").textContent =
    "Spojená skupina stolů";

  if (primaryButton) {
    primaryButton.textContent = "Rozpojit stoly";
    primaryButton.onclick = () => unmergeTableGroup(group.id);
  }

  if (deleteButton) {
    deleteButton.style.display = "none";
  }

  document
    .getElementById("tableModal")
    .classList.add("show");
}

 async function unmergeTableGroup(groupId) {
  const confirmed = confirm(
    "Opravdu chcete tyto stoly rozpojit?"
  );

  if (!confirmed) return;

  try {
    const group = tableGroups.find(
      (item) => Number(item.id) === Number(groupId)
    );

    if (!group) {
      throw new Error("Skupina stolů nebyla nalezena.");
    }

    const memberIds = Array.isArray(group.table_ids)
      ? group.table_ids.map(Number)
      : [];

    if (memberIds.length === 0) {
      throw new Error("Skupina neobsahuje žádné stoly.");
    }

    const members = restaurantTables.filter((table) =>
      memberIds.includes(Number(table.id))
    );

    if (members.length === 0) {
      throw new Error("Stoly ze skupiny nebyly nalezeny.");
    }

    const groupReservationsResponse =
      await authorizedFetch(
        `${SUPABASE_URL}/rest/v1/reservations?restaurant_id=eq.${currentRestaurantId}&table_group_id=eq.${Number(groupId)}&status=neq.${encodeURIComponent("Zrušeno")}&select=id,date,time,duration_minutes,status`,
        {
          headers:
            getHeaders({
              "Cache-Control":
                "no-cache"
            })
        }
      );

    if (!groupReservationsResponse.ok) {
      throw new Error(
        await groupReservationsResponse.text()
      );
    }

    const groupReservations =
      await groupReservationsResponse.json();

    if (
      Array.isArray(groupReservations) &&
      groupReservations.some(
        reservation =>
          reservationHasNotEnded(
            reservation
          )
      )
    ) {
      showDashboardNotice(
        "Skupinu nelze rozpojit, protože na ní je aktuální nebo budoucí rezervace. Nejdřív rezervaci přesuň nebo zruš."
      );
      return;
    }

    // Střed skupiny podle současných pozic jejích stolů.
    const centerX =
      members.reduce(
        (sum, table) => sum + Number(table.x || 100),
        0
      ) / members.length;

    const centerY =
      members.reduce(
        (sum, table) => sum + Number(table.y || 100),
        0
      ) / members.length;

    // Po rozpojení rozmístíme stoly kolem původního středu skupiny.
    // Díky tomu se už nebudou překrývat.
    const spacing = 150;

    for (let index = 0; index < members.length; index += 1) {
      const table = members[index];

      const offset =
        (index - (members.length - 1) / 2) * spacing;

      const newX = Math.max(
        20,
        Math.round(centerX + offset)
      );

      const newY = Math.max(
        20,
        Math.round(centerY)
      );

      const tableResponse = await authorizedFetch(
        `${SUPABASE_URL}/rest/v1/restaurant_tables?id=eq.${table.id}&restaurant_id=eq.${currentRestaurantId}`,
        {
          method: "PATCH",
          headers: getHeaders({
            Prefer: "return=minimal"
          }),
          body: JSON.stringify({
            x: newX,
            y: newY
          })
        }
      );

      if (!tableResponse.ok) {
        throw new Error(await tableResponse.text());
      }
    }

    // Skupinu nemažeme.
    // Pouze ji deaktivujeme, aby zůstala zachována
    // pro historické rezervace.
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/table_groups?id=eq.${groupId}&restaurant_id=eq.${currentRestaurantId}`,
      {
        method: "PATCH",
        headers: getHeaders({
          Prefer: "return=minimal"
        }),
        body: JSON.stringify({
          active: false
        })
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    closeTableModal();

    await loadTables();

    showDashboardNotice(
      "Stoly byly úspěšně rozpojeny."
    );
  } catch (error) {
    console.error(error);

    showDashboardNotice(
      "Stoly se nepodařilo rozpojit."
    );
  }
}
function openTable(tableId) {
  const table =
    restaurantTables.find(
      item =>
        Number(item.id) ===
        Number(tableId)
    );

  if (!table) {
    return;
  }

  selectedTableId =
    Number(tableId);

  const tableStatus =
    getTableStatus(
      tableId
    );

  const reservation =
    reservations.find(
      item => {
        if (
          Number(item.table_id) !==
          Number(tableId)
        ) {
          return false;
        }

        const liveStatus =
          getReservationLiveStatus(
            item
          );

        return (
          liveStatus === "occupied" ||
          liveStatus === "busy"
        );
      }
    ) || null;

  selectedTableReservationId =
    reservation
      ? Number(reservation.id)
      : null;

  const primaryButton =
    document.getElementById(
      "tableModalPrimaryButton"
    );

  const deleteButton =
    document.getElementById(
      "deleteTableButton"
    );

  if (primaryButton) {
    primaryButton.textContent =
      reservation
        ? "✏️ Upravit rezervaci"
        : "+ Nová rezervace";

    primaryButton.onclick =
      handleTableModalPrimaryAction;
  }

  if (deleteButton) {
    deleteButton.style.display =
      "";
  }

  document
    .getElementById(
      "tableModalTitle"
    )
    .textContent =
      table.name;

  document
    .getElementById(
      "tableModalCapacity"
    )
    .textContent =
      table.capacity;

  document
    .getElementById(
      "tableModalStatus"
    )
    .textContent =
      !table.active
        ? "Neaktivní"
        : tableStatus === "occupied"
          ? "Obsazený"
          : tableStatus === "busy"
            ? "Brzy obsazený"
            : "Volný";

  if (reservation) {
    const tableModalCapacity =
      document.getElementById(
        "tableModalCapacity"
      );

    if (tableModalCapacity) {
      tableModalCapacity
        .replaceChildren();

      [
        `👤 ${getReservationGuestName(
          reservation
        )}`,
        `👥 ${reservation.people || "-"} osoby`,
        `🕒 ${String(
          reservation.time || "-"
        ).slice(0, 5)}`,
        `📞 ${reservation.phone || "-"}`
      ].forEach(
        (line, index) => {
          if (index > 0) {
            tableModalCapacity
              .appendChild(
                document.createElement(
                  "br"
                )
              );
          }

          tableModalCapacity
            .appendChild(
              document.createTextNode(
                String(line)
              )
            );
        }
      );
    }

    document
      .getElementById(
        "tableModalStatus"
      )
      .textContent =
        reservation.status ||
        "Čeká";
  }

  document
    .getElementById(
      "tableModal"
    )
    .classList.add(
      "show"
    );
}

function closeTableModal() {
    document
        .getElementById("tableModal")
        .classList.remove("show");

    selectedTableReservationId = null;
}

function handleTableModalPrimaryAction() {
    if (selectedTableReservationId !== null) {
        const reservationId = selectedTableReservationId;

        closeTableModal();
        editReservation(reservationId);
        return;
    }

    createReservationFromTable();
}


function getNewReservationDraft() {
  const people = Number(document.getElementById("newPeople")?.value || 0);
  const date = document.getElementById("newDate")?.value || "";
  const time = document.getElementById("newTime")?.value || "";
  const durationMinutes = Number(
    document.getElementById("newDuration")?.value || 120
  );

  return {
    people,
    date,
    time,
    duration_minutes: durationMinutes,
    status: "Čeká"
  };
}

function createTableOption({
  value,
  label,
  selected = false,
  disabled = false
}) {
  const option =
    document.createElement("option");

  option.value =
    String(value);

  option.textContent =
    String(label);

  if (selected) {
    option.setAttribute(
      "selected",
      ""
    );
    option.selected =
      true;
  }

  if (disabled) {
    option.setAttribute(
      "disabled",
      ""
    );
    option.disabled =
      true;
  }

  return option;
}

function fillNewTableOptions(
  preferredValue = "auto"
) {
  const tableSelect =
    document.getElementById(
      "newTable"
    );

  if (!tableSelect) {
    return;
  }

  const groupedTableIds =
    getActiveGroupedTableIds();

  const activeTables =
    restaurantTables
      .filter(
        table =>
          table.active &&
          !groupedTableIds.has(
            Number(table.id)
          )
      )
      .sort(
        (a, b) =>
          Number(a.capacity) -
          Number(b.capacity)
      );

  const activeGroups =
    tableGroups
      .filter(
        group =>
          isUsableTableGroup(
            group
          )
      )
      .sort(
        (a, b) =>
          Number(
            a.total_capacity || 0
          ) -
          Number(
            b.total_capacity || 0
          )
      );

  tableSelect.replaceChildren(
    createTableOption({
      value: "auto",
      label:
        "🪄 Automaticky vybrat nejlepší stůl / skupinu"
    }),
    ...activeTables.map(
      table =>
        createTableOption({
          value:
            Number(table.id),
          label:
            `${String(
              table.name || ""
            )} (${Number(
              table.capacity
            )} míst)`
        })
    ),
    ...activeGroups.map(
      group =>
        createTableOption({
          value:
            `group:${Number(
              group.id
            )}`,
          label:
            `🔗 ${String(
              group.name ||
              "Spojené stoly"
            )} (${Number(
              group.total_capacity || 0
            )} míst)`
        })
    )
  );

  const optionExists =
    Array.from(
      tableSelect.options
    ).some(
      option =>
        option.value ===
        String(
          preferredValue
        )
    );

  tableSelect.value =
    optionExists
      ? String(
          preferredValue
        )
      : "auto";
}

function updateNewTableRecommendation() {
  const box =
    document.getElementById(
      "tableRecommendation"
    );

  const tableSelect =
    document.getElementById(
      "newTable"
    );

  if (
    !box ||
    !tableSelect
  ) {
    return;
  }

  const draft =
    getNewReservationDraft();

  if (
    !draft.people ||
    !draft.date ||
    !draft.time
  ) {
    box.className =
      "tableRecommendation";

    box.textContent =
      "Zadej počet osob, datum a čas. Systém potom doporučí nejlepší volný stůl nebo skupinu.";

    return;
  }

  const bestResource =
    findBestAvailableResource(
      draft
    );

  if (!bestResource) {
    box.className =
      "tableRecommendation unavailable";

    box.textContent =
      `Pro ${draft.people} osob v ${draft.time} není volný vhodný stůl ani skupina.`;

    return;
  }

  box.className =
    "tableRecommendation available";

  const strong =
    document.createElement(
      "strong"
    );

  strong.textContent =
    `🪄 Doporučení: ${bestResource.type === "group" ? "🔗 " : ""}${bestResource.name}`;

  const detail =
    document.createElement(
      "span"
    );

  detail.textContent =
    `${bestResource.capacity} míst · volné po celou dobu rezervace`;

  box.replaceChildren(
    strong,
    detail
  );
}

function setupAutomaticTableRecommendation() {
  ["newPeople", "newDate", "newTime", "newDuration", "newTable"]
    .forEach(id => {
      const element = document.getElementById(id);
      if (!element || element.dataset.autoTableListener === "1") return;
      element.dataset.autoTableListener = "1";
      element.addEventListener("input", updateNewTableRecommendation);
      element.addEventListener("change", updateNewTableRecommendation);
    });
}

function openNewReservationForm() {
  if (
    !canAccessSection(
      "rezervace"
    )
  ) {
    showDashboardNotice(
      "Pro vytváření rezervací nemáš oprávnění.",
      "info"
    );
    return;
  }

  showDashboardSection(
    "rezervace"
  );

  const reservationSection =
    document.getElementById(
      "novaRezervace"
    );

  const dateInput =
    document.getElementById(
      "newDate"
    );

  if (!reservationSection) {
    showDashboardNotice(
      "Formulář nové rezervace se nepodařilo otevřít."
    );
    return;
  }

  fillNewTableOptions(
    "auto"
  );

  setupAutomaticTableRecommendation();

  if (
    dateInput &&
    !dateInput.value
  ) {
    dateInput.value =
      getLocalDateString();
  }

  updateNewTableRecommendation();

  reservationSection.style.display =
    "block";

  requestAnimationFrame(
    () => {
      reservationSection.scrollIntoView({
        behavior:
          "smooth",
        block:
          "start"
      });

      document
        .getElementById(
          "newName"
        )
        ?.focus();
    }
  );
}

function createReservationFromTable() {
    closeTableModal();

    const reservationSection = document.getElementById("novaRezervace");
    const tableSelect = document.getElementById("newTable");

    if (!reservationSection || !tableSelect) {
        showDashboardNotice("Formulář rezervace se nepodařilo otevřít.");
        return;
    }

    fillNewTableOptions(selectedTableId);
    setupAutomaticTableRecommendation();
    updateNewTableRecommendation();
    reservationSection.style.display = "block";
    reservationSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}
async function saveNewReservation() {
  const name =
    document
      .getElementById(
        "newName"
      )
      .value
      .trim();

  const people =
    Number(
      document.getElementById(
        "newPeople"
      ).value
    );

  const date =
    document.getElementById(
      "newDate"
    ).value;

  const time =
    document.getElementById(
      "newTime"
    ).value;

  const durationMinutes =
    Number(
      document.getElementById(
        "newDuration"
      )?.value || 120
    );

  const tableValue =
    String(
      document.getElementById(
        "newTable"
      ).value || ""
    );

  const phone =
    document
      .getElementById(
        "newPhone"
      )
      .value
      .trim();

  const email =
    document
      .getElementById(
        "newEmail"
      )
      .value
      .trim();

  const note =
    document
      .getElementById(
        "newNote"
      )
      .value
      .trim();

  if (
    !name ||
    !date ||
    !time ||
    !Number.isInteger(
      people
    ) ||
    people < 1 ||
    people > 30 ||
    !Number.isFinite(
      durationMinutes
    ) ||
    durationMinutes < 30 ||
    durationMinutes > 360
  ) {
    showDashboardNotice(
      "Vyplň správně jméno, počet osob, datum, čas a délku."
    );
    return;
  }

  if (
    name.length > 120 ||
    phone.length > 40 ||
    note.length > 1000
  ) {
    showDashboardNotice(
      "Jméno může mít maximálně 120 znaků, telefon 40 a poznámka 1000."
    );
    return;
  }

  if (
    !isValidOptionalEmail(
      email
    )
  ) {
    showDashboardNotice(
      "Zadej platný e-mail, nebo pole nech prázdné."
    );
    return;
  }

  const openingAvailability =
    await checkDashboardOpeningAvailability({
      date,
      time,
      durationMinutes
    });

  if (
    !openingAvailability.ok
  ) {
    showDashboardNotice(
      openingAvailability.message
    );
    return;
  }

  try {
    await fetchReservationsSnapshot();
  } catch (error) {
    console.error(
      "Čerstvý stav rezervací se nepodařilo načíst:",
      error
    );

    showDashboardNotice(
      "Rezervaci teď nelze bezpečně uložit. Obnov stránku a zkus to znovu."
    );
    return;
  }

  const reservationDraft = {
    people,
    date,
    time,
    duration_minutes:
      durationMinutes,
    status:
      "Čeká"
  };

  let selectedTable =
    null;

  let selectedGroup =
    null;

  if (
    tableValue === "auto" ||
    tableValue === ""
  ) {
    const bestResource =
      findBestAvailableResource(
        reservationDraft
      );

    if (!bestResource) {
      showDashboardNotice(
        `Pro ${people} osob v ${time} není volný vhodný stůl ani skupina.\n\n` +
        "Zvol jiný čas, kratší délku nebo uprav rozložení stolů."
      );
      return;
    }

    selectedTable =
      bestResource.table;

    selectedGroup =
      bestResource.group;
  } else if (
    tableValue.startsWith(
      "group:"
    )
  ) {
    const groupId =
      Number(
        tableValue.slice(6)
      );

    selectedGroup =
      tableGroups.find(
        group =>
          Number(group.id) ===
            groupId &&
          isUsableTableGroup(
            group
          )
      ) || null;
  } else {
    const tableId =
      Number(tableValue);

    selectedTable =
      restaurantTables.find(
        table =>
          Number(table.id) ===
          tableId
      ) || null;
  }

  if (
    !selectedTable &&
    !selectedGroup
  ) {
    showDashboardNotice(
      "Vyber platný stůl nebo skupinu."
    );
    return;
  }

  const resourceName =
    selectedTable?.name ||
    selectedGroup?.name ||
    "Vybrané místo";

  const resourceCapacity =
    selectedTable
      ? Number(
          selectedTable.capacity ||
          0
        )
      : Number(
          selectedGroup
            ?.total_capacity ||
          0
        );

  if (
    people >
    resourceCapacity
  ) {
    showDashboardNotice(
      `${resourceName} má pouze ${resourceCapacity} míst.`
    );
    return;
  }

  if (
    selectedTable &&
    isTableInActiveGroup(
      selectedTable.id
    )
  ) {
    showDashboardNotice(
      `${resourceName} je součástí spojených stolů. Vyber skupinu nebo jiný stůl.`
    );
    return;
  }

  const newReservation = {
    name,
    last_name:
      null,
    people,
    date,
    time,
    duration_minutes:
      durationMinutes,
    table_id:
      selectedTable
        ? Number(
            selectedTable.id
          )
        : null,
    table_group_id:
      selectedGroup
        ? Number(
            selectedGroup.id
          )
        : null,
    phone,
    email,
    note,
    status:
      "Čeká",
    restaurant_id:
      currentRestaurantId
  };

  if (
    selectedTable &&
    hasTableConflict(
      selectedTable.id,
      newReservation
    )
  ) {
    showDashboardNotice(
      `${resourceName} je v tomto čase obsazený.\n\nVyber jiné místo nebo jiný čas.`
    );
    return;
  }

  if (
    selectedGroup &&
    hasTableGroupConflict(
      selectedGroup.id,
      newReservation
    )
  ) {
    showDashboardNotice(
      `${resourceName} je v tomto čase obsazená.\n\nVyber jiné místo nebo jiný čas.`
    );
    return;
  }

  try {
    const response =
      await authorizedFetch(
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
                "create-dashboard-reservation",
              restaurant_id:
                Number(
                  currentRestaurantId
                ),
              name,
              people,
              date,
              time,
              duration_minutes:
                durationMinutes,
              table_id:
                newReservation
                  .table_id,
              table_group_id:
                newReservation
                  .table_group_id,
              phone,
              email,
              note
            })
        }
      );

    const result =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      throw new Error(
        result?.error ||
        "Rezervaci se nepodařilo uložit."
      );
    }

    document
      .getElementById(
        "novaRezervace"
      )
      .style.display =
        "none";

    [
      "newName",
      "newPeople",
      "newDate",
      "newTime",
      "newPhone",
      "newEmail",
      "newNote"
    ].forEach(id => {
      document
        .getElementById(
          id
        )
        .value = "";
    });

    const newDuration =
      document.getElementById(
        "newDuration"
      );

    if (newDuration) {
      newDuration.value =
        "120";
    }

    selectedTableId =
      null;

    const [reservationsLoaded] = await Promise.all([
      loadReservations(),
      loadReservationHistory()
    ]);

    showDashboardNotice(
      reservationsLoaded
        ? "Rezervace byla úspěšně uložena."
        : "Rezervace byla uložena, ale přehled se nepodařilo obnovit. Obnov stránku.",
      reservationsLoaded ? "success" : "info"
    );
  } catch (error) {
    console.error(
      error
    );

    showDashboardNotice(
      String(
        error?.message ||
        "Rezervaci se nepodařilo uložit."
      ),
      "error"
    );
  }
}

function renderTables() {
  const list =
    document.getElementById("tableList");

  if (!list) {
    return;
  }

  if (!restaurantTables.length) {
    list.innerHTML = `
      <div class="emptyState">
        Zatím nejsou vytvořené žádné stoly. Přidej první stůl a nastav jeho kapacitu.
      </div>
    `;

    return;
  }

  list.innerHTML = restaurantTables
    .map(table => {
      return `
        <div
          class="tableItem ${
            table.active
              ? ""
              : "tableInactive"
          }"
        >

          <div class="tableIcon">
            🪑
          </div>

          <div class="tableInfo">

            <b>
              ${escapeHtml(
                table.name || "Stůl"
              )}
            </b>

            <div class="tableCapacity">
              ${escapeHtml(
                table.capacity || 0
              )}
              míst
            </div>

            <small>
              ${escapeHtml(
                table.note || "Bez poznámky"
              )}
              •
              ${
                table.active
                  ? "Aktivní"
                  : "Neaktivní"
              }
            </small>

          </div>

          <div class="tableActions">

            <button
              class="editBtn"
              type="button"
              title="Upravit stůl"
              onclick="editTable(
                ${Number(table.id)}
              )"
            >
              ✏️
            </button>

            <button
              class="deleteBtn"
              type="button"
              title="Smazat stůl"
              onclick="deleteTable(
                ${Number(table.id)}
              )"
            >
              🗑️
            </button>

          </div>

        </div>
      `;
    })
    .join("");
}

function getReservationsUsingTableResource(
  tableId
) {
  const numericTableId =
    Number(tableId);

  const relatedGroupIds =
    new Set(
      tableGroups
        .filter(
          group =>
            Array.isArray(
              group?.table_ids
            ) &&
            group.table_ids
              .map(Number)
              .includes(
                numericTableId
              )
        )
        .map(
          group =>
            Number(group.id)
        )
    );

  return reservations.filter(
    reservation =>
      Number(
        reservation.table_id
      ) === numericTableId ||
      (
        reservation.table_group_id !==
          null &&
        reservation.table_group_id !==
          undefined &&
        relatedGroupIds.has(
          Number(
            reservation.table_group_id
          )
        )
      )
  );
}

function deleteCurrentTable() {
  if (
    selectedTableId === null ||
    selectedTableId === undefined
  ) {
    showDashboardNotice(
      "Není vybraný žádný stůl."
    );
    return;
  }

  deleteTable(
    selectedTableId
  );
}

async function saveTable() {
  const name =
    document
      .getElementById("tableName")
      .value
      .trim();

  const capacity =
    Number(
      document.getElementById(
        "tableCapacity"
      ).value
    );

  const note =
    document
      .getElementById("tableNote")
      .value
      .trim();

  const active =
    document.getElementById(
      "tableActive"
    ).checked;

  if (
    name.length < 2
  ) {
    showDashboardNotice(
      "Zadej název stolu."
    );
    return;
  }

  if (
    !Number.isInteger(
      capacity
    ) ||
    capacity < 1 ||
    capacity > 30
  ) {
    showDashboardNotice(
      "Kapacita musí být od 1 do 30 míst."
    );
    return;
  }

  const editing =
    editingTableId !== null;

  if (
    editing &&
    !active
  ) {
    if (
      isTableInActiveGroup(
        editingTableId
      )
    ) {
      showDashboardNotice(
        "Stůl je součástí aktivní skupiny. Nejdřív skupinu rozpoj."
      );
      return;
    }

    const blockingReservation =
      getReservationsUsingTableResource(
        editingTableId
      ).find(
        reservation =>
          reservationHasNotEnded(
            reservation
          )
      );

    if (
      blockingReservation
    ) {
      showDashboardNotice(
        "Stůl má aktuální nebo budoucí rezervaci. Nejdřív ji přesuň nebo zruš."
      );
      return;
    }
  }

  const duplicate =
    restaurantTables.some(
      table =>
        table.name
          .trim()
          .toLowerCase() ===
          name.toLowerCase() &&
        Number(table.id) !==
          Number(
            editingTableId
          )
    );

  if (duplicate) {
    showDashboardNotice(
      "Stůl s tímto názvem už existuje."
    );
    return;
  }

  try {
    const url =
      editing
        ? `${SUPABASE_URL}/rest/v1/restaurant_tables?id=eq.${editingTableId}&restaurant_id=eq.${currentRestaurantId}`
        : `${SUPABASE_URL}/rest/v1/restaurant_tables`;

    const tablePayload = {
      name,
      capacity,
      note,
      active
    };

    if (!editing) {
      tablePayload.restaurant_id =
        currentRestaurantId;
    }

    const response =
      await authorizedFetch(
        url,
        {
          method:
            editing
              ? "PATCH"
              : "POST",
          headers:
            getHeaders({
              Prefer:
                "return=minimal"
            }),
          body:
            JSON.stringify(
              tablePayload
            )
        }
      );

    if (!response.ok) {
      throw new Error(
        await response.text()
      );
    }

    resetTableForm();
    await loadTables();

    renderReservations(
      getFilteredReservations()
    );

    showDashboardNotice(
      editing
        ? "Stůl byl upraven."
        : "Stůl byl vytvořen.",
      "success"
    );
  } catch (error) {
    console.error(
      error
    );

    showDashboardNotice(
      "Nepodařilo se uložit stůl."
    );
  }
}

function editTable(id) {
  const table = restaurantTables.find(
    item => Number(item.id) === Number(id)
  );

  if (!table) {
    return;
  }

  editingTableId = Number(table.id);

  document.getElementById(
    "tableName"
  ).value = table.name || "";

  document.getElementById(
    "tableCapacity"
  ).value = table.capacity || "";

  document.getElementById(
    "tableNote"
  ).value = table.note || "";

  document.getElementById(
    "tableActive"
  ).checked = table.active !== false;

  document.getElementById(
    "tableBtn"
  ).textContent = "Uložit změny";

  document.getElementById(
    "cancelTableEditBtn"
  ).style.display = "inline-block";

  document.getElementById(
    "tableName"
  ).scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

function resetTableForm() {
  editingTableId = null;

  document.getElementById(
    "tableName"
  ).value = "";

  document.getElementById(
    "tableCapacity"
  ).value = "";

  document.getElementById(
    "tableNote"
  ).value = "";

  document.getElementById(
    "tableActive"
  ).checked = true;

  document.getElementById(
    "tableBtn"
  ).textContent = "Přidat stůl";

  document.getElementById(
    "cancelTableEditBtn"
  ).style.display = "none";
}

async function deleteTable(id) {
  const numericId =
    Number(id);

  const table =
    restaurantTables.find(
      item =>
        Number(item.id) ===
        numericId
    );

  if (!table) {
    showDashboardNotice(
      "Stůl nebyl nalezen."
    );
    return;
  }

  if (
    isTableInActiveGroup(
      numericId
    )
  ) {
    showDashboardNotice(
      "Stůl je součástí aktivní skupiny. Nejdřív skupinu rozpoj."
    );
    return;
  }

  const relatedReservations =
    getReservationsUsingTableResource(
      numericId
    );

  if (
    relatedReservations.length >
    0
  ) {
    showDashboardNotice(
      "Stůl je použitý v rezervacích. Pro zachování historie ho místo smazání deaktivuj."
    );
    return;
  }

  const tableName =
    table.name ||
    "tento stůl";

  if (
    !confirm(
      `Opravdu trvale smazat ${tableName}?`
    )
  ) {
    return;
  }

  try {
    const response =
      await authorizedFetch(
        `${SUPABASE_URL}/rest/v1/restaurant_tables?id=eq.${numericId}&restaurant_id=eq.${currentRestaurantId}`,
        {
          method:
            "DELETE",
          headers:
            getHeaders()
        }
      );

    if (!response.ok) {
      throw new Error(
        await response.text()
      );
    }

    if (
      Number(
        editingTableId
      ) === numericId
    ) {
      resetTableForm();
    }

    if (
      Number(
        selectedTableId
      ) === numericId
    ) {
      closeTableModal();
      selectedTableId =
        null;
    }

    await Promise.all([
      loadTables(),
      loadReservations()
    ]);

    showDashboardNotice(
      "Stůl byl smazán.",
      "success"
    );
  } catch (error) {
    console.error(
      error
    );

    showDashboardNotice(
      "Nepodařilo se smazat stůl."
    );
  }
}

function getTableName(tableId) {
  const table = restaurantTables.find(
    item =>
      Number(item.id) === Number(tableId)
  );

  return table?.name || "";
}

function renderTableSelect(
  reservation
) {
  const assignedValue =
    reservation
      ?.table_group_id
      ? `group:${Number(
          reservation
            .table_group_id
        )}`
      : (
          reservation
            ?.table_id ===
              null ||
          reservation
            ?.table_id ===
              undefined
        )
        ? ""
        : String(
            reservation
              .table_id
          );

  const groupedTableIds =
    getActiveGroupedTableIds();

  const options = [
    createTableOption({
      value: "",
      label:
        "Bez stolu",
      selected:
        assignedValue === ""
    })
  ];

  restaurantTables
    .filter(
      table =>
        (
          table.active &&
          !groupedTableIds.has(
            Number(table.id)
          )
        ) ||
        String(table.id) ===
          assignedValue
    )
    .sort(
      (a, b) =>
        Number(a.capacity) -
        Number(b.capacity)
    )
    .forEach(table => {
      const inActiveGroup =
        groupedTableIds.has(
          Number(table.id)
        );

      const suffix =
        !table.active
          ? " – neaktivní"
          : inActiveGroup
            ? " – součást spojených stolů"
            : "";

      options.push(
        createTableOption({
          value:
            Number(table.id),
          label:
            `${String(
              table.name || ""
            )} (${Number(
              table.capacity || 0
            )} míst)${suffix}`,
          selected:
            String(table.id) ===
            assignedValue
        })
      );
    });

  tableGroups
    .filter(
      group =>
        isUsableTableGroup(
          group
        ) ||
        `group:${Number(
          group.id
        )}` ===
          assignedValue
    )
    .sort(
      (a, b) =>
        Number(
          a.total_capacity || 0
        ) -
        Number(
          b.total_capacity || 0
        )
    )
    .forEach(group => {
      const suffix =
        isUsableTableGroup(
          group
        )
          ? ""
          : " – neaktivní";

      options.push(
        createTableOption({
          value:
            `group:${Number(
              group.id
            )}`,
          label:
            `🔗 ${String(
              group.name ||
              "Spojené stoly"
            )} (${Number(
              group.total_capacity || 0
            )} míst)${suffix}`,
          selected:
            `group:${Number(
              group.id
            )}` ===
              assignedValue
        })
      );
    });

  return `
    <select
      class="tableSelect"
      aria-label="Přiřadit stůl nebo skupinu"
      onchange="assignTable(
        ${Number(
          reservation.id
        )},
        this.value
      )"
    >
      ${options
        .map(
          option =>
            option.outerHTML
        )
        .join("")}
    </select>
  `;
}

function timeToMinutes(time) {
  if (!time || !String(time).includes(":")) {
    return 0;
  }

  const [hours, minutes] = String(time)
    .split(":")
    .map(Number);

  return hours * 60 + minutes;
}

function reservationsOverlap(first, second) {
  if (
    !first ||
    !second ||
    first.date !== second.date
  ) {
    return false;
  }

  const firstStart = timeToMinutes(first.time);
  const secondStart = timeToMinutes(second.time);

  const firstDuration = Math.max(
    30,
    Number(first.duration_minutes || 120)
  );

  const secondDuration = Math.max(
    30,
    Number(second.duration_minutes || 120)
  );

  const firstEnd = firstStart + firstDuration;
  const secondEnd = secondStart + secondDuration;

  return (
    firstStart < secondEnd &&
    secondStart < firstEnd
  );
}

function getActiveGroupedTableIds() {
  const groupedIds =
    new Set();

  tableGroups.forEach(group => {
    if (
      group?.active === false ||
      !Array.isArray(group?.table_ids)
    ) {
      return;
    }

    group.table_ids.forEach(id => {
      const numericId =
        Number(id);

      if (
        Number.isInteger(numericId) &&
        numericId > 0
      ) {
        groupedIds.add(numericId);
      }
    });
  });

  return groupedIds;
}

function isTableInActiveGroup(tableId) {
  return getActiveGroupedTableIds()
    .has(Number(tableId));
}

function reservationHasNotEnded(
  reservation,
  now = new Date()
) {
  if (
    !reservation ||
    (reservation.status || "Čeká") === "Zrušeno"
  ) {
    return false;
  }

  const start =
    new Date(
      `${reservation.date}T${String(
        reservation.time || ""
      ).slice(0, 5)}`
    );

  if (
    Number.isNaN(start.getTime())
  ) {
    return false;
  }

  const durationMinutes =
    Math.max(
      30,
      Number(
        reservation.duration_minutes || 120
      ) || 120
    );

  return (
    start.getTime() +
      durationMinutes * 60000 >
    now.getTime()
  );
}

function hasTableConflict(
  tableId,
  reservation,
  ignoredReservationId = null
) {
  const numericTableId =
    Number(tableId);

  const groupIdsForTable =
    new Set(
      tableGroups
        .filter(
          group =>
            Array.isArray(
              group?.table_ids
            ) &&
            group.table_ids
              .map(Number)
              .includes(
                numericTableId
              )
        )
        .map(
          group =>
            Number(group.id)
        )
    );

  return reservations.some(item => {
    if (
      ignoredReservationId !== null &&
      Number(item.id) ===
        Number(ignoredReservationId)
    ) {
      return false;
    }

    const usesSameTable =
      Number(item.table_id) ===
      numericTableId;

    const usesGroupContainingTable =
      item.table_group_id !== null &&
      item.table_group_id !== undefined &&
      groupIdsForTable.has(
        Number(
          item.table_group_id
        )
      );

    if (
      !usesSameTable &&
      !usesGroupContainingTable
    ) {
      return false;
    }

    if (
      (item.status || "Čeká") ===
      "Zrušeno"
    ) {
      return false;
    }

    return reservationsOverlap(
      reservation,
      item
    );
  });
}

function getTableGroupMemberIds(group) {
  return Array.isArray(
    group?.table_ids
  )
    ? group.table_ids
        .map(Number)
        .filter(
          id =>
            Number.isInteger(id) &&
            id > 0
        )
    : [];
}

function isUsableTableGroup(group) {
  if (
    !group ||
    group.active === false
  ) {
    return false;
  }

  const memberIds =
    getTableGroupMemberIds(
      group
    );

  if (memberIds.length < 2) {
    return false;
  }

  const activeTableIds =
    new Set(
      restaurantTables
        .filter(
          table =>
            table.active !== false
        )
        .map(
          table =>
            Number(table.id)
        )
    );

  return memberIds.every(
    id =>
      activeTableIds.has(id)
  );
}

function hasTableGroupConflict(
  groupId,
  reservation,
  ignoredReservationId = null
) {
  const numericGroupId =
    Number(groupId);

  const group =
    tableGroups.find(
      item =>
        Number(item.id) ===
        numericGroupId
    );

  if (!group) {
    return true;
  }

  const memberIds =
    new Set(
      getTableGroupMemberIds(
        group
      )
    );

  return reservations.some(
    item => {
      if (
        ignoredReservationId !== null &&
        Number(item.id) ===
          Number(
            ignoredReservationId
          )
      ) {
        return false;
      }

      if (
        (item.status || "Čeká") ===
        "Zrušeno"
      ) {
        return false;
      }

      let usesOverlappingResource =
        memberIds.has(
          Number(item.table_id)
        );

      if (
        !usesOverlappingResource &&
        item.table_group_id !== null &&
        item.table_group_id !== undefined
      ) {
        const existingGroup =
          tableGroups.find(
            candidate =>
              Number(
                candidate.id
              ) ===
              Number(
                item.table_group_id
              )
          );

        if (
          Number(
            item.table_group_id
          ) === numericGroupId
        ) {
          usesOverlappingResource =
            true;
        } else if (
          existingGroup
        ) {
          usesOverlappingResource =
            getTableGroupMemberIds(
              existingGroup
            ).some(
              id =>
                memberIds.has(
                  id
                )
            );
        }
      }

      if (
        !usesOverlappingResource
      ) {
        return false;
      }

      return reservationsOverlap(
        reservation,
        item
      );
    }
  );
}

function findBestAvailableGroup(
  reservation
) {
  return (
    tableGroups
      .filter(
        group =>
          isUsableTableGroup(
            group
          ) &&
          Number(
            group.total_capacity || 0
          ) >=
            Number(
              reservation.people
            ) &&
          !hasTableGroupConflict(
            group.id,
            reservation,
            reservation.id
          )
      )
      .sort(
        (first, second) =>
          Number(
            first.total_capacity || 0
          ) -
          Number(
            second.total_capacity || 0
          )
      )[0] || null
  );
}

function findBestAvailableResource(
  reservation
) {
  const table =
    findBestAvailableTable(
      reservation
    );

  if (table) {
    return {
      type: "table",
      value:
        String(
          Number(table.id)
        ),
      id:
        Number(table.id),
      name:
        table.name ||
        `Stůl ${table.id}`,
      capacity:
        Number(
          table.capacity || 0
        ),
      table,
      group: null
    };
  }

  const group =
    findBestAvailableGroup(
      reservation
    );

  if (!group) {
    return null;
  }

  return {
    type: "group",
    value:
      `group:${Number(
        group.id
      )}`,
    id:
      Number(group.id),
    name:
      group.name ||
      "Spojené stoly",
    capacity:
      Number(
        group.total_capacity || 0
      ),
    table: null,
    group
  };
}

function findBestAvailableTable(reservation) {
  return (
    restaurantTables
      .filter(table => {
        return (
          table.active &&
          !isTableInActiveGroup(
            table.id
          ) &&
          Number(table.capacity) >=
            Number(reservation.people) &&
          !hasTableConflict(
            table.id,
            reservation,
            reservation.id
          )
        );
      })
      .sort((first, second) => {
        return (
          Number(first.capacity) -
          Number(second.capacity)
        );
      })[0] || null
  );
}

async function autoAssignTable(
  reservationId
) {
  const reservation =
    reservations.find(
      item =>
        Number(item.id) ===
        Number(
          reservationId
        )
    );

  if (!reservation) {
    showDashboardNotice(
      "Rezervace nebyla nalezena."
    );
    return;
  }

  if (
    (reservation.status ||
      "Čeká") ===
    "Zrušeno"
  ) {
    showDashboardNotice(
      "Zrušené rezervaci nelze přiřadit stůl."
    );
    return;
  }

  const bestResource =
    findBestAvailableResource(
      reservation
    );

  if (!bestResource) {
    showDashboardNotice(
      `Pro rezervaci na ${formatDate(
        reservation.date
      )} v ${reservation.time || "-"} není volný vhodný stůl ani skupina.\n\nKontrola používá skutečnou délku rezervace.`
    );
    return;
  }

  const confirmed =
    confirm(
      `Doporučení: ${bestResource.type === "group" ? "🔗 " : ""}${bestResource.name}\n` +
      `Kapacita: ${bestResource.capacity} míst\n` +
      `Rezervace: ${reservation.people} osob\n\n` +
      "Přiřadit toto místo?"
    );

  if (!confirmed) {
    return;
  }

  await assignTable(
    reservationId,
    bestResource.value
  );
}

async function assignTable(
  reservationId,
  value
) {
  const resourceValue =
    String(
      value || ""
    );

  const tableGroupId =
    resourceValue.startsWith(
      "group:"
    )
      ? Number(
          resourceValue.slice(6)
        )
      : null;

  const tableId =
    resourceValue &&
    tableGroupId === null
      ? Number(
          resourceValue
        )
      : null;

  try {
    await fetchReservationsSnapshot();
  } catch (error) {
    console.error(
      "Čerstvý stav rezervací se nepodařilo načíst:",
      error
    );

    showDashboardNotice(
      "Přiřazení teď nelze bezpečně změnit. Obnov stránku a zkus to znovu."
    );

    renderReservations(
      getFilteredReservations()
    );
    return;
  }

  const reservation =
    reservations.find(
      item =>
        Number(item.id) ===
        Number(
          reservationId
        )
    );

  if (!reservation) {
    showDashboardNotice(
      "Rezervace nebyla nalezena."
    );
    return;
  }

  const selectedTable =
    tableId !== null
      ? restaurantTables.find(
          item =>
            Number(item.id) ===
            tableId
        ) || null
      : null;

  const selectedGroup =
    tableGroupId !== null
      ? tableGroups.find(
          item =>
            Number(item.id) ===
            tableGroupId
        ) || null
      : null;

  if (
    resourceValue &&
    !selectedTable &&
    !selectedGroup
  ) {
    showDashboardNotice(
      "Vybrané místo nebylo nalezeno."
    );

    renderReservations(
      getFilteredReservations()
    );
    return;
  }

  if (
    selectedTable &&
    isTableInActiveGroup(
      selectedTable.id
    ) &&
    Number(
      reservation.table_id
    ) !==
      Number(
        selectedTable.id
      )
  ) {
    showDashboardNotice(
      `${selectedTable.name} je součástí spojených stolů.`
    );

    renderReservations(
      getFilteredReservations()
    );
    return;
  }

  if (
    selectedTable &&
    selectedTable.active ===
      false
  ) {
    showDashboardNotice(
      `${selectedTable.name} je neaktivní.`
    );

    renderReservations(
      getFilteredReservations()
    );
    return;
  }

  if (
    selectedTable &&
    Number(
      reservation.people
    ) >
      Number(
        selectedTable.capacity
      )
  ) {
    showDashboardNotice(
      `${selectedTable.name} má pouze ${selectedTable.capacity} míst, ale rezervace je pro ${reservation.people} osob.`
    );

    renderReservations(
      getFilteredReservations()
    );
    return;
  }

  if (
    selectedTable &&
    hasTableConflict(
      selectedTable.id,
      reservation,
      reservation.id
    )
  ) {
    showDashboardNotice(
      `${selectedTable.name} je v tomto čase obsazený.\n\nVyber jiné místo nebo jiný čas.`
    );

    renderReservations(
      getFilteredReservations()
    );
    return;
  }

  if (
    selectedGroup
  ) {
    const preservingCurrentGroup =
      Number(
        reservation
          .table_group_id
      ) ===
      Number(
        selectedGroup.id
      );

    if (
      !preservingCurrentGroup &&
      !isUsableTableGroup(
        selectedGroup
      )
    ) {
      showDashboardNotice(
        "Vybraná skupina stolů není dostupná."
      );

      renderReservations(
        getFilteredReservations()
      );
      return;
    }

    const groupCapacity =
      Number(
        selectedGroup
          .total_capacity ||
        0
      );

    if (
      Number(
        reservation.people
      ) >
      groupCapacity
    ) {
      showDashboardNotice(
        `${selectedGroup.name || "Spojené stoly"} mají pouze ${groupCapacity} míst, ale rezervace je pro ${reservation.people} osob.`
      );

      renderReservations(
        getFilteredReservations()
      );
      return;
    }

    if (
      hasTableGroupConflict(
        selectedGroup.id,
        reservation,
        reservation.id
      )
    ) {
      showDashboardNotice(
        `${selectedGroup.name || "Spojené stoly"} jsou v tomto čase obsazené.\n\nVyber jiné místo nebo jiný čas.`
      );

      renderReservations(
        getFilteredReservations()
      );
      return;
    }
  }

  const saved =
    await updateReservation(
      reservationId,
      {
        table_id:
          selectedTable
            ? Number(
                selectedTable.id
              )
            : null,
        table_group_id:
          selectedGroup
            ? Number(
                selectedGroup.id
              )
            : null
      }
    );

  if (saved) {
    showDashboardNotice(
      "Přiřazení bylo uloženo.",
      "success"
    );
  } else {
    renderReservations(
      getFilteredReservations()
    );
  }
}

function getSafeHttpImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const isSafeProtocol =
      url.protocol === "https:" ||
      (
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      );

    return isSafeProtocol
      ? url.href
      : "";
  } catch {
    return "";
  }
}

async function loadFoods() {
  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/menu?restaurant_id=eq.${currentRestaurantId}&select=*&order=id.desc`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    foods =
      Array.isArray(data) ? data : [];

    document.getElementById(
      "foodCount"
    ).textContent = foods.length;

    renderFoods();
    renderSetupChecklist();
  } catch (error) {
    console.error(error);

    document.getElementById(
      "foodList"
    ).innerHTML = `
      <p>
        Nepodařilo se načíst menu.
      </p>
    `;
  }
}

async function saveFood() {
  const name =
    document
      .getElementById("foodName")
      .value
      .trim();

  const price =
    document
      .getElementById("foodPrice")
      .value
      .trim();

  const priceNumber =
    Number(price);

  const emoji =
    document
      .getElementById("foodEmoji")
      .value
      .trim() || "🍽️";

  const category =
    document.getElementById(
      "foodCategory"
    ).value;

  const description =
    document
      .getElementById("foodDescription")
      .value
      .trim();

  const ingredients =
    document
      .getElementById("foodIngredients")
      .value
      .trim();

  const allergens =
    document
      .getElementById("foodAllergens")
      .value
      .trim();

  const weight =
    document
      .getElementById("foodWeight")
      .value
      .trim();

  const imageFile =
    document.getElementById(
      "foodImage"
    ).files?.[0];

  if (!name || price === "") {
    showDashboardNotice("Vyplň název i cenu.");
    return;
  }

  if (
    !Number.isFinite(priceNumber) ||
    priceNumber < 0 ||
    priceNumber > 1000000
  ) {
    showDashboardNotice("Cena musí být platné nezáporné číslo.");
    return;
  }

  if (
    name.length > 120 ||
    emoji.length > 16 ||
    description.length > 1000 ||
    ingredients.length > 2000 ||
    allergens.length > 200 ||
    weight.length > 80
  ) {
    showDashboardNotice(
      "Některé údaje jídla jsou příliš dlouhé. Zkrať název, popis, ingredience nebo doplňující údaje."
    );
    return;
  }

  let imageUrl =
    getSafeHttpImageUrl(editingImageUrl);

  try {
    if (imageFile) {
      const extension = FOOD_IMAGE_TYPES.get(imageFile.type);

      if (!extension) {
        showDashboardNotice("Fotografie musí být JPG, PNG nebo WebP.");
        return;
      }

      if (imageFile.size <= 0 || imageFile.size > MAX_FOOD_IMAGE_BYTES) {
        showDashboardNotice("Fotografie může mít maximálně 5 MB.");
        return;
      }

      const fileName =
        `${Date.now()}-` +
        `${Math.random()
          .toString(36)
          .slice(2)}.` +
        extension;
      const objectPath = `${currentRestaurantId}/${fileName}`;

      const upload = await authorizedFetch(
        `${SUPABASE_URL}/storage/v1/object/food-images/${objectPath}`,
        {
          method: "POST",
          headers: getHeaders({
            "Content-Type": imageFile.type,
            "x-upsert": "false"
          }),
          body: imageFile
        }
      );

      if (!upload.ok) {
        throw new Error(
          await upload.text()
        );
      }

      imageUrl =
        `${SUPABASE_URL}/storage/v1/object/public/food-images/${objectPath}`;
    }

    const foodData = {
      name,
      price: priceNumber,
      emoji,
      image_url: imageUrl,
      category,
      description,
      ingredients,
      allergens,
      weight,
      restaurant_id: currentRestaurantId
    };

    const editing =
      editingFoodId !== null;

    const url = editing
      ? `${SUPABASE_URL}/rest/v1/menu?id=eq.${Number(editingFoodId)}&restaurant_id=eq.${currentRestaurantId}`
      : `${SUPABASE_URL}/rest/v1/menu`;

    const response = await authorizedFetch(
      url,
      {
        method: editing
          ? "PATCH"
          : "POST",
        headers: getHeaders({
          Prefer: "return=minimal"
        }),
        body: JSON.stringify(foodData)
      }
    );

    if (!response.ok) {
      throw new Error(
        await response.text()
      );
    }

    resetFoodForm();
    await loadFoods();
  } catch (error) {
    console.error(error);

    showDashboardNotice(
      "Nepodařilo se uložit jídlo nebo nahrát fotografii."
    );
  }
}

function renderFoods() {
  const list =
    document.getElementById("foodList");

  if (!foods.length) {
    list.innerHTML = `
      <div class="emptyState">
        Menu je zatím prázdné. Přidej první jídlo ve formuláři výše.
      </div>
    `;

    return;
  }

  list.innerHTML = foods
    .map(food => {
      const safeImageUrl = getSafeHttpImageUrl(food.image_url);
      const photo = safeImageUrl
        ? `
          <img
            src="${escapeHtml(safeImageUrl)}"
            class="foodPhoto"
            alt="${escapeHtml(
              food.name || "Jídlo"
            )}"
          >
        `
        : `
          <div
            class="foodPhoto"
            style="
              display:grid;
              place-items:center;
              font-size:30px;
              background:#0f172a;
            "
          >
            ${escapeHtml(
              food.emoji || "🍽️"
            )}
          </div>
        `;

      return `
        <div class="foodItem">

          ${photo}

          <div class="foodInfo">

            <b>
              ${escapeHtml(
                food.emoji || "🍽️"
              )}

              ${escapeHtml(
                food.name || "Bez názvu"
              )}
            </b>

            <div class="foodPrice">
              ${escapeHtml(
                food.price || 0
              )}
              Kč
            </div>

            <small>
              ${escapeHtml(
                food.category ||
                "Bez kategorie"
              )}
            </small>

          </div>

          <div class="foodActions">

            <button
              class="editBtn"
              type="button"
              title="Upravit jídlo"
              onclick="editFood(
                ${Number(food.id)}
              )"
            >
              ✏️
            </button>

            <button
              class="deleteBtn"
              type="button"
              title="Smazat jídlo"
              onclick="deleteFood(
                ${Number(food.id)}
              )"
            >
              🗑️
            </button>

          </div>

        </div>
      `;
    })
    .join("");
}

function editFood(id) {
  const food = foods.find(
    item => Number(item.id) === Number(id)
  );

  if (!food) {
    return;
  }

  editingFoodId = food.id;
  editingImageUrl =
    food.image_url || "";

  document.getElementById(
    "foodName"
  ).value = food.name || "";

  document.getElementById(
    "foodPrice"
  ).value = food.price || "";

  document.getElementById(
    "foodEmoji"
  ).value = food.emoji || "";

  document.getElementById(
    "foodCategory"
  ).value =
    food.category || "Pizza";

  document.getElementById(
    "foodDescription"
  ).value = food.description || "";

  document.getElementById(
    "foodIngredients"
  ).value = food.ingredients || "";

  document.getElementById(
    "foodAllergens"
  ).value = food.allergens || "";

  document.getElementById(
    "foodWeight"
  ).value = food.weight || "";

  document.getElementById(
    "foodBtn"
  ).textContent = "Uložit změny";

  document.getElementById(
    "cancelEditBtn"
  ).style.display = "inline-block";

  document.getElementById(
    "foodName"
  ).scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

function resetFoodForm() {
  editingFoodId = null;
  editingImageUrl = "";

  [
    "foodName",
    "foodPrice",
    "foodEmoji",
    "foodDescription",
    "foodIngredients",
    "foodAllergens",
    "foodWeight"
  ].forEach(id => {
    document.getElementById(id).value = "";
  });

  document.getElementById(
    "foodImage"
  ).value = "";

  document.getElementById(
    "foodBtn"
  ).textContent = "Přidat jídlo";

  document.getElementById(
    "cancelEditBtn"
  ).style.display = "none";
}

async function deleteFood(id) {
  if (!confirm("Opravdu smazat jídlo?")) {
    return;
  }

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/menu?id=eq.${Number(id)}&restaurant_id=eq.${currentRestaurantId}`,
      {
        method: "DELETE",
        headers: getHeaders()
      }
    );

    if (!response.ok) {
      throw new Error(
        await response.text()
      );
    }

    if (
      Number(editingFoodId) === Number(id)
    ) {
      resetFoodForm();
    }

    await loadFoods();
  } catch (error) {
    console.error(error);

    showDashboardNotice(
      "Nepodařilo se smazat jídlo."
    );
  }
}
function createCalendarTimeline(eventsHtml = "") {
  const hours = [];

  for (let hour = 10; hour <= 22; hour++) {
    const time = `${String(hour).padStart(2, "0")}:00`;

    hours.push(`
      <div class="calendarHour">
        <span>${time}</span>
        <div class="calendarLine"></div>
      </div>
    `);
  }

  return `
    <div class="calendarTimeline">
      ${hours.join("")}
      <div class="calendarEventsLayer">
        ${eventsHtml}
      </div>

      <div class="calendar-current-time" id="calendarCurrentTime" hidden>
        <span class="calendar-current-time-label"></span>
        <span class="calendar-current-time-dot"></span>
        <span class="calendar-current-time-line"></span>
      </div>
    </div>
  `;
}

let calendarCurrentTimeTimer = null;

function updateCalendarCurrentTime() {
  const indicator = document.getElementById("calendarCurrentTime");
  const dateInput = document.getElementById("calendarDate");

  if (!indicator || !dateInput) return;

  const now = new Date();
  const selectedDate = dateInput.value || getLocalDateString();
  const currentDate = getLocalDateString();
  const totalMinutes = ((now.getHours() - 10) * 60) + now.getMinutes();

  if (selectedDate !== currentDate || totalMinutes < 0 || totalMinutes > 780) {
    indicator.hidden = true;
    return;
  }

  indicator.hidden = false;
  indicator.style.top = `${10 + totalMinutes}px`;

  const label = indicator.querySelector(".calendar-current-time-label");
  if (label) {
    label.textContent = now.toLocaleTimeString("cs-CZ", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
}

function startCalendarCurrentTimeTimer() {
  if (calendarCurrentTimeTimer) {
    clearInterval(calendarCurrentTimeTimer);
  }

  updateCalendarCurrentTime();
  calendarCurrentTimeTimer = setInterval(updateCalendarCurrentTime, 30000);
}

function getCalendarStartMinutes(reservation) {
  const [hours, minutes] = String(reservation.time || "10:00")
    .split(":")
    .map(Number);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return Math.max(0, ((hours - 10) * 60) + minutes);
}

function buildCalendarLayout(dayReservations) {
  const events = dayReservations
    .map(reservation => {
      const start = getCalendarStartMinutes(reservation);
      const duration = Math.max(30, Number(reservation.duration_minutes || 120));

      return {
        reservation,
        start,
        duration,
        end: start + duration,
        column: 0,
        columnCount: 1
      };
    })
    .sort((a, b) => a.start - b.start || b.duration - a.duration);

  let clusterStart = 0;

  while (clusterStart < events.length) {
    let clusterEnd = clusterStart + 1;
    let latestEnd = events[clusterStart].end;

    while (clusterEnd < events.length && events[clusterEnd].start < latestEnd) {
      latestEnd = Math.max(latestEnd, events[clusterEnd].end);
      clusterEnd += 1;
    }

    const cluster = events.slice(clusterStart, clusterEnd);
    const columnEnds = [];

    cluster.forEach(event => {
      let column = columnEnds.findIndex(end => end <= event.start);

      if (column === -1) {
        column = columnEnds.length;
      }

      event.column = column;
      columnEnds[column] = event.end;
    });

    const columnCount = Math.max(1, columnEnds.length);
    cluster.forEach(event => {
      event.columnCount = columnCount;
    });

    clusterStart = clusterEnd;
  }

  return events;
}

function openReservationFromCalendar(date, time) {
  const reservationSection = document.getElementById("novaRezervace");
  const tableSelect = document.getElementById("newTable");
  const dateInput = document.getElementById("newDate");
  const timeInput = document.getElementById("newTime");

  if (!reservationSection || !tableSelect || !dateInput || !timeInput) {
    showDashboardNotice("Formulář nové rezervace se nepodařilo otevřít.");
    return;
  }

  showDashboardSection("rezervace");

  fillNewTableOptions("auto");
  setupAutomaticTableRecommendation();

  dateInput.value = date;
  timeInput.value = time;
  updateNewTableRecommendation();
  reservationSection.style.display = "block";

  requestAnimationFrame(() => {
    reservationSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    document.getElementById("newName")?.focus();
  });
}

function attachCalendarClickHandler() {
  const timeline = document.querySelector("#calendarReservations .calendarTimeline");
  const eventsLayer = timeline?.querySelector(".calendarEventsLayer");
  const dateInput = document.getElementById("calendarDate");

  if (!timeline || !eventsLayer || !dateInput) return;

  timeline.addEventListener("click", event => {
    if (event.target.closest(".calendar-reservation")) return;

    const rect = eventsLayer.getBoundingClientRect();
    const clickedY = event.clientY - rect.top;

    if (clickedY < 0 || clickedY > 780) return;

    const roundedMinutes = Math.max(
      0,
      Math.min(720, Math.round(clickedY / 30) * 30)
    );

    const totalMinutes = (10 * 60) + roundedMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    const date = dateInput.value || getLocalDateString();

    openReservationFromCalendar(date, time);
  });
}


let calendarDragJustFinished = false;

function handleCalendarReservationClick(event, reservationId) {
  if (calendarDragJustFinished) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  editReservation(reservationId);
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function attachCalendarDragHandlers() {
  const timeline = document.querySelector("#calendarReservations .calendarTimeline");
  const cards = timeline?.querySelectorAll(".calendar-reservation");

  if (!timeline || !cards?.length) return;

  cards.forEach(card => {
    card.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;

      const originalTop = Number.parseFloat(card.style.top) || 0;
      const duration = Number(card.dataset.duration || 120);
      const startY = event.clientY;
      let moved = false;
      let previewTop = originalTop;

      card.setPointerCapture(event.pointerId);
      card.classList.add("is-dragging");

      const onPointerMove = moveEvent => {
        const deltaY = moveEvent.clientY - startY;

        if (Math.abs(deltaY) >= 5) moved = true;
        if (!moved) return;

        const maxTop = Math.max(0, 780 - duration);
        previewTop = Math.max(0, Math.min(maxTop, originalTop + deltaY));
        card.style.top = `${previewTop}px`;

        const snappedMinutes = Math.round(previewTop / 30) * 30;
        card.querySelector(".calendar-time")?.replaceChildren(
          document.createTextNode(minutesToTime((10 * 60) + snappedMinutes))
        );
      };

      const finishDrag = async upEvent => {
        card.removeEventListener("pointermove", onPointerMove);
        card.removeEventListener("pointerup", finishDrag);
        card.removeEventListener("pointercancel", cancelDrag);
        card.classList.remove("is-dragging");

        if (!moved) return;

        calendarDragJustFinished = true;
        setTimeout(() => {
          calendarDragJustFinished = false;
        }, 300);

        upEvent.preventDefault();
        upEvent.stopPropagation();

        const snappedMinutes = Math.max(
          0,
          Math.min(780 - duration, Math.round(previewTop / 30) * 30)
        );
        const newTime = minutesToTime((10 * 60) + snappedMinutes);
        const reservationId = card.dataset.reservationId;

        try {
          await fetchReservationsSnapshot();
        } catch (error) {
          console.error(
            "Čerstvý stav rezervací se nepodařilo načíst:",
            error
          );

          showDashboardNotice(
            "Rezervaci teď nelze bezpečně přesunout. Obnov stránku a zkus to znovu."
          );

          renderCalendar();
          return;
        }

        const draggedReservation = reservations.find(
          item => Number(item.id) === Number(reservationId)
        );

        if (!draggedReservation) {
          showDashboardNotice("Rezervace nebyla nalezena.");
          renderCalendar();
          return;
        }

        const proposedReservation = {
          ...draggedReservation,
          time: newTime
        };

        if (
          (proposedReservation.status || "Čeká") !== "Zrušeno"
        ) {
          const openingAvailability =
            await checkDashboardOpeningAvailability({
              date: proposedReservation.date,
              time: newTime,
              durationMinutes:
                Number(
                  proposedReservation.duration_minutes || 120
                )
            });

          if (!openingAvailability.ok) {
            showDashboardNotice(
              openingAvailability.message
            );
            renderCalendar();
            return;
          }
        }

        if (
          proposedReservation.table_id !== null &&
          proposedReservation.table_id !== undefined &&
          (proposedReservation.status || "Čeká") !== "Zrušeno" &&
          hasTableConflict(
            proposedReservation.table_id,
            proposedReservation,
            proposedReservation.id
          )
        ) {
          showDashboardNotice(
            `${getTableName(proposedReservation.table_id)} je v čase ${newTime} obsazený.\n\n` +
            "Rezervace nebyla přesunuta."
          );
          renderCalendar();
          return;
        }

        if (
          proposedReservation.table_group_id !== null &&
          proposedReservation.table_group_id !== undefined &&
          (proposedReservation.status || "Čeká") !== "Zrušeno" &&
          hasTableGroupConflict(
            proposedReservation.table_group_id,
            proposedReservation,
            proposedReservation.id
          )
        ) {
          showDashboardNotice(
            `${getReservationTableLabel(proposedReservation)} jsou v čase ${newTime} obsazené.\n\n` +
            "Rezervace nebyla přesunuta."
          );
          renderCalendar();
          return;
        }

        card.style.top = `${snappedMinutes}px`;
        card.classList.add("is-saving");

        const saved = await updateReservation(reservationId, { time: newTime });
        card.classList.remove("is-saving");

        if (saved) {
          renderCalendar();
        } else {
          card.style.top = `${originalTop}px`;
          renderCalendar();
        }
      };

      const cancelDrag = () => {
        card.removeEventListener("pointermove", onPointerMove);
        card.removeEventListener("pointerup", finishDrag);
        card.removeEventListener("pointercancel", cancelDrag);
        card.classList.remove("is-dragging");
        card.style.top = `${originalTop}px`;
      };

      card.addEventListener("pointermove", onPointerMove);
      card.addEventListener("pointerup", finishDrag);
      card.addEventListener("pointercancel", cancelDrag);
    });
  });
}

function renderCalendar() {
  const container = document.getElementById("calendarReservations");
  if (!container) return;

  const selectedDate =
    document.getElementById("calendarDate")?.value || getLocalDateString();

  const dayReservations = reservations.filter(
    reservation => reservation.date === selectedDate
  );

  if (dayReservations.length === 0) {
    container.innerHTML = createCalendarTimeline();
    attachCalendarClickHandler();
    attachCalendarDragHandlers();
    startCalendarCurrentTimeTimer();
    return;
  }

  const eventsHtml = buildCalendarLayout(dayReservations)
    .map(event => {
      const r = event.reservation;
      const widthPercent = 100 / Math.max(1, Number(event.columnCount) || 1);
      const leftPercent = (Number(event.column) || 0) * widthPercent;
      const height = Math.max(30, (Number(event.duration) || 0) - 2);
      const startPosition = Math.max(0, Number(event.start) || 0);
      const reservationId = Number(r.id);
      const guestName =
        getReservationGuestName(r) === "-"
          ? "Bez jména"
          : getReservationGuestName(r);
      const statusClass = getCalendarStatusClass(r.status);
      const statusLabel = getCalendarStatusLabel(r.status);
      const tableName = r.table_name
        ? ` • 🪑 ${escapeHtml(r.table_name)}`
        : "";

      return `
        <button
          type="button"
          class="calendar-reservation ${statusClass}"
          style="top:${startPosition}px;height:${height}px;left:calc(${leftPercent}% + 3px);width:calc(${widthPercent}% - 6px);"
          data-reservation-id="${reservationId}"
          data-duration="${Math.max(0, Number(event.duration) || 0)}"
          onclick="handleCalendarReservationClick(event, '${reservationId}')"
          aria-label="Upravit rezervaci ${escapeHtml(guestName)}" 
        >
          <span class="calendar-time">${escapeHtml(r.time || "")}</span>

          <span class="calendar-info">
            <strong>${escapeHtml(guestName)}</strong>
            <small>👥 ${escapeHtml(r.people || 0)} osob${tableName}</small>
          </span>

          <span class="calendar-status ${statusClass}">${escapeHtml(statusLabel)}</span>
        </button>
      `;
    })
    .join("");

  container.innerHTML = createCalendarTimeline(eventsHtml);
  attachCalendarClickHandler();
  attachCalendarDragHandlers();
  startCalendarCurrentTimeTimer();
}

const calendarDateInput =
    document.getElementById("calendarDate");

if (calendarDateInput && !calendarDateInput.value) {
    calendarDateInput.value = getLocalDateString();
}

calendarDateInput?.addEventListener(
    "change",
    renderCalendar
);
function changeCalendarDay(days) {
    const input = document.getElementById("calendarDate");

    if (!input) return;

    const currentValue =
        input.value || getLocalDateString();

    const date = new Date(`${currentValue}T12:00:00`);

    date.setDate(date.getDate() + days);

    input.value = date.toISOString().split("T")[0];

    renderCalendar();
}
function getCalendarStatusClass(status) {
    const normalizedStatus =
        String(status || "").toLowerCase();

    if (
        normalizedStatus === "potvrzeno" ||
        normalizedStatus === "confirmed"
    ) {
        return "confirmed";
    }

    if (
        normalizedStatus === "zrušeno" ||
        normalizedStatus === "zruseno" ||
        normalizedStatus === "cancelled" ||
        normalizedStatus === "canceled"
    ) {
        return "cancelled";
    }

    return "pending";
}

function getCalendarStatusLabel(status) {
    const normalizedStatus =
        String(status || "").toLowerCase();

    if (
        normalizedStatus === "potvrzeno" ||
        normalizedStatus === "confirmed"
    ) {
        return "Potvrzeno";
    }

    if (
        normalizedStatus === "zrušeno" ||
        normalizedStatus === "zruseno" ||
        normalizedStatus === "cancelled" ||
        normalizedStatus === "canceled"
    ) {
        return "Zrušeno";
    }

    return "Čeká";
}

/* =========================================================
   TÝM / ROLE
========================================================= */

const ROLE_LABELS = {
  owner: "Majitel",
  manager: "Manažer",
  staff: "Obsluha"
};

const ROLE_ALLOWED_SECTIONS = {
  owner: new Set(["prehled", "grafy", "ai", "rezervace", "historie", "customers", "team", "kalendar", "stoly", "mapa", "provoz", "reservationSettings", "restaurace", "menu"]),
  manager: new Set(["prehled", "grafy", "rezervace", "historie", "customers", "kalendar", "stoly", "mapa", "provoz", "reservationSettings", "menu"]),
  staff: new Set(["prehled", "rezervace", "customers", "kalendar", "stoly", "mapa"])
};

function roleLabel(role) {
  return ROLE_LABELS[String(role || "").toLowerCase()] || "Neznámá role";
}

function canAccessSection(sectionId) {
  const allowed =
    ROLE_ALLOWED_SECTIONS[
      currentUserRole
    ] ||
    ROLE_ALLOWED_SECTIONS.staff;

  if (
    sectionId === "ai"
  ) {
    return (
      currentUserRole ===
        "owner" &&
      currentDashboardAiEnabled ===
        true &&
      allowed.has(
        sectionId
      )
    );
  }

  return allowed.has(
    sectionId
  );
}

function applyRolePermissions() {
  document.querySelectorAll('.sidebar nav a[data-section]').forEach(link => {
    const section = link.dataset.section;
    link.hidden = !canAccessSection(section);
  });

  const dashboardAiAvailable =
    currentUserRole ===
      "owner" &&
    currentDashboardAiEnabled ===
      true;

  document
    .querySelectorAll(
      "[data-dashboard-ai]"
    )
    .forEach(element => {
      element.hidden =
        !dashboardAiAvailable;

      if (
        element.id ===
          "ai" &&
        !dashboardAiAvailable
      ) {
        element.style.display =
          "none";
      }
    });

  const badge = document.getElementById('currentUserRoleBadge');
  if (badge) badge.textContent = roleLabel(currentUserRole);

  // Tým smí spravovat pouze majitel. Zobrazení samotné sekce ale vždy
  // řídí showDashboardSection(), aby po změně role nezůstával starý stav.
  const teamSection = document.getElementById('team');
  if (teamSection && currentUserRole !== 'owner') teamSection.style.display = 'none';
}

function getCurrentUserEmail() {
  return String(parseJwt(getAccessToken())?.email || '').trim().toLowerCase();
}

function renderTeamMembers() {
  const list = document.getElementById('teamMemberList');
  const count = document.getElementById('teamMemberCount');
  if (!list) return;

  if (count) count.textContent = String(teamMembers.filter(member => member.active !== false).length);

  if (!teamMembers.length) {
    list.innerHTML = `<div class="history-empty">Zatím tu není žádný člen týmu.</div>`;
    return;
  }

  list.innerHTML = teamMembers.map(member => {
    const isCurrent = member.user_id && member.user_id === currentUserId;
    const isOwner = member.role === 'owner';
    const status = member.active === false ? 'Neaktivní' : (member.user_id ? 'Aktivní' : 'Pozván');
    const statusClass = member.active === false ? 'inactive' : (member.user_id ? 'active' : 'pending');
    const safeId = Number(member.id);

    return `
      <article class="team-member-card ${member.active === false ? 'is-inactive' : ''}">
        <div class="team-member-main">
          <div class="team-avatar">${escapeHtml((member.full_name || member.email || '?').trim().charAt(0).toUpperCase())}</div>
          <div>
            <div class="team-name-line">
              <h3>${escapeHtml(member.full_name || member.email || 'Člen týmu')}</h3>
              ${isCurrent ? '<span class="team-you-badge">Ty</span>' : ''}
            </div>
            <div class="team-email">${escapeHtml(member.email || '')}</div>
          </div>
        </div>

        <div class="team-controls">
          <span class="team-status team-status--${statusClass}">${status}</span>
          <select aria-label="Role zaměstnance" onchange="updateTeamMemberRole(${safeId}, this.value)" ${isOwner || isCurrent ? 'disabled' : ''}>
            <option value="manager" ${member.role === 'manager' ? 'selected' : ''}>Manažer</option>
            <option value="staff" ${member.role === 'staff' ? 'selected' : ''}>Obsluha</option>
            ${isOwner ? '<option value="owner" selected>Majitel</option>' : ''}
          </select>
          ${!isOwner && !isCurrent ? `
            <button type="button" class="${member.active === false ? 'successButton' : 'dangerButton'} team-action-button" onclick="toggleTeamMemberActive(${safeId}, ${member.active === false ? 'true' : 'false'})">
              ${member.active === false ? 'Aktivovat' : 'Deaktivovat'}
            </button>
          ` : ''}
        </div>
      </article>
    `;
  }).join('');
}

async function loadTeamMembers() {
  if (!currentRestaurantId || currentUserRole !== 'owner') {
    teamMembers = [];
    renderTeamMembers();
    return;
  }

  const list = document.getElementById('teamMemberList');
  if (list) list.innerHTML = `<div class="history-empty">Načítám tým…</div>`;

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/restaurant_team?restaurant_id=eq.${currentRestaurantId}&select=*&order=created_at.asc`,
      { headers: getHeaders() }
    );

    if (!response.ok) throw new Error(await response.text());
    teamMembers = await response.json();
    renderTeamMembers();
  } catch (error) {
    console.error('Tým se nepodařilo načíst:', error);
    teamMembers = [];
    if (list) list.innerHTML = `<div class="history-empty">Tým se teď nepodařilo načíst. Zkus stránku obnovit.</div>`;
  }
}

async function inviteTeamMember(event) {
  event?.preventDefault();
  if (currentUserRole !== 'owner') {
    showDashboardNotice('Pozvat zaměstnance může pouze majitel.');
    return;
  }

  const nameInput = document.getElementById('teamInviteName');
  const emailInput = document.getElementById('teamInviteEmail');
  const roleInput = document.getElementById('teamInviteRole');
  const button = document.getElementById('teamInviteButton');

  const fullName = nameInput?.value.trim() || '';
  const email = emailInput?.value.trim().toLowerCase() || '';
  const role = roleInput?.value || 'staff';

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    showDashboardNotice('Zadej platný e-mail zaměstnance.');
    return;
  }

  if (!['manager', 'staff'].includes(role)) {
    showDashboardNotice('Vyber platnou roli.');
    return;
  }

  if (email === getCurrentUserEmail()) {
    showDashboardNotice('Tento e-mail patří aktuálně přihlášenému majiteli.');
    return;
  }

  button.disabled = true;
  const oldText = button.textContent;
  button.textContent = 'Odesílám pozvánku…';

  try {
    const response = await fetch('/api/invite-team-member', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAccessToken()}`
      },
      body: JSON.stringify({ full_name: fullName, email, role })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Pozvánku se nepodařilo odeslat.');

    nameInput.value = '';
    emailInput.value = '';
    roleInput.value = 'staff';
    await loadTeamMembers();
    showDashboardNotice(data.message || 'Pozvánka zaměstnanci byla odeslána.', 'success');
  } catch (error) {
    console.error(error);
    const msg = String(error.message || 'Pozvánku se nepodařilo odeslat.');
    showDashboardNotice(
      msg,
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

async function updateTeamMemberRole(memberId, role) {
  if (currentUserRole !== 'owner' || !['manager', 'staff'].includes(role)) return;

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/restaurant_team?id=eq.${Number(memberId)}&restaurant_id=eq.${currentRestaurantId}`,
      {
        method: 'PATCH',
        headers: getHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ role })
      }
    );
    if (!response.ok) throw new Error(await response.text());
    await loadTeamMembers();
    showDashboardNotice('Role zaměstnance byla změněna.', 'success');
  } catch (error) {
    console.error(error);
    showDashboardNotice('Roli zaměstnance se nepodařilo změnit.');
    await loadTeamMembers();
  }
}

async function toggleTeamMemberActive(memberId, active) {
  if (currentUserRole !== 'owner') return;

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/restaurant_team?id=eq.${Number(memberId)}&restaurant_id=eq.${currentRestaurantId}`,
      {
        method: 'PATCH',
        headers: getHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({ active: Boolean(active) })
      }
    );
    if (!response.ok) throw new Error(await response.text());
    await loadTeamMembers();
    showDashboardNotice(active ? 'Zaměstnanec byl aktivován.' : 'Zaměstnanec byl deaktivován.', 'success');
  } catch (error) {
    console.error(error);
    showDashboardNotice('Stav zaměstnance se nepodařilo změnit.');
    await loadTeamMembers();
  }
}

function showDashboardSection(sectionId, options = {}) {
    const { notifyDenied = true } = options;
    const requestedSection = String(sectionId || "prehled").replace(/^#/, "");
    const sectionExists = document.getElementById(requestedSection);
    const denied = Boolean(currentUserRole) && (!sectionExists || !canAccessSection(requestedSection));
    const resolvedSection = denied ? "prehled" : (sectionExists ? requestedSection : "prehled");

    if (denied && notifyDenied) {
        showDashboardNotice("Pro tuto část nemáš oprávnění.", "info");
    }

    const sectionIds = [
        "prehled",
        "grafy",
        "ai",
        "rezervace",
        "historie",
        "customers",
        "team",
        "novaRezervace",
        "kalendar",
        "stoly",
        "mapa",
        "provoz",
        "reservationSettings",
        "restaurace",
        "menu"
    ];

    sectionIds.forEach(id => {
        const section = document.getElementById(id);
        if (!section) return;

        if (resolvedSection === "rezervace" && id === "novaRezervace") {
            section.style.display = "none";
            return;
        }

        section.style.display = id === resolvedSection ? "" : "none";
    });

    const upcomingPanel = document.getElementById("upcomingReservationsPanel");
    if (upcomingPanel) {
        upcomingPanel.style.display = resolvedSection === "prehled" ? "" : "none";
    }

    document.querySelectorAll(".sidebar nav a").forEach(link => {
        link.classList.toggle("active", link.dataset.section === resolvedSection);
    });

    const targetHash = `#${resolvedSection}`;
    if (window.location.hash !== targetHash) {
        history.replaceState(null, "", targetHash);
    }

    renderSetupChecklist();
}

document.querySelectorAll(".sidebar nav a[data-section]").forEach(link => {
    link.addEventListener("click", event => {
        event.preventDefault();
        showDashboardSection(link.dataset.section);
    });
});

// Pokud někdo ručně změní hash v URL (např. #team), oprávnění se
// zkontrolují okamžitě a zakázaná sekce skončí na #prehled.
window.addEventListener("hashchange", () => {
    if (!currentUserRole) return;
    showDashboardSection(window.location.hash.replace("#", "") || "prehled");
});

// Před načtením role zobrazíme bezpečně Přehled. Po přihlášení a načtení
// role loadDashboardData() zpracuje skutečně požadovaný hash.
showDashboardSection("prehled", { notifyDenied: false });
let draggedTable = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let tableWasDragged = false;
let dragStartX = 0;
let dragStartY = 0;

const TABLE_DRAG_THRESHOLD = 6;

document.addEventListener("mousedown", event => {
  const tableElement = event.target.closest(".table");

  if (!tableElement) return;

  const floorMap = tableElement.closest(".floor-map");
  if (!floorMap) return;

  // Při spojování stolů nechceme vůbec spouštět drag.
  // Jeden klik tak vždy slouží pouze k výběru stolu.
  if (mergeModeActive) {
    return;
  }

  draggedTable = tableElement;
  tableWasDragged = false;

  dragStartX = event.clientX;
  dragStartY = event.clientY;

  const tableRect = tableElement.getBoundingClientRect();

  dragOffsetX = event.clientX - tableRect.left;
  dragOffsetY = event.clientY - tableRect.top;

  event.preventDefault();
});

document.addEventListener("mousemove", event => {
  if (!draggedTable) return;

  const floorMap = draggedTable.closest(".floor-map");
  if (!floorMap) return;

  const movedX = Math.abs(event.clientX - dragStartX);
  const movedY = Math.abs(event.clientY - dragStartY);

  // Malý pohyb myši je pořád normální kliknutí.
  if (
    !tableWasDragged &&
    movedX < TABLE_DRAG_THRESHOLD &&
    movedY < TABLE_DRAG_THRESHOLD
  ) {
    return;
  }

  if (!tableWasDragged) {
    tableWasDragged = true;
    draggedTable.classList.add("dragging");
  }

  const mapRect = floorMap.getBoundingClientRect();

  let x = event.clientX - mapRect.left - dragOffsetX;
  let y = event.clientY - mapRect.top - dragOffsetY;

  const maxX = floorMap.clientWidth - draggedTable.offsetWidth;
  const maxY = floorMap.clientHeight - draggedTable.offsetHeight;

  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));

  draggedTable.style.left = `${Math.round(x)}px`;
  draggedTable.style.top = `${Math.round(y)}px`;
});

document.addEventListener("mouseup", async () => {
  if (!draggedTable) return;

  const tableElement = draggedTable;
  draggedTable = null;

  tableElement.classList.remove("dragging");

  // Pokud nedošlo ke skutečnému přesunu, nic neukládáme.
  // Následný click se tak normálně zpracuje.
  if (!tableWasDragged) {
    return;
  }

  // Necháme click handler poznat, že před klikem proběhl drag.
  setTimeout(() => {
    tableWasDragged = false;
  }, 0);

  const tableId = tableElement.dataset.tableId;
  const groupId = tableElement.dataset.groupId;

  if (!tableId && !groupId) {
    return;
  }

  const x = Math.round(
    parseFloat(tableElement.style.left) || 0
  );

  const y = Math.round(
    parseFloat(tableElement.style.top) || 0
  );

  const isGroup = Boolean(groupId);
  const resource = isGroup ? "table_groups" : "restaurant_tables";
  const itemId = isGroup ? groupId : tableId;

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/${resource}?id=eq.${itemId}&restaurant_id=eq.${currentRestaurantId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ x, y })
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    if (isGroup) {
      const group = tableGroups.find(
        item => Number(item.id) === Number(groupId)
      );

      if (group) {
        group.x = x;
        group.y = y;
      }
    } else {
      const table = restaurantTables.find(
        item => Number(item.id) === Number(tableId)
      );

      if (table) {
        table.x = x;
        table.y = y;
      }
    }
  } catch (error) {
    console.error(
      isGroup
        ? "Nepodařilo se uložit pozici spojených stolů:"
        : "Nepodařilo se uložit pozici stolu:",
      error
    );

    showDashboardNotice(
      isGroup
        ? "Pozici spojených stolů se nepodařilo uložit."
        : "Pozici stolu se nepodařilo uložit."
    );

    await loadTables();
  }
});
let floorMapZoom = 1;

function updateFloorMapZoom() {
    const floorMap = document.getElementById("floorMap");
    const zoomValue = document.getElementById("zoomValue");

    if (!floorMap || !zoomValue) return;

    floorMap.style.transform = `scale(${floorMapZoom})`;
    zoomValue.textContent = `${Math.round(floorMapZoom * 100)}%`;
}

function zoomIn() {
    if (floorMapZoom >= 1.8) return;

    floorMapZoom += 0.1;
    floorMapZoom = Math.round(floorMapZoom * 10) / 10;

    updateFloorMapZoom();
}

function zoomOut() {
    if (floorMapZoom <= 0.5) return;

    floorMapZoom -= 0.1;
    floorMapZoom = Math.round(floorMapZoom * 10) / 10;

    updateFloorMapZoom();
}

function resetZoom() {
    floorMapZoom = 1;
    updateFloorMapZoom();
}

document.addEventListener("DOMContentLoaded", () => {
    updateFloorMapZoom();
});
document.addEventListener("click", event => {
  const floorMap = document.getElementById("floorMap");

  if (!floorMap) return;

  const clickedInsideMap = event.target.closest("#floorMap");

  if (!clickedInsideMap) return;

  const clickedTable = event.target.closest(".table");

  if (clickedTable) return;

  const mapRect = floorMap.getBoundingClientRect();

  pendingTableX =
    (event.clientX - mapRect.left) / floorMapZoom;

  pendingTableY =
    (event.clientY - mapRect.top) / floorMapZoom;

  const modal =
    document.getElementById("quickTableModal");

  const nameInput =
    document.getElementById("quickTableName");

  const capacityInput =
    document.getElementById("quickTableCapacity");

  if (!modal || !nameInput || !capacityInput) {
    return;
  }

  nameInput.value = "";
  capacityInput.value = "2";

  modal.style.display = "flex";

  setTimeout(() => {
    nameInput.focus();
  }, 50);
});
function closeQuickTableModal() {
  const modal =
    document.getElementById("quickTableModal");

  const nameInput =
    document.getElementById("quickTableName");

  const capacityInput =
    document.getElementById("quickTableCapacity");

  if (modal) {
    modal.style.display = "none";
  }

  if (nameInput) {
    nameInput.value = "";
  }

  if (capacityInput) {
    capacityInput.value = "2";
  }

  pendingTableX = null;
  pendingTableY = null;
}

async function createTableFromMap() {
  const nameInput =
    document.getElementById("quickTableName");

  const capacityInput =
    document.getElementById("quickTableCapacity");
  
const roomInput =
  document.getElementById("quickTableRoom");
  const addButton =
    document.querySelector(
      "#quickTableModal .primary-button"
    );

  if (!nameInput || !capacityInput || !roomInput) {
  return;
}

  const name = nameInput.value.trim();
  const capacity = Number(capacityInput.value);
  const room = roomInput.value;
  if (name.length < 2) {
    showDashboardNotice("Zadej název stolu.");
    nameInput.focus();
    return;
  }

  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 30
  ) {
    showDashboardNotice("Počet míst musí být od 1 do 30.");
    capacityInput.focus();
    return;
  }

  if (
    pendingTableX === null ||
    pendingTableY === null
  ) {
    showDashboardNotice("Nejdříve klikni do mapy.");
    closeQuickTableModal();
    return;
  }

  const duplicate = restaurantTables.some(table => {
    return (
      String(table.name || "")
        .trim()
        .toLowerCase() === name.toLowerCase()
    );
  });

  if (duplicate) {
    showDashboardNotice("Stůl s tímto názvem už existuje.");
    nameInput.focus();
    return;
  }

  const x = Math.max(
    0,
    Math.round(pendingTableX - 45)
  );

  const y = Math.max(
    0,
    Math.round(pendingTableY - 45)
  );

  try {
    if (addButton) {
      addButton.disabled = true;
      addButton.textContent = "Ukládám...";
    }

    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/restaurant_tables`,
      {
        method: "POST",

        headers: getHeaders({
          Prefer: "return=minimal"
        }),

        body: JSON.stringify({
          restaurant_id: currentRestaurantId,
          name,
          capacity,
          room,
          note: "",
          active: true,
          x,
          y
        })
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    closeQuickTableModal();

    await loadTables();

    renderReservations(
      getFilteredReservations()
    );
  } catch (error) {
    console.error(
      "Nepodařilo se vytvořit stůl:",
      error
    );

    showDashboardNotice("Stůl se nepodařilo přidat.");
  } finally {
    if (addButton) {
      addButton.disabled = false;
      addButton.textContent = "Přidat stůl";
    }
  }
}


// Automatické doporučení stolu v nové rezervaci.
document.addEventListener("DOMContentLoaded", () => {
  fillNewTableOptions("auto");
  setupAutomaticTableRecommendation();
  updateNewTableRecommendation();
});


/* =========================================================
   PROVOZNÍ DOBA A BLOKOVANÉ ČASY
========================================================= */
const DAY_NAMES = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];
let openingHours = [];
let blockedTimes = [];

async function loadOpeningHours() {
  if (!currentRestaurantId) return;
  try {
    const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/opening_hours?restaurant_id=eq.${currentRestaurantId}&select=*&order=day_of_week.asc`, { headers: getHeaders() });
    if (!response.ok) throw new Error(await response.text());
    openingHours = await response.json();
    openingHoursConfigured =
      Array.isArray(openingHours) &&
      openingHours.length > 0;

    if (!openingHours.length) {
      openingHours = DAY_NAMES.map((_, day) => ({ day_of_week: day, is_open: true, open_time: "10:00", close_time: "22:00" }));
    }
    renderOpeningHours();
  } catch (error) {
    console.error(error);
    showDashboardNotice("Provozní dobu se teď nepodařilo načíst. Zkus stránku obnovit.");
  }
}

function renderOpeningHours() {
  const container = document.getElementById("openingHoursGrid");
  if (!container) return;
  const byDay = new Map(openingHours.map(row => [Number(row.day_of_week), row]));
  container.innerHTML = DAY_NAMES.map((name, day) => {
    const row = byDay.get(day) || { is_open: true, open_time: "10:00", close_time: "22:00" };
    return `<div class="opening-day" data-day="${day}">
      <strong>${name}</strong>
      <label><input class="day-open" type="checkbox" ${row.is_open ? "checked" : ""}> Otevřeno</label>
      <input class="day-from" type="time" value="${escapeHtml(String(row.open_time || "").slice(0,5))}">
      <span>–</span>
      <input class="day-to" type="time" value="${escapeHtml(String(row.close_time || "").slice(0,5))}">
    </div>`;
  }).join("");
}

async function saveOpeningHours() {
  const rows = [...document.querySelectorAll(".opening-day")].map(element => ({
    restaurant_id: currentRestaurantId,
    day_of_week: Number(element.dataset.day),
    is_open: element.querySelector(".day-open").checked,
    open_time: element.querySelector(".day-from").value,
    close_time: element.querySelector(".day-to").value
  }));

  if (rows.some(row => row.is_open && (!row.open_time || !row.close_time || row.close_time <= row.open_time))) {
    showDashboardNotice("U otevřených dnů musí být konec později než začátek.");
    return;
  }

  try {
    const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/opening_hours?on_conflict=restaurant_id,day_of_week`, {
      method: "POST",
      headers: getHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(rows)
    });
    if (!response.ok) throw new Error(await response.text());
    openingHours = await response.json();
    openingHoursConfigured = true;
    renderOpeningHours();
    renderSetupChecklist();
    showDashboardNotice("Otevírací doba byla uložena.", "success");
  } catch (error) {
    console.error(error);
    showDashboardNotice("Otevírací dobu se nepodařilo uložit.");
  }
}

async function loadBlockedTimes() {
  if (!currentRestaurantId) return;
  try {
    const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/blocked_times?restaurant_id=eq.${currentRestaurantId}&select=*&order=date.asc,start_time.asc`, { headers: getHeaders() });
    if (!response.ok) throw new Error(await response.text());
    blockedTimes = await response.json();
    renderBlockedTimes();
  } catch (error) {
    console.error(error);
  }
}

function renderBlockedTimes() {
  const container = document.getElementById("blockedTimesList");
  if (!container) return;
  if (!blockedTimes.length) {
    container.innerHTML = '<p class="empty-state">Žádné blokované časy.</p>';
    return;
  }
  container.innerHTML = blockedTimes.map(block => `<div class="blocked-time-item">
    <div><strong>${escapeHtml(String(block.date || ""))}</strong> · ${escapeHtml(String(block.start_time || "").slice(0,5))}–${escapeHtml(String(block.end_time || "").slice(0,5))}<br><span>${escapeHtml(block.reason || "Bez důvodu")}</span></div>
    <button type="button" class="dangerButton" onclick="deleteBlockedTime(${Number(block.id)})">Smazat</button>
  </div>`).join("");
}

async function addBlockedTime() {
  const date = document.getElementById("blockDate").value;
  const start_time = document.getElementById("blockStart").value;
  const end_time = document.getElementById("blockEnd").value;
  const reason = document.getElementById("blockReason").value.trim();
  if (!date || !start_time || !end_time || end_time <= start_time) {
    showDashboardNotice("Vyplň datum a platný čas blokace.");
    return;
  }

  if (reason.length > 300) {
    showDashboardNotice("Důvod blokace může mít maximálně 300 znaků.");
    return;
  }

  try {
    const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/blocked_times`, {
      method: "POST",
      headers: getHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({ restaurant_id: currentRestaurantId, date, start_time, end_time, reason })
    });
    if (!response.ok) throw new Error(await response.text());
    document.getElementById("blockReason").value = "";
    await loadBlockedTimes();
    showDashboardNotice("Čas byl zablokován.", "success");
  } catch (error) {
    console.error(error);
    showDashboardNotice("Blokaci se nepodařilo uložit.");
  }
}

async function deleteBlockedTime(id) {
  try {
    const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/blocked_times?id=eq.${Number(id)}&restaurant_id=eq.${currentRestaurantId}`, { method: "DELETE", headers: getHeaders() });
    if (!response.ok) throw new Error(await response.text());
    await loadBlockedTimes();
    showDashboardNotice("Blokace byla odstraněna.", "success");
  } catch (error) {
    console.error(error);
    showDashboardNotice("Blokaci se nepodařilo odstranit.");
  }
}

async function checkDashboardOpeningAvailability({ date, time, durationMinutes }) {
  const day = new Date(`${date}T12:00:00`).getDay();
  const hours = openingHours.find(row => Number(row.day_of_week) === day) || { is_open: true, open_time: "10:00", close_time: "22:00" };
  if (!hours.is_open) return { ok: false, message: "V tento den má restaurace zavřeno." };
  const start = timeToMinutes(time);
  const end = start + Number(durationMinutes || 120);
  if (start < timeToMinutes(hours.open_time) || end > timeToMinutes(hours.close_time)) {
    return { ok: false, message: `Rezervace musí celá proběhnout mezi ${String(hours.open_time).slice(0,5)} a ${String(hours.close_time).slice(0,5)}.` };
  }
  const block = blockedTimes.find(item => item.date === date && start < timeToMinutes(item.end_time) && timeToMinutes(item.start_time) < end);
  if (block) {
    const reservationEnd = `${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
    const blockStart = String(block.start_time).slice(0, 5);
    const blockEnd = String(block.end_time).slice(0, 5);
    return {
      ok: false,
      message: block.reason
        ? `Rezervace by končila v ${reservationEnd} a zasahovala do blokace ${blockStart}–${blockEnd}: ${block.reason}`
        : `Rezervace by končila v ${reservationEnd} a zasahovala do blokovaného času ${blockStart}–${blockEnd}.`
    };
  }
  return { ok: true };
}


/* =========================================================
   NASTAVENÍ REZERVACÍ PRO KAŽDOU RESTAURACI
========================================================= */
const DEFAULT_RESERVATION_SETTINGS = {
  duration_1_2: 90,
  duration_3_4: 120,
  duration_5_6: 150,
  duration_7_plus: 180,
  min_advance_minutes: 60,
  max_advance_days: 30,
  min_people: 1,
  max_people: 20
};

let reservationSettings = { ...DEFAULT_RESERVATION_SETTINGS };

function normalizeReservationSettings(row = {}) {
  return {
    duration_1_2: Math.max(30, Number(row.duration_1_2 || DEFAULT_RESERVATION_SETTINGS.duration_1_2)),
    duration_3_4: Math.max(30, Number(row.duration_3_4 || DEFAULT_RESERVATION_SETTINGS.duration_3_4)),
    duration_5_6: Math.max(30, Number(row.duration_5_6 || DEFAULT_RESERVATION_SETTINGS.duration_5_6)),
    duration_7_plus: Math.max(30, Number(row.duration_7_plus || DEFAULT_RESERVATION_SETTINGS.duration_7_plus)),
    min_advance_minutes: Math.max(0, Number(row.min_advance_minutes ?? DEFAULT_RESERVATION_SETTINGS.min_advance_minutes)),
    max_advance_days: Math.max(1, Number(row.max_advance_days || DEFAULT_RESERVATION_SETTINGS.max_advance_days)),
    min_people: Math.max(1, Number(row.min_people || DEFAULT_RESERVATION_SETTINGS.min_people)),
    max_people: Math.max(1, Number(row.max_people || DEFAULT_RESERVATION_SETTINGS.max_people))
  };
}

function renderReservationSettings() {
  const mapping = {
    settingDuration12: reservationSettings.duration_1_2,
    settingDuration34: reservationSettings.duration_3_4,
    settingDuration56: reservationSettings.duration_5_6,
    settingDuration7Plus: reservationSettings.duration_7_plus,
    settingMinAdvance: reservationSettings.min_advance_minutes,
    settingMaxAdvanceDays: reservationSettings.max_advance_days,
    settingMinPeople: reservationSettings.min_people,
    settingMaxPeople: reservationSettings.max_people
  };

  Object.entries(mapping).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) input.value = String(value);
  });

  updateReservationSettingsSummary();
}

function updateReservationSettingsSummary() {
  const summary = document.getElementById("reservationSettingsSummary");
  if (!summary) return;

  summary.innerHTML = `
    <strong>Jak to uvidí host:</strong>
    <span>Host vybere pouze počet osob, datum a dostupný čas. Délka zůstává interní a systém ji použije automaticky.</span>
  `;
}

async function loadReservationSettings() {
  if (!currentRestaurantId) return;

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/reservation_settings?restaurant_id=eq.${currentRestaurantId}&select=*`,
      { headers: getHeaders() }
    );

    if (!response.ok) throw new Error(await response.text());

    const rows = await response.json();
    reservationSettingsConfigured =
      Array.isArray(rows) &&
      Boolean(rows[0]);

    reservationSettings = normalizeReservationSettings(rows[0] || {});
    renderReservationSettings();
  } catch (error) {
    console.error("Nastavení rezervací se nepodařilo načíst:", error);
    reservationSettings = { ...DEFAULT_RESERVATION_SETTINGS };
    renderReservationSettings();
    showDashboardNotice("Nastavení rezervací se teď nepodařilo načíst. Zkus stránku obnovit.", "info");
  }
}

async function saveReservationSettings() {
  if (!currentRestaurantId) return;

  const values = {
    restaurant_id: Number(currentRestaurantId),
    duration_1_2: Number(document.getElementById("settingDuration12")?.value),
    duration_3_4: Number(document.getElementById("settingDuration34")?.value),
    duration_5_6: Number(document.getElementById("settingDuration56")?.value),
    duration_7_plus: Number(document.getElementById("settingDuration7Plus")?.value),
    min_advance_minutes: Number(document.getElementById("settingMinAdvance")?.value),
    max_advance_days: Number(document.getElementById("settingMaxAdvanceDays")?.value),
    min_people: Number(document.getElementById("settingMinPeople")?.value),
    max_people: Number(document.getElementById("settingMaxPeople")?.value)
  };

  const durations = [values.duration_1_2, values.duration_3_4, values.duration_5_6, values.duration_7_plus];
  if (durations.some(value => !Number.isFinite(value) || value < 30 || value > 360)) {
    showDashboardNotice("Délka rezervace musí být mezi 30 a 360 minutami.");
    return;
  }

  if (
    !Number.isFinite(values.min_advance_minutes) ||
    values.min_advance_minutes < 0 ||
    values.min_advance_minutes > 10080
  ) {
    showDashboardNotice(
      "Minimální čas předem musí být od 0 do 10 080 minut."
    );
    return;
  }

  if (!Number.isFinite(values.max_advance_days) || values.max_advance_days < 1 || values.max_advance_days > 365) {
    showDashboardNotice("Počet dní dopředu musí být od 1 do 365.");
    return;
  }

  if (
    !Number.isInteger(values.min_people) ||
    !Number.isInteger(values.max_people) ||
    values.min_people < 1 ||
    values.min_people > 50 ||
    values.max_people < values.min_people ||
    values.max_people > 200
  ) {
    showDashboardNotice(
      "Minimum hostů musí být 1–50 a maximum musí být alespoň minimum, nejvýše 200."
    );
    return;
  }

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/reservation_settings?on_conflict=restaurant_id`,
      {
        method: "POST",
        headers: getHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify(values)
      }
    );

    if (!response.ok) throw new Error(await response.text());

    const rows = await response.json();
    reservationSettings = normalizeReservationSettings(rows[0] || values);
    reservationSettingsConfigured = true;
    renderReservationSettings();
    renderSetupChecklist();
    showDashboardNotice("Nastavení rezervací bylo uloženo.", "success");
  } catch (error) {
    console.error(error);
    showDashboardNotice("Nastavení rezervací se nepodařilo uložit.");
  }
}

[
  "settingDuration12",
  "settingDuration34",
  "settingDuration56",
  "settingDuration7Plus",
  "settingMinAdvance",
  "settingMaxAdvanceDays",
  "settingMinPeople",
  "settingMaxPeople"
].forEach(id => {
  document.getElementById(id)?.addEventListener("input", updateReservationSettingsSummary);
});
