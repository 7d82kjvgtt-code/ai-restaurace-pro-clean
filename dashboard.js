const DEFAULT_MENU = [
  { id: 1, name: "Margherita", price: "189", emoji: "🍕" },
  { id: 2, name: "Prosciutto", price: "219", emoji: "🍕" },
  { id: 3, name: "Caesar salát", price: "179", emoji: "🥗" },
  { id: 4, name: "Tiramisu", price: "129", emoji: "🍰" }
];

let reservations = [];
let foods = [];

function getReservations(){return JSON.parse(localStorage.getItem("reservations")) || []}
function saveReservations(data){localStorage.setItem("reservations", JSON.stringify(data))}
function getMenu(){return JSON.parse(localStorage.getItem("menu")) || DEFAULT_MENU}
function saveMenu(data){localStorage.setItem("menu", JSON.stringify(data))}

function loadReservations(){
  reservations = getReservations();
  document.getElementById("totalCount").innerText = reservations.length;
  document.getElementById("todayCount").innerText = reservations.length;
  renderReservations(reservations);
}

function renderReservations(data){
  const table = document.getElementById("reservationTable");
  if(!data.length){table.innerHTML = `<tr><td colspan="5">Žádné rezervace.</td></tr>`; return;}
  table.innerHTML = data.map(r => `
    <tr><td>${r.jmeno}</td><td>${r.osoby}</td><td>${r.cas}</td><td>${r.vytvoreno || "-"}</td><td><button class="deleteBtn" onclick="deleteReservation(${r.id})">🗑️</button></td></tr>
  `).join("");
}

function deleteReservation(id){
  if(!confirm("Opravdu smazat rezervaci?")) return;
  saveReservations(reservations.filter(r => r.id !== id));
  loadReservations();
}

function loadFoods(){
  foods = getMenu();
  document.getElementById("foodCount").innerText = foods.length;
  renderFoods();
}

function addFood(){
  const name = document.getElementById("foodName").value.trim();
  const price = document.getElementById("foodPrice").value.trim();
  if(!name || !price){alert("Vyplň název i cenu."); return;}
  foods.push({ id: Date.now(), name, price, emoji:"🍽️" });
  saveMenu(foods);
  document.getElementById("foodName").value = "";
  document.getElementById("foodPrice").value = "";
  loadFoods();
}

function renderFoods(){
  const list = document.getElementById("foodList");
  if(!foods.length){list.innerHTML = "<p>Žádná jídla.</p>"; return;}
  list.innerHTML = foods.map(food => `
    <div class="foodItem"><div><b>${food.emoji || "🍽️"} ${food.name}</b><div class="foodPrice">${food.price} Kč</div></div><button class="deleteBtn" onclick="deleteFood(${food.id})">🗑️</button></div>
  `).join("");
}

function deleteFood(id){
  if(!confirm("Opravdu smazat jídlo?")) return;
  foods = foods.filter(food => food.id !== id);
  saveMenu(foods);
  loadFoods();
}

document.getElementById("search").addEventListener("input", function(){
  const value = this.value.toLowerCase();
  renderReservations(reservations.filter(r => r.jmeno.toLowerCase().includes(value)));
});

if(!localStorage.getItem("menu")) saveMenu(DEFAULT_MENU);
loadReservations();
loadFoods();
