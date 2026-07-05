const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY = "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json"
};

let reservations = [];
let foods = [];

document.addEventListener("DOMContentLoaded", () => {
  loadReservations();
  loadFoods();

  const search = document.getElementById("search");
  if (search) {
    search.addEventListener("input", () => {
      applyFilters();
    });
  }
});
const statusFilter = document.getElementById("statusFilter");
if (statusFilter) {
  statusFilter.addEventListener("change", () => {
    applyFilters();
  });
}
async function loadReservations() {
  const table = document.getElementById("reservationTable");

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?select=*&order=id.desc`,
      { headers }
    );

    const data = await res.json();

    if (!res.ok) {
      table.innerHTML = `<tr><td colspan="9">Chyba: ${JSON.stringify(data)}</td></tr>`;
      return;
    }

    reservations = data.sort((a, b) => {
  const dateA = `${a.date || ""} ${a.time || ""}`;
  const dateB = `${b.date || ""} ${b.time || ""}`;
  return dateA.localeCompare(dateB);
});

    document.getElementById("totalCount").innerText = reservations.length;
    const today = new Date().toISOString().split("T")[0];

const todayReservations = reservations.filter(r => r.date === today);

document.getElementById("todayCount").innerText = todayReservations.length;
    renderReservations(reservations);

  } catch (error) {
    table.innerHTML = `<tr><td colspan="9">JS chyba: ${error.message}</td></tr>`;
  }
}
function formatDate(date) {
  if (!date) return "-";

  const parts = date.split("-");
  if (parts.length !== 3) return date;

  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
function renderReservations(data) {
  const table = document.getElementById("reservationTable");

  if (!table) return;

  if (!data.length) {
    table.innerHTML = `<tr><td colspan="9">Žádné rezervace.</td></tr>`;
    return;
  }

  table.innerHTML = data.map(r => `
    <tr>
      <td>${r.name || "-"}</td>
      <td>${r.people || "-"}</td>
      <td>${formatDate(r.date)}</td>
      <td>${r.time || "-"}</td>
      <td>${r.phone || "-"}</td>
      <td>${r.email || "-"}</td>
      <td>${r.note || "-"}</td>
      <td>
  <span class="status ${r.status || "Čeká"}">
    ${r.status || "Čeká"}
  </span>
</td>

<td>
  <button onclick="updateStatus(${r.id}, 'Potvrzeno')">✅</button>
  <button onclick="updateStatus(${r.id}, 'Zrušeno')">❌</button>
  <button class="deleteBtn" onclick="deleteReservation(${r.id})">🗑️</button>
</td>
    </tr>
  `).join("");
}

async function deleteReservation(id) {
  
  if (!confirm("Opravdu smazat rezervaci?")) return;

  await fetch(`${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`, {
    method: "DELETE",
    headers
  });

  loadReservations();
}

async function updateStatus(id, status) {

  const res = await fetch(`${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      status: status
    })
  });

  if (!res.ok) {
    alert("Nepodařilo se změnit stav.");
    console.log(await res.text());
    return;
  }

  loadReservations();
}
async function loadFoods() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/menu?select=*&order=id.desc`,
      { headers }
    );

    foods = await res.json();

    document.getElementById("foodCount").innerText = foods.length;
    renderFoods();

  } catch (error) {
    console.error("Chyba menu:", error);
  }
}

async function saveFood() {
  const name = document.getElementById("foodName").value.trim();
  const price = document.getElementById("foodPrice").value.trim();
  const emoji = document.getElementById("foodEmoji").value.trim() || "🍽️";

  if (!name || !price) {
    alert("Vyplň název i cenu.");
    return;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/menu`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name,
      price: Number(price),
      emoji
    })
  });

  document.getElementById("foodName").value = "";
  document.getElementById("foodPrice").value = "";
  document.getElementById("foodEmoji").value = "";

  loadFoods();
}

function renderFoods() {
  const list = document.getElementById("foodList");

  if (!list) return;

  if (!foods.length) {
    list.innerHTML = "<p>Žádná jídla.</p>";
    return;
  }

  list.innerHTML = foods.map(food => `
    <div class="foodItem">
      <div>
        <b>${food.emoji || "🍽️"} ${food.name}</b>
        <div class="foodPrice">${food.price} Kč</div>
      </div>
      <button class="deleteBtn" onclick="deleteFood(${food.id})">🗑️</button>
    </div>
  `).join("");
}

async function deleteFood(id) {
  if (!confirm("Opravdu smazat jídlo?")) return;

  await fetch(`${SUPABASE_URL}/rest/v1/menu?id=eq.${id}`, {
    method: "DELETE",
    headers
  });

  loadFoods();
}

function applyFilters() {
  const searchInput = document.getElementById("search");
  const statusInput = document.getElementById("statusFilter");

  const search = searchInput ? searchInput.value.toLowerCase() : "";
  const status = statusInput ? statusInput.value : "";

  const filtered = reservations.filter(r => {
    const matchSearch =
      (r.name || "").toLowerCase().includes(search) ||
      (r.phone || "").toLowerCase().includes(search) ||
      (r.email || "").toLowerCase().includes(search);

    const matchStatus =
      status === "" || (r.status || "Čeká") === status;

    return matchSearch && matchStatus;
  });

  renderReservations(filtered);
}
