const DEFAULT_MENU = [
  { id: 1, name: "Margherita", price: "189", emoji: "🍕" },
  { id: 2, name: "Prosciutto", price: "219", emoji: "🍕" },
  { id: 3, name: "Caesar salát", price: "179", emoji: "🥗" },
  { id: 4, name: "Tiramisu", price: "129", emoji: "🍰" }
];

function getMenu(){
  return JSON.parse(localStorage.getItem("menu")) || DEFAULT_MENU;
}

function saveMenu(menu){
  localStorage.setItem("menu", JSON.stringify(menu));
}

function getReservations(){
  return JSON.parse(localStorage.getItem("reservations")) || [];
}

function saveReservations(data){
  localStorage.setItem("reservations", JSON.stringify(data));
}

function renderPublicMenu(){
  const menu = getMenu();
  document.getElementById("publicMenu").innerHTML = menu.map(item => `
    <div class="food-card">
      <div style="font-size:34px">${item.emoji || "🍽️"}</div>
      <h3>${item.name}</h3>
      <p>${item.price} Kč</p>
    </div>
  `).join("");
}

function odpoved(){
  const text = document.getElementById("dotaz").value.toLowerCase();
  const vysledek = document.getElementById("vysledek");
  const menu = getMenu();

  if(text.includes("menu")){
    vysledek.innerHTML = menu.map(item => `${item.emoji || "🍽️"} ${item.name} — ${item.price} Kč`).join("<br>");
  } else if(text.includes("otev")){
    vysledek.innerHTML = "🕒 Máme otevřeno každý den 10:00–22:00.";
  } else if(text.includes("rezerv")){
    document.getElementById("rezervace").scrollIntoView({behavior:"smooth"});
    vysledek.innerHTML = "📅 Formulář rezervace je níže na stránce.";
  } else {
    vysledek.innerHTML = "Zkus napsat: <b>menu</b>, <b>otevřeno</b> nebo <b>rezervace</b>.";
  }
}

function ulozitRezervaci(){
  const jmeno = document.getElementById("jmeno").value.trim();
  const osoby = document.getElementById("osoby").value.trim();
  const cas = document.getElementById("cas").value;

  if(!jmeno || !osoby || !cas){
    alert("Vyplň všechna pole.");
    return;
  }

  const reservations = getReservations();
  reservations.push({ id: Date.now(), jmeno, osoby, cas, status:"Čeká", vytvoreno: new Date().toLocaleString("cs-CZ") });
  saveReservations(reservations);

  alert(`✅ Rezervace uložena: ${jmeno}, ${osoby} osob, ${cas}`);
  document.getElementById("jmeno").value = "";
  document.getElementById("osoby").value = "";
  document.getElementById("cas").value = "";
}

if(!localStorage.getItem("menu")) saveMenu(DEFAULT_MENU);
renderPublicMenu();
