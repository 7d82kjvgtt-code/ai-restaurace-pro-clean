const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY = "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json"
};

let menu = [];

async function loadMenu() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/menu?select=*&order=id.asc`, {
    headers
  });

  menu = await res.json();
  renderPublicMenu();
}
 function renderPublicMenu() {
  const container = document.getElementById("publicMenu");

  if (!container) return;

  container.innerHTML = menu.map(item => `
    <div class="food-card">

      ${item.image_url ? `<img src="${item.image_url}" class="foodPhoto">` : ""}

      <div style="font-size:40px">
        ${item.emoji || "🍽️"}
      </div>

      <h3>${item.name}</h3>
      <p>${item.price} Kč</p>

    </div>
  `).join("");
}
function odpoved() {
  const text = document.getElementById("dotaz").value.toLowerCase();
  const vysledek = document.getElementById("vysledek");

  if (text.includes("menu")) {
    vysledek.innerHTML = menu
      .map(item => `${item.emoji || "🍽️"} ${item.name} – ${item.price} Kč`)
      .join("<br>");
  } else if (text.includes("otev")) {
    vysledek.innerHTML = "🕒 Otevřeno každý den 10:00–22:00";
  } else if (text.includes("rezerv")) {
    document.getElementById("rezervace").scrollIntoView({ behavior: "smooth" });
    vysledek.innerHTML = "📅 Formulář rezervace je níže.";
  } else {
    vysledek.innerHTML = "Zkus napsat <b>menu</b>, <b>otevřeno</b> nebo <b>rezervace</b>.";
  }
}

async function ulozitRezervaci() {
  const name = document.getElementById("jmeno").value.trim();
  const people = document.getElementById("osoby").value.trim();
  const date = document.getElementById("datum").value;
  const time = document.getElementById("cas").value;
  const phone = document.getElementById("telefon").value.trim();
  const email = document.getElementById("email").value.trim();
  const note = document.getElementById("poznamka").value.trim();

  if (!name || !people || !date || !time || !phone || !email) {
    alert("Vyplň jméno, počet osob, datum, čas, telefon a e-mail.");
    return;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/reservations`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      name,
      people: Number(people),
      date,
      time,
      phone,
      email,
      note,
      status: "Čeká"
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    alert("Chyba rezervace: " + errorText);
    console.error(errorText);
    return;
  }

  alert("✅ Rezervace uložena!");

  document.getElementById("jmeno").value = "";
  document.getElementById("osoby").value = "";
  document.getElementById("datum").value = "";
  document.getElementById("cas").value = "";
  document.getElementById("telefon").value = "";
  document.getElementById("email").value = "";
  document.getElementById("poznamka").value = "";
}
loadMenu();
