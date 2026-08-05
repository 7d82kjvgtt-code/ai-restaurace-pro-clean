const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY = "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

let reservations = [];
let foods = [];
let restaurantTables = [];

let currentRestaurantId = null;
let currentUserRole = null;

let editingFoodId = null;
let editingImageUrl = "";
let editingTableId = null;

let pendingTableX = null;
let pendingTableY = null;

let selectedRoom = "Hlavní sál";

let mergeModeActive = false;
let selectedTablesForMerge = [];

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

  const selectedTables = restaurantTables.filter((table) =>
    selectedTablesForMerge.includes(Number(table.id))
  );

  if (selectedTables.length < 2) {
    showDashboardNotice("Vybrané stoly se nepodařilo najít.");
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

document.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  setupMobileNavigation();
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
  const restaurantLoaded = await loadRestaurantContext();

  if (restaurantLoaded) {
    hideLogin();
    await loadDashboardData();
  } else {
    clearSession();
    showLogin();
    showDashboardNotice("Účet není přiřazený k žádné restauraci.");
  }
} else {
  showLogin();
}
});

async function loadDashboardData() {
  await Promise.all([
    loadTables(),
    loadFoods(),
    loadOpeningHours(),
    loadBlockedTimes()
  ]);

  await loadReservations();
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

function getAccessToken() {
  return sessionStorage.getItem("supabaseAccessToken");
}

function getRefreshToken() {
  return sessionStorage.getItem("supabaseRefreshToken");
}

function clearSession() {
  sessionStorage.removeItem("dashboardLoggedIn");
  sessionStorage.removeItem("supabaseAccessToken");
  sessionStorage.removeItem("supabaseRefreshToken");
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
  const token = getAccessToken();
  const payload = parseJwt(token);

  if (!payload?.sub) {
    return false;
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(payload.sub)}&select=restaurant_id,role`,
      {
        method: "GET",
        headers: getHeaders()
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const profiles = await response.json();
    const profile = profiles[0];

    if (!profile?.restaurant_id) {
      console.error("Uživatel není přiřazený k restauraci.");
      return false;
    }
    
    const userRole = String(profile.role || "").toLowerCase().trim();

if (userRole !== "owner") {
    console.error("Uživatel nemá oprávnění otevřít Dashboard.");
    showDashboardNotice("Do administrace má přístup pouze majitel restaurace.");
    return false;
}
    currentRestaurantId = profile.restaurant_id;
    currentUserRole = userRole;

    console.log("Aktivní restaurace:", currentRestaurantId);
    console.log("Role uživatele:", currentUserRole);

    return true;
  } catch (error) {
    console.error("Nepodařilo se načíst restauraci:", error);
    return false;
  }
}
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

    hideLogin();
    await loadDashboardData();
  } catch (loginError) {
    console.error(loginError);

    error.textContent =
      "Přihlášení se nepodařilo.";
  } finally {
    button.disabled = false;
  }
}

function logoutDashboard() {
  clearSession();
  location.reload();
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

/* =========================================================
   REZERVACE
========================================================= */

async function loadReservations() {
  const table =
    document.getElementById("reservationTable");

  try {
    const response = await authorizedFetch(
  `${SUPABASE_URL}/rest/v1/reservations?restaurant_id=eq.${currentRestaurantId}&select=*&order=id.desc`
);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    reservations =
      Array.isArray(data) ? data : [];

   updateStatistics();
renderReservations(reservations);
renderCalendar();
renderCharts();
renderFloorMap();
  } catch (error) {
    console.error(error);

    table.innerHTML = `
      <tr>
        <td colspan="10">
          Nepodařilo se načíst rezervace.
        </td>
      </tr>
    `;
  }
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
    table.innerHTML = `
      <tr>
        <td colspan="10">
          Žádné rezervace.
        </td>
      </tr>
    `;

    return;
  }

  table.innerHTML = data
    .map(reservation => {
      return `
        <tr>

          <td data-label="Jméno">
            ${escapeHtml(
              reservation.name || "-"
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
                reservation.status || "Čeká"
              )}"
            >
              ${escapeHtml(
                reservation.status || "Čeká"
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
                title="Potvrdit rezervaci"
                onclick="updateStatus(
                  ${Number(reservation.id)},
                  'Potvrzeno'
                )"
              >
                ✅
              </button>

              <button
                type="button"
                title="Zrušit rezervaci"
                onclick="updateStatus(
                  ${Number(reservation.id)},
                  'Zrušeno'
                )"
              >
                ❌
              </button>

              <button
                class="deleteBtn"
                type="button"
                title="Smazat rezervaci"
                onclick="deleteReservation(
                  ${Number(reservation.id)}
                )"
              >
                🗑️
              </button>

            </div>
          </td>

        </tr>
      `;
    })
    .join("");
}

async function updateStatus(id, status) {
  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
      {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({
          status
        })
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    await loadReservations();
    return true;
  } catch (error) {
    console.error(error);

    showDashboardNotice(
      "Nepodařilo se změnit stav rezervace."
    );
  }
}

async function deleteReservation(id) {
  if (!confirm("Opravdu smazat rezervaci?")) {
    return;
  }

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
      {
        method: "DELETE",
        headers: getHeaders()
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    await loadReservations();
    return true;
  } catch (error) {
    console.error(error);

    showDashboardNotice(
      "Nepodařilo se smazat rezervaci."
    );
  }
}

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
      getTableName(reservation.table_id);

    const text = [
      reservation.name,
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
        reservation.name || "";

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

    const tableSelect =
        document.getElementById("editReservationTable");

    tableSelect.innerHTML = `
        <option value="">Bez stolu</option>
        ${restaurantTables
            .filter(table => {
                return (
                    table.active ||
                    Number(table.id) === Number(reservation.table_id)
                );
            })
            .map(table => `
                <option value="${table.id}">
                    ${table.name} (${table.capacity} míst)
                </option>
            `)
            .join("")}
    `;

    tableSelect.value =
        reservation.table_id === null ||
        reservation.table_id === undefined
            ? ""
            : String(reservation.table_id);

    document
        .getElementById("reservationModal")
        .classList.add("show");
}

function closeReservationModal() {
    document
        .getElementById("reservationModal")
        .classList.remove("show");
}

async function saveReservationChanges() {
    const id = Number(
        document.getElementById("editReservationId").value
    );

    const name =
        document
            .getElementById("editReservationName")
            .value
            .trim();

    const people = Number(
        document.getElementById("editReservationPeople").value
    );

    const date =
        document.getElementById("editReservationDate").value;

    const time =
        document.getElementById("editReservationTime").value;
  
const durationMinutes = Number(
  document.getElementById("editReservationDuration").value
);
  
    const tableValue =
        document.getElementById("editReservationTable").value;

    const tableId =
        tableValue ? Number(tableValue) : null;

    const status =
        document.getElementById("editReservationStatus").value;

    const phone =
        document
            .getElementById("editReservationPhone")
            .value
            .trim();

    const email =
        document
            .getElementById("editReservationEmail")
            .value
            .trim();

    const note =
        document
            .getElementById("editReservationNote")
            .value
            .trim();

    if (
        !name ||
        !date ||
        !time ||
        !Number.isInteger(people) ||
        people < 1 ||
        people > 30
    ) {
        showDashboardNotice("Vyplň správně jméno, počet osob, datum a čas.");
        return;
    }

   const updatedReservation = {
  id,
  name,
  people,
  date,
  time,
  duration_minutes: durationMinutes,
  table_id: tableId,
  phone,
  email,
  note,
  status
};

    if (tableId !== null) {
        const selectedTable = restaurantTables.find(
            table => Number(table.id) === Number(tableId)
        );

        if (!selectedTable) {
            showDashboardNotice("Vybraný stůl nebyl nalezen.");
            return;
        }

        if (people > Number(selectedTable.capacity)) {
            showDashboardNotice(
                `${selectedTable.name} má jen ` +
                `${selectedTable.capacity} míst.`
            );
            return;
        }

        if (
            status !== "Zrušeno" &&
            hasTableConflict(tableId, updatedReservation, id)
        ) {
            showDashboardNotice(
                `${selectedTable.name} je v tomto čase obsazený.\n\n` +
                "Zvol jiný čas, délku rezervace nebo jiný stůl."
            );
            return;
        }
    }

    try {
        const response = await authorizedFetch(
            `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
            {
                method: "PATCH",
                headers: getHeaders({
                    Prefer: "return=minimal"
                }),
              body: JSON.stringify({
               name,
               people,
               date,
               time,
               duration_minutes: durationMinutes,
               table_id: tableId,
               phone,
               email,
               note,
               status
})
            }
        );

        if (!response.ok) {
            throw new Error(await response.text());
        }

       closeReservationModal();
      
