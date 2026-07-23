const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY = "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

let reservations = [];
let foods = [];
let restaurantTables = [];

let editingFoodId = null;
let editingImageUrl = "";
let editingTableId = null;

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
    hideLogin();
    await loadDashboardData();
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
    headers: options.headers || getHeaders()
  });

  if (
    response.status === 401 &&
    await refreshSession()
  ) {
    response = await fetch(url, {
      ...options,
      headers: options.headers || getHeaders()
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
      `${SUPABASE_URL}/rest/v1/reservations?select=*&order=id.desc`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    reservations =
      Array.isArray(data) ? data : [];

    updateStatistics();
    renderReservations(reservations);
    renderCharts();
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
    return;
  }

  const name = prompt(
    "Jméno:",
    reservation.name || ""
  );

  if (name === null) {
    return;
  }

  const people = prompt(
    "Počet osob:",
    reservation.people || ""
  );

  if (people === null) {
    return;
  }

  const date = prompt(
    "Datum RRRR-MM-DD:",
    reservation.date || ""
  );

  if (date === null) {
    return;
  }

  const time = prompt(
    "Čas HH:MM:",
    reservation.time || ""
  );

  if (time === null) {
    return;
  }

  const phone = prompt(
    "Telefon:",
    reservation.phone || ""
  );

  if (phone === null) {
    return;
  }

  const email = prompt(
    "E-mail:",
    reservation.email || ""
  );

  if (email === null) {
    return;
  }

  const note = prompt(
    "Poznámka:",
    reservation.note || ""
  );

  if (note === null) {
    return;
  }

  const peopleNumber = Number(people);

  if (
    !Number.isInteger(peopleNumber) ||
    peopleNumber < 1 ||
    peopleNumber > 30
  ) {
    alert(
      "Počet osob musí být od 1 do 30."
    );

    return;
  }

  updateReservation(id, {
    name: name.trim(),
    people: peopleNumber,
    date: date.trim(),
    time: time.trim(),
    phone: phone.trim(),
    email: email.trim(),
    note: note.trim()
  });
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
      `${SUPABASE_URL}/rest/v1/restaurant_tables?select=*&order=name.asc`
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
      `${SUPABASE_URL}/rest/v1/menu?select=*&order=id.desc`
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
      weight
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
