const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY = "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json"
};

let reservations = [];
let foods = [];

async function loadReservations() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reservations?select=*&order=id.desc`, { headers });
  reservations = await res.json();

  document.getElementById("totalCount").innerText = reservations.length;
  document.getElementById("todayCount").innerText = reservations.length;

  renderReservations(reservations);
}

function renderReservations(data) {
  const table = document.getElementById("reservationTable");

  if (!data.length) {
    table.innerHTML = `<tr><td colspan="9">Žádné rezervace.</td></tr>`;
    return;
  }

  table.innerHTML = data.map(r => {
    const created = r.created_at || "-";

    return `
      <tr>
        <td>${r.name || "-"}</td>
        <td>${r.people || "-"}</td>
        <td>${r.date || "-"}</td>
        <td>${r.time || "-"}</td>
        <td>${r.phone || "-"}</td>
        <td>${r.email || "-"}</td>
        <td>${r.note || "-"}</td>
        <td>${r.status || "Čeká"}</td>
        <td>
          <button class="deleteBtn" onclick="deleteReservation(${r.id})">🗑️</button>
        </td>
      </tr>
    `;
  }).join("");
}

async function deleteReservation(id) {
  if (!confirm("Opravdu smazat rezervaci?")) return;

  await fetch(`${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`, {
    method: "DELETE",
    headers
  });

  loadReservations();
}

async function loadFoods() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/menu?select=*&order=id.desc`, { headers });
  foods = await res.json();

  document.getElementById("foodCount").innerText = foods.length;
  renderFoods();
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

document.getElementById("search").addEventListener("input", function () {
  const value = this.value.toLowerCase();

  renderReservations(
    reservations.filter(r =>
      (r.name || "").toLowerCase().includes(value) ||
      (r.phone || "").toLowerCase().includes(value) ||
      (r.email || "").toLowerCase().includes(value)
    )
  );
});

loadReservations();
loadFoods();
