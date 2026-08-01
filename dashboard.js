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

let reservationChart = null;
let statusChart = null;

document.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();

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
    alert("Účet není přiřazený k žádné restauraci.");
  }
} else {
  showLogin();
}
});

async function loadDashboardData() {
  await Promise.all([
    loadTables(),
    loadFoods()
  ]);

  await loadReservations();
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
    alert("Do administrace má přístup pouze majitel restaurace.");
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

          <td>
            ${escapeHtml(
              reservation.name || "-"
            )}
          </td>

          <td>
            ${escapeHtml(
              reservation.people || "-"
            )}
          </td>

          <td>
            ${escapeHtml(
              formatDate(reservation.date)
            )}
          </td>

          <td>
            ${escapeHtml(
              reservation.time || "-"
            )}
          </td>

          <td>
            ${renderTableSelect(reservation)}
          </td>

          <td>
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

          <td>
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

          <td>
            ${escapeHtml(
              reservation.note || "-"
            )}
          </td>

          <td>
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

          <td>
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
  } catch (error) {
    console.error(error);

    alert(
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
  } catch (error) {
    console.error(error);

    alert(
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
        alert("Rezervace nebyla nalezena.");
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
        alert("Vyplň správně jméno, počet osob, datum a čas.");
        return;
    }

    const updatedReservation = {
        id,
        name,
        people,
        date,
        time,
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
            alert("Vybraný stůl nebyl nalezen.");
            return;
        }

        if (people > Number(selectedTable.capacity)) {
            alert(
                `${selectedTable.name} má jen ` +
                `${selectedTable.capacity} míst.`
            );
            return;
        }

        if (
            status !== "Zrušeno" &&
            hasTableConflict(tableId, updatedReservation, id)
        ) {
            alert(
                `${selectedTable.name} je v tomto čase obsazený.\n\n` +
                "Každá rezervace blokuje stůl na 2 hodiny."
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

alert("Rezervace byla úspěšně upravena.");
    } catch (error) {
        console.error(error);
        alert("Rezervaci se nepodařilo upravit.");
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

    alert(
      "Nepodařilo se upravit rezervaci."
    );
  }
}

function exportReservations() {
  const data = getFilteredReservations();

  if (!data.length) {
    alert(
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

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    restaurantTables =
      Array.isArray(data) ? data : [];

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

    const activeTables = restaurantTables.filter(
        table => table.active
    );

    if (activeTables.length === 0) {
        floorMap.innerHTML = `
            <div class="emptyState">
                Zatím nejsou vytvořené žádné aktivní stoly.
            </div>
        `;
        return;
    }

   floorMap.innerHTML = activeTables
    .map(table => {
        const statusClass = getTableStatus(table.id);

        const statusLabel =
            statusClass === "occupied"
                ? "Obsazený"
                : statusClass === "busy"
                    ? "Rezervace brzy"
                    : "Volný";

        const capacity =
            table.capacity || table.seats || 0;

        return `
            <div
               class="table ${statusClass}"
               data-table-id="${table.id}"
               style="left:${table.x}px; top:${table.y}px;"
               title="${table.name || `Stůl ${table.id}`} • ${capacity} míst • ${statusLabel}"
              onclick="handleTableClick(event, ${table.id})"
            >
                <span class="table-map-name">
                    ${table.name || `Stůl ${table.id}`}
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
  openTable(tableId);
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

function createReservationFromTable() {
    closeTableModal();

    const reservationSection = document.getElementById("novaRezervace");
    const tableSelect = document.getElementById("newTable");

    if (!reservationSection || !tableSelect) {
        alert("Formulář rezervace se nepodařilo otevřít.");
        return;
    }

    tableSelect.innerHTML = restaurantTables
        .filter(table => table.active)
        .map(table => `
            <option value="${table.id}">
                ${table.name} (${table.capacity} míst)
            </option>
        `)
        .join("");

    tableSelect.value = String(selectedTableId);
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
    const tableId = Number(document.getElementById("newTable").value);
    const phone = document.getElementById("newPhone").value.trim();
    const email = document.getElementById("newEmail").value.trim();
    const note = document.getElementById("newNote").value.trim();

    if (!name || !date || !time || !Number.isInteger(people) || people < 1) {
        alert("Vyplň jméno, počet osob, datum a čas.");
        return;
    }

    const selectedTable = restaurantTables.find(
        table => Number(table.id) === tableId
    );

    if (!selectedTable) {
        alert("Vyber platný stůl.");
        return;
    }

    if (people > Number(selectedTable.capacity)) {
        alert(
            `${selectedTable.name} má pouze ${selectedTable.capacity} míst.`
        );
        return;
    }

    const newReservation = {
        name,
        people,
        date,
        time,
        table_id: tableId,
        phone,
        email,
        note,
        status: "Čeká",
        restaurant_id: currentRestaurantId
    };

    if (hasTableConflict(tableId, newReservation)) {
        alert(
            `${selectedTable.name} je v tomto čase už rezervovaný.\n\n` +
            "Každá rezervace blokuje stůl na 2 hodiny."
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

        selectedTableId = null;

        await loadReservations();

        alert("Rezervace byla úspěšně uložena.");
    } catch (error) {
        console.error(error);
        alert("Rezervaci se nepodařilo uložit.");
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
    alert("Zadej název stolu.");
    return;
  }

  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 30
  ) {
    alert(
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
    alert(
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

    alert(
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

    alert(
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

  const reservationDuration = 120;

  const firstStart =
    timeToMinutes(first.time);

  const firstEnd =
    firstStart + reservationDuration;

  const secondStart =
    timeToMinutes(second.time);

  const secondEnd =
    secondStart + reservationDuration;

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
    alert("Rezervace nebyla nalezena.");
    return;
  }

  if (
    (reservation.status || "Čeká") ===
    "Zrušeno"
  ) {
    alert(
      "Zrušené rezervaci nelze přiřadit stůl."
    );

    return;
  }

  const bestTable =
    findBestAvailableTable(reservation);

  if (!bestTable) {
    alert(
      `Pro rezervaci na ${formatDate(
        reservation.date
      )} v ${reservation.time || "-"} není volný vhodný stůl.\n\n` +
      "Každá rezervace blokuje stůl na 2 hodiny."
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
    alert("Rezervace nebyla nalezena.");
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
    alert(
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
    alert(
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
    alert(
      `${selectedTable.name} je v tomto čase již obsazený.\n\n` +
      "Každá rezervace blokuje stůl na 2 hodiny."
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

    alert(
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
    alert("Vyplň název i cenu.");
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

    alert(
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

    alert(
      "Nepodařilo se smazat jídlo."
    );
  }
}
function renderCalendar() {

    const container =
        document.getElementById("calendarReservations");

    if (!container) return;

    const selectedDate =
        document.getElementById("calendarDate")?.value
        || getLocalDateString();

    const todayReservations =
        reservations.filter(r => r.date === selectedDate);

    if (todayReservations.length === 0) {

        container.innerHTML = `
            <p class="emptyCalendar">
                Pro tento den nejsou žádné rezervace.
            </p>
        `;

        return;
    }

    container.innerHTML =
        todayReservations
        .sort((a,b)=>a.time.localeCompare(b.time))
        .map(r=>`

        <div class="calendar-reservation"
             onclick="editReservation('${r.id}')">

            <div class="calendar-time">
                ${r.time}
            </div>

            <div class="calendar-info">

                <h3>${r.name}</h3>

                <p>

                    👥 ${r.people} osob

                    ${r.table_name ? " • 🪑 "+r.table_name : ""}

                </p>

            </div>

            <div class="calendar-status ${getCalendarStatusClass(r.status)}">
    ${getCalendarStatusLabel(r.status)}
</div>

        </div>

        `).join("");

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
    const x = Math.round(parseFloat(tableElement.style.left) || 0);
    const y = Math.round(parseFloat(tableElement.style.top) || 0);

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
        alert("Pozici stolu se nepodařilo uložit.");
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
    alert("Zadej název stolu.");
    nameInput.focus();
    return;
  }

  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 30
  ) {
    alert("Počet míst musí být od 1 do 30.");
    capacityInput.focus();
    return;
  }

  if (
    pendingTableX === null ||
    pendingTableY === null
  ) {
    alert("Nejdříve klikni do mapy.");
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
    alert("Stůl s tímto názvem už existuje.");
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

    alert("Stůl se nepodařilo přidat.");
  } finally {
    if (addButton) {
      addButton.disabled = false;
      addButton.textContent = "Přidat stůl";
    }
  }
}
