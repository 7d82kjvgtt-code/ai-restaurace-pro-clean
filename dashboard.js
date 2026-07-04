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
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/reservations?select=*&order=id.desc`,
    { headers }
  );

  reservations = await res.json();

  document.getElementById("totalCount").innerText = reservations.length;
  document.getElementById("todayCount").innerText = reservations.length;

  renderReservations(reservations);
}

function renderReservations(data) {
  const table = document.getElementById("reservationTable");

  if (!data.length) {
    table.innerHTML =
      `<tr><td colspan="5">Žádné rezervace.</td></tr>`;
    return;
  }

  table.innerHTML = data.map(r => {

    const created = new Date(r.created_at.replace(" ", "T") + "Z");

    const createdCZ = created.toLocaleString("cs-CZ", {
      timeZone: "Europe/Prague",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    return `
      <tr>
        <td>${r.name}</td>
        <td>${r.people}</td>
        <td>${r.time}</td>
        <td>${createdCZ}</td>
        <td>
          <button class="deleteBtn" onclick="deleteReservation(${r.id})">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

async function deleteReservation(id) {
  if (!confirm("Opravdu smazat rezervaci?")) return;

  await fetch(
    `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
    {
      method: "DELETE",
      headers
    }
  );

  loadReservations();
}

async function loadFoods() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/menu?select=*&order=id.desc`,
    { headers }
  );

  foods = await res.json();

  document.getElementById("foodCount").innerText = foods.length;

  renderFoods();
}

async function addFood() {

  const name = document.getElementById("foodName").value.trim();
  const price = document.getElementById("foodPrice").value.trim();

  if (!name || !price) {
    alert("Vyplň název i cenu.");
    return;
  }

  await fetch(
    `${SUPABASE_URL}/rest/v1/menu`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name,
        price: Number(price),
        emoji: "🍽️"
      })
    }
  );

  document.getElementById("foodName").value = "";
  document.getElementById("foodPrice").value = "";

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

      <button class="deleteBtn"
        onclick="deleteFood(${food.id})">
        🗑️
      </button>

    </div>
  `).join("");
}

async function deleteFood(id) {

  if (!confirm("Opravdu smazat jídlo?")) return;

  await fetch(
    `${SUPABASE_URL}/rest/v1/menu?id=eq.${id}`,
    {
      method: "DELETE",
      headers
    }
  );

  loadFoods();
}

document.getElementById("search").addEventListener("input", function () {

  const value = this.value.toLowerCase();

  renderReservations(
    reservations.filter(r =>
      r.name.toLowerCase().includes(value)
    )
  );

});

loadReservations();
loadFoods();