closeTableModal();
      
await loadReservations();

renderTables();

showDashboardNotice("Rezervace byla úspěšně upravena.");
    } catch (error) {
        console.error(error);
        showDashboardNotice("Rezervaci se nepodařilo upravit.");
    }
}

async function updateReservation(id, data) {
  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
      {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify(data)
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    await loadReservations();
  } catch (error) {
    console.error(error);

    showDashboardNotice(
      "Nepodařilo se upravit rezervaci."
    );
    return false;
  }
}

function exportReservations() {
  const data = getFilteredReservations();

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
    "Stůl",
    "Telefon",
    "E-mail",
    "Poznámka",
    "Stav"
  ];

  const rows = data.map(reservation => [
    reservation.name || "",
    reservation.people || "",
    reservation.date || "",
    reservation.time || "",
    getTableName(reservation.table_id),
    reservation.phone || "",
    reservation.email || "",
    reservation.note || "",
    reservation.status || "Čeká"
  ]);

  const quote = value => {
    return `"${String(value).replace(
      /"/g,
      '""'
    )}"`;
  };

  const csv = [
    columns.map(quote).join(";"),
    ...rows.map(row =>
      row.map(quote).join(";")
    )
  ].join("\n");

  const blob = new Blob(
    ["\uFEFF" + csv],
    {
      type: "text/csv;charset=utf-8;"
    }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download =
    `rezervace-${getLocalDateString()}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
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
function getTableStatus(tableId) {
    const now = new Date();

    const relevantReservations = reservations.filter(reservation => {
        return (
            Number(reservation.table_id) === Number(tableId) &&
            (reservation.status || "Čeká") !== "Zrušeno"
        );
    });

    for (const reservation of relevantReservations) {
        const start = new Date(
            `${reservation.date}T${reservation.time}`
        );

        const end = new Date(start);
        end.setHours(end.getHours() + 2);

        const minutesUntilStart =
            (start.getTime() - now.getTime()) / 60000;

        if (now >= start && now <= end) {
            return "occupied";
        }

        if (
            minutesUntilStart > 0 &&
            minutesUntilStart <= 30
        ) {
            return "busy";
        }
    }

    return "free";
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
    return groupRoom === selectedRoom;
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

      const x =
        members.reduce(
          (sum, table) => sum + Number(table.x || 100),
          0
        ) / members.length;

      const y =
        members.reduce(
          (sum, table) => sum + Number(table.y || 100),
          0
        ) / members.length;

      const statuses = members.map((table) =>
        getTableStatus(table.id)
      );

      const statusClass = statuses.includes("occupied")
        ? "occupied"
        : statuses.includes("busy")
          ? "busy"
          : "free";

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
    floorMap.innerHTML = `
      <div class="emptyState">
        V místnosti <strong>${selectedRoom}</strong> zatím nejsou žádné stoly.
      </div>
    `;
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

      const clickAction = item.isGroup
  ? `onclick="openTableGroup(${item.id})"`
  : `onclick="handleTableClick(event, ${item.id})"`;
      const groupClass = item.isGroup
        ? " table-group"
        : "";

      return `
        <div
          class="table ${statusClass}${groupClass}"
          ${
            item.isGroup
              ? `data-group-id="${item.id}"`
              : `data-table-id="${item.id}"`
          }
          style="left:${item.x}px; top:${item.y}px;"
          title="${item.name || `Stůl ${item.id}`} • ${capacity} míst • ${statusLabel}"
          ${clickAction}
        >
          <span class="table-map-name">
            ${item.name || `Stůl ${item.id}`}
          </span>

          <span class="table-map-capacity">
            👥 ${capacity}
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
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/table_groups?id=eq.${groupId}&restaurant_id=eq.${currentRestaurantId}`,
      {
        method: "DELETE",
        headers: getHeaders({
          Prefer: "return=minimal"
        })
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    closeTableModal();
    await loadTables();

    showDashboardNotice("Stoly byly úspěšně rozpojeny.");
  } catch (error) {
    console.error(error);
    showDashboardNotice("Stoly se nepodařilo rozpojit.");
  }
}
function openTable(tableId) {
    const table = restaurantTables.find(
        t => Number(t.id) === Number(tableId)
    );

    if (!table) return;

    selectedTableId = tableId;

    const tableStatus = getTableStatus(tableId);

    const reservation = reservations.find(r => {
        if (Number(r.table_id) !== Number(tableId)) {
            return false;
        }

        if ((r.status || "Čeká") === "Zrušeno") {
            return false;
        }

        const start = new Date(`${r.date}T${r.time}`);
        const end = new Date(start);
        end.setHours(end.getHours() + 2);

        const now = new Date();
        const minutesUntilStart =
            (start.getTime() - now.getTime()) / 60000;

        return (
            (now >= start && now <= end) ||
            (minutesUntilStart > 0 && minutesUntilStart <= 30)
        );
    });

    selectedTableReservationId = reservation
        ? Number(reservation.id)
        : null;

    const primaryButton =
        document.getElementById("tableModalPrimaryButton");

    primaryButton.textContent = reservation
        ? "✏️ Upravit rezervaci"
        : "+ Nová rezervace";

    document.getElementById("tableModalTitle").textContent =
        table.name;

    document.getElementById("tableModalCapacity").textContent =
        table.capacity;

    document.getElementById("tableModalStatus").textContent =
        !table.active
            ? "Neaktivní"
            : tableStatus === "occupied"
                ? "Obsazený"
                : tableStatus === "busy"
                    ? "Brzy obsazený"
                    : "Volný";

    if (reservation) {
        document.getElementById("tableModalCapacity").innerHTML =
            `👤 ${reservation.name || "-"}<br>
             👥 ${reservation.people || "-"} osoby<br>
             🕒 ${reservation.time || "-"}<br>
             📞 ${reservation.phone || "-"}`;

        document.getElementById("tableModalStatus").textContent =
            reservation.status || "Čeká";
    }

    document
        .getElementById("tableModal")
        .classList.add("show");
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

function fillNewTableOptions(preferredValue = "auto") {
  const tableSelect = document.getElementById("newTable");
  if (!tableSelect) return;

  const activeTables = restaurantTables
    .filter(table => table.active)
    .sort((a, b) => Number(a.capacity) - Number(b.capacity));

  tableSelect.innerHTML = `
    <option value="auto">🪄 Automaticky vybrat nejlepší stůl</option>
    ${activeTables.map(table => `
      <option value="${Number(table.id)}">
        ${escapeHtml(table.name)} (${Number(table.capacity)} míst)
      </option>
    `).join("")}
  `;

  const optionExists = Array.from(tableSelect.options)
    .some(option => option.value === String(preferredValue));
  tableSelect.value = optionExists ? String(preferredValue) : "auto";
}

function updateNewTableRecommendation() {
  const box = document.getElementById("tableRecommendation");
  const tableSelect = document.getElementById("newTable");
  if (!box || !tableSelect) return;

  const draft = getNewReservationDraft();

  if (!draft.people || !draft.date || !draft.time) {
    box.className = "tableRecommendation";
    box.textContent =
      "Zadej počet osob, datum a čas. Systém potom doporučí nejlepší volný stůl.";
    return;
  }

  const bestTable = findBestAvailableTable(draft);

  if (!bestTable) {
    box.className = "tableRecommendation unavailable";
    box.textContent =
      `Pro ${draft.people} osob v ${draft.time} není volný vhodný stůl.`;
    return;
  }

  box.className = "tableRecommendation available";
  box.innerHTML = `
    <strong>🪄 Doporučení: ${escapeHtml(bestTable.name)}</strong>
    <span>${Number(bestTable.capacity)} míst · volný po celou dobu rezervace</span>
  `;
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
    const name = document.getElementById("newName").value.trim();
    const people = Number(document.getElementById("newPeople").value);
    const date = document.getElementById("newDate").value;
    const time = document.getElementById("newTime").value;
    const durationMinutes = Number(
        document.getElementById("newDuration")?.value || 120
    );
    const tableValue = document.getElementById("newTable").value;
    const phone = document.getElementById("newPhone").value.trim();
    const email = document.getElementById("newEmail").value.trim();
    const note = document.getElementById("newNote").value.trim();

    if (!name || !date || !time || !Number.isInteger(people) || people < 1) {
        showDashboardNotice("Vyplň jméno, počet osob, datum a čas.");
        return;
    }

    const openingAvailability = await checkDashboardOpeningAvailability({
        date,
        time,
        durationMinutes
    });

    if (!openingAvailability.ok) {
        showDashboardNotice(openingAvailability.message);
        return;
    }

    const reservationDraft = {
        people,
        date,
        time,
        duration_minutes: durationMinutes,
        status: "Čeká"
    };

    let selectedTable = null;

    if (tableValue === "auto" || tableValue === "") {
        selectedTable = findBestAvailableTable(reservationDraft);

        if (!selectedTable) {
            showDashboardNotice(
                `Pro ${people} osob v ${time} není volný vhodný stůl.

` +
                "Zvol jiný čas, kratší délku nebo vytvoř větší stůl."
            );
            return;
        }
    } else {
        selectedTable = restaurantTables.find(
            table => Number(table.id) === Number(tableValue)
        );
    }

    if (!selectedTable) {
        showDashboardNotice("Vyber platný stůl.");
        return;
    }

    const tableId = Number(selectedTable.id);

    if (people > Number(selectedTable.capacity)) {
        showDashboardNotice(
            `${selectedTable.name} má pouze ${selectedTable.capacity} míst.`
        );
        return;
    }

    const newReservation = {
        name,
        people,
        date,
        time,
        duration_minutes: durationMinutes,
        table_id: tableId,
        phone,
        email,
        note,
        status: "Čeká",
        restaurant_id: currentRestaurantId
    };

    if (hasTableConflict(tableId, newReservation)) {
        showDashboardNotice(
            `${selectedTable.name} je v tomto čase už obsazený.\n\n` +
            "Zvol jiný čas, délku rezervace nebo jiný stůl."
        );
        return;
    }

    try {
        const response = await authorizedFetch(
            `${SUPABASE_URL}/rest/v1/reservations`,
            {
                method: "POST",
                headers: getHeaders({
                    Prefer: "return=minimal"
                }),
                body: JSON.stringify(newReservation)
            }
        );

        if (!response.ok) {
            throw new Error(await response.text());
        }

        document.getElementById("novaRezervace").style.display = "none";

        [
            "newName",
            "newPeople",
            "newDate",
            "newTime",
            "newPhone",
            "newEmail",
            "newNote"
        ].forEach(id => {
            document.getElementById(id).value = "";
        });

        const newDuration = document.getElementById("newDuration");
        if (newDuration) newDuration.value = "120";

        selectedTableId = null;

        await loadReservations();

        showDashboardNotice("Rezervace byla úspěšně uložena.");
    } catch (error) {
        console.error(error);
        showDashboardNotice("Rezervaci se nepodařilo uložit.");
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
        Zatím nejsou vytvořené žádné stoly.
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

async function saveTable() {
  const name =
    document
      .getElementById("tableName")
      .value
      .trim();

  const capacity = Number(
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

  if (name.length < 2) {
    showDashboardNotice("Zadej název stolu.");
    return;
  }

  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 30
  ) {
    showDashboardNotice(
      "Kapacita musí být od 1 do 30 míst."
    );

    return;
  }

  const duplicate =
    restaurantTables.some(table => {
      return (
        table.name
          .trim()
          .toLowerCase() ===
          name.toLowerCase() &&
        Number(table.id) !==
          Number(editingTableId)
      );
    });

  if (duplicate) {
    showDashboardNotice(
      "Stůl s tímto názvem už existuje."
    );

    return;
  }

  try {
    const editing =
      editingTableId !== null;

    const url = editing
      ? `${SUPABASE_URL}/rest/v1/restaurant_tables?id=eq.${editingTableId}`
      : `${SUPABASE_URL}/rest/v1/restaurant_tables`;

    const response = await authorizedFetch(
      url,
      {
        method: editing
          ? "PATCH"
          : "POST",
        headers: getHeaders({
          Prefer: "return=minimal"
        }),
        body: JSON.stringify({
          name,
          capacity,
          note,
          active
        })
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    resetTableForm();
    await loadTables();

    renderReservations(
      getFilteredReservations()
    );
  } catch (error) {
    console.error(error);

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
  const table = restaurantTables.find(
    item => Number(item.id) === Number(id)
  );

  const tableName =
    table?.name || "tento stůl";

  if (
    !confirm(
      `Opravdu smazat ${tableName}? Rezervace se od stolu odpojí.`
    )
  ) {
    return;
  }

  try {
    const response = await authorizedFetch(
      `${SUPABASE_URL}/rest/v1/restaurant_tables?id=eq.${id}`,
      {
        method: "DELETE",
        headers: getHeaders()
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    if (
      Number(editingTableId) ===
      Number(id)
    ) {
      resetTableForm();
    }

    await loadTables();
    await loadReservations();
  } catch (error) {
    console.error(error);

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

function renderTableSelect(reservation) {
  const assignedId =
    reservation.table_id === null ||
    reservation.table_id === undefined
      ? ""
      : String(reservation.table_id);

  const availableTables =
    restaurantTables.filter(table => {
      return (
        table.active ||
        String(table.id) === assignedId
      );
    });

  const options = availableTables
    .map(table => {
      const selected =
        String(table.id) === assignedId
          ? "selected"
          : "";

      const inactiveText =
        table.active
          ? ""
          : " – neaktivní";

      return `
        <option
          value="${Number(table.id)}"
          ${selected}
        >
          ${escapeHtml(table.name)}
          (${escapeHtml(table.capacity)} míst)
          ${inactiveText}
        </option>
      `;
    })
    .join("");

  return `
    <select
      class="tableSelect"
      aria-label="Přiřadit stůl"
      onchange="assignTable(
        ${Number(reservation.id)},
        this.value
      )"
    >
      <option value="">
        Bez stolu
      </option>

      ${options}
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

function hasTableConflict(
  tableId,
  reservation,
  ignoredReservationId = null
) {
  return reservations.some(item => {
    if (
      ignoredReservationId !== null &&
      Number(item.id) ===
        Number(ignoredReservationId)
    ) {
      return false;
    }

    if (
      Number(item.table_id) !==
      Number(tableId)
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

function findBestAvailableTable(reservation) {
  return (
    restaurantTables
      .filter(table => {
        return (
          table.active &&
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

async function autoAssignTable(reservationId) {
  const reservation =
    reservations.find(item => {
      return (
        Number(item.id) ===
        Number(reservationId)
      );
    });

  if (!reservation) {
    showDashboardNotice("Rezervace nebyla nalezena.");
    return;
  }

  if (
    (reservation.status || "Čeká") ===
    "Zrušeno"
  ) {
    showDashboardNotice(
      "Zrušené rezervaci nelze přiřadit stůl."
    );

    return;
  }

  const bestTable =
    findBestAvailableTable(reservation);

  if (!bestTable) {
    showDashboardNotice(
      `Pro rezervaci na ${formatDate(
        reservation.date
      )} v ${reservation.time || "-"} není volný vhodný stůl.\n\n` +
      "Kontrola používá skutečnou délku rezervace."
    );

    return;
  }

  const confirmed = confirm(
    `Doporučený stůl: ${bestTable.name}\n` +
    `Kapacita: ${bestTable.capacity} míst\n` +
    `Rezervace: ${reservation.people} osob\n\n` +
    "Přiřadit tento stůl?"
  );

  if (!confirmed) {
    return;
  }

  await assignTable(
    reservationId,
    bestTable.id
  );
}

async function assignTable(
  reservationId,
  value
) {
  const tableId =
    value ? Number(value) : null;

  const reservation =
    reservations.find(item => {
      return (
        Number(item.id) ===
        Number(reservationId)
      );
    });

  if (!reservation) {
    showDashboardNotice("Rezervace nebyla nalezena.");
    return;
  }

  const selectedTable =
    restaurantTables.find(item => {
      return (
        Number(item.id) ===
        Number(tableId)
      );
    });

  if (
    selectedTable &&
    selectedTable.active === false
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
    Number(reservation.people) >
      Number(selectedTable.capacity)
  ) {
    showDashboardNotice(
      `${selectedTable.name} má pouze ` +
      `${selectedTable.capacity} míst, ale ` +
      `rezervace je pro ${reservation.people} osob.`
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
      `${selectedTable.name} je v tomto čase již obsazený.\n\n` +
      "Kontrola používá skutečnou délku rezervace."
    );

    renderReservations(
      getFilteredReservations()
    );

    return;
  }

  try {
    const response =
      await authorizedFetch(
        `${SUPABASE_URL}/rest/v1/reservations?id=eq.${reservationId}`,
        {
          method: "PATCH",
          headers: getHeaders(),
          body: JSON.stringify({
            table_id: tableId
          })
        }
      );

    if (!response.ok) {
      throw new Error(
        await response.text()
      );
    }

    await loadReservations();
  } catch (error) {
    console.error(error);

    showDashboardNotice(
      "Nepodařilo se přiřadit stůl."
    );

    renderReservations(
      getFilteredReservations()
    );
  }
}

/* =========================================================
   MENU
========================================================= */

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

  if (!name || !price) {
    showDashboardNotice("Vyplň název i cenu.");
    return;
  }

  let imageUrl =
    editingImageUrl || "";

  try {
    if (imageFile) {
      const extension =
        imageFile.name
          .split(".")
          .pop();

      const fileName =
        `${Date.now()}-` +
        `${Math.random()
          .toString(36)
          .slice(2)}.` +
        extension;

      const upload = await authorizedFetch(
        `${SUPABASE_URL}/storage/v1/object/food-images/${fileName}`,
        {
          method: "POST",
          headers: getHeaders({
            "Content-Type": imageFile.type,
            "x-upsert": "true"
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
        `${SUPABASE_URL}/storage/v1/object/public/food-images/${fileName}`;
    }

    const foodData = {
      name,
      price: Number(price),
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
      ? `${SUPABASE_URL}/rest/v1/menu?id=eq.${editingFoodId}`
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
      <p>Žádná jídla.</p>
    `;

    return;
  }

  list.innerHTML = foods
    .map(food => {
      const photo = food.image_url
        ? `
          <img
            src="${escapeHtml(food.image_url)}"
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
      `${SUPABASE_URL}/rest/v1/menu?id=eq.${id}`,
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
      const widthPercent = 100 / event.columnCount;
      const leftPercent = event.column * widthPercent;
      const height = Math.max(30, event.duration - 2);
      const statusClass = getCalendarStatusClass(r.status);
      const statusLabel = getCalendarStatusLabel(r.status);
      const tableName = r.table_name
        ? ` • 🪑 ${escapeHtml(r.table_name)}`
        : "";

      return `
        <button
          type="button"
          class="calendar-reservation ${statusClass}"
          style="top:${event.start}px;height:${height}px;left:calc(${leftPercent}% + 3px);width:calc(${widthPercent}% - 6px);"
          data-reservation-id="${escapeHtml(r.id)}"
          data-duration="${event.duration}"
          onclick="handleCalendarReservationClick(event, '${r.id}')"
          aria-label="Upravit rezervaci ${escapeHtml(r.name || "")}" 
        >
          <span class="calendar-time">${escapeHtml(r.time || "")}</span>

          <span class="calendar-info">
            <strong>${escapeHtml(r.name || "Bez jména")}</strong>
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
function showDashboardSection(sectionId) {
    const sectionIds = [
        "prehled",
        "grafy",
        "rezervace",
        "novaRezervace",
        "kalendar",
        "stoly",
        "mapa",
        "menu"
    ];

    sectionIds.forEach(id => {
        const section = document.getElementById(id);

        if (!section) return;

        if (sectionId === "rezervace" && id === "novaRezervace") {
            section.style.display = "none";
            return;
        }

        section.style.display =
            id === sectionId ? "" : "none";
    });

    document
        .querySelectorAll(".sidebar nav a")
        .forEach(link => {
            link.classList.toggle(
                "active",
                link.dataset.section === sectionId
            );
        });

    history.replaceState(null, "", `#${sectionId}`);
}

document
    .querySelectorAll(".sidebar nav a[data-section]")
    .forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();

            const sectionId = link.dataset.section;

            showDashboardSection(sectionId);
        });
    });

const initialDashboardSection =
    window.location.hash.replace("#", "") || "prehled";

showDashboardSection(initialDashboardSection);
let draggedTable = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let tableWasDragged = false;
document.addEventListener("mousedown", event => {
    const tableElement = event.target.closest(".table");

    if (!tableElement) return;

    const floorMap = tableElement.closest(".floor-map");

    if (!floorMap) return;

    draggedTable = tableElement;
    tableWasDragged = false;
    const tableRect = tableElement.getBoundingClientRect();

    dragOffsetX = event.clientX - tableRect.left;
    dragOffsetY = event.clientY - tableRect.top;

    tableElement.classList.add("dragging");

    event.preventDefault();
});

document.addEventListener("mousemove", event => {
    if (!draggedTable) return;

    const floorMap = draggedTable.closest(".floor-map");

    if (!floorMap) return;

    const mapRect = floorMap.getBoundingClientRect();

    let x = event.clientX - mapRect.left - dragOffsetX;
    let y = event.clientY - mapRect.top - dragOffsetY;

    const maxX = floorMap.clientWidth - draggedTable.offsetWidth;
    const maxY = floorMap.clientHeight - draggedTable.offsetHeight;

    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));
    tableWasDragged = true;
  
    draggedTable.style.left = `${Math.round(x)}px`;
    draggedTable.style.top = `${Math.round(y)}px`;
});

document.addEventListener("mouseup", async () => {
    if (!draggedTable) return;

    const tableElement = draggedTable;
    draggedTable = null;
  
if (tableWasDragged) {
  setTimeout(() => {
    tableWasDragged = false;
  }, 0);
}
    tableElement.classList.remove("dragging");

    const tableId = tableElement.dataset.tableId;
  
  if (!tableId) {
  return;
}
    const x = Math.round(
      parseFloat(tableElement.style.left) || 0
    );
    const y = Math.round(
      parseFloat(tableElement.style.top) || 0
    );

    try {
        const response = await authorizedFetch(
            `${SUPABASE_URL}/rest/v1/restaurant_tables?id=eq.${tableId}&restaurant_id=eq.${currentRestaurantId}`,
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

        const table = restaurantTables.find(
            item => Number(item.id) === Number(tableId)
        );

        if (table) {
            table.x = x;
            table.y = y;
        }
    } catch (error) {
        console.error("Nepodařilo se uložit pozici stolu:", error);
        showDashboardNotice("Pozici stolu se nepodařilo uložit.");
        await loadRestaurantTables();
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
    if (!openingHours.length) {
      openingHours = DAY_NAMES.map((_, day) => ({ day_of_week: day, is_open: true, open_time: "10:00", close_time: "22:00" }));
    }
    renderOpeningHours();
  } catch (error) {
    console.error(error);
    showDashboardNotice("Nejdřív spusť soubor supabase-opening-hours.sql v Supabase SQL Editoru.");
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
      <input class="day-from" type="time" value="${String(row.open_time).slice(0,5)}">
      <span>–</span>
      <input class="day-to" type="time" value="${String(row.close_time).slice(0,5)}">
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
    renderOpeningHours();
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
    <div><strong>${block.date}</strong> · ${String(block.start_time).slice(0,5)}–${String(block.end_time).slice(0,5)}<br><span>${escapeHtml(block.reason || "Bez důvodu")}</span></div>
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
  return block ? { ok: false, message: block.reason ? `Tento čas je blokovaný: ${block.reason}` : "Tento čas je blokovaný." } : { ok: true };
}
