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

  if (!menu.length) {
    container.innerHTML = "<p>Menu je prázdné.</p>";
    return;
  }

  const categories = [
    "Předkrm",
    "Pizza",
    "Hlavní jídlo",
    "Těstoviny",
    "Sladké pokrmy",
    "Dezert",
    "Nápoj"
  ];

  container.className = "";
  container.style.display = "block";

  container.innerHTML = categories.map(category => {
    const items = menu.filter(item => (item.category || "Hlavní jídlo") === category);

    if (!items.length) return "";

    return `
      <section class="menu-category" style="width:100%;margin-bottom:70px;">
        <h2 style="font-size:36px;color:#f59e0b;margin-bottom:25px;border-left:6px solid #f59e0b;padding-left:15px;text-transform:uppercase;">
          ${category}
        </h2>

       <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,260px));justify-content:center;gap:30px;">
          ${items.map(item => `
            <div class="food-card" onclick="openFoodDetail(${item.id})">
              ${
                item.image_url
                  ? `<img src="${item.image_url}" style="width:100%;height:180px;object-fit:cover;border-radius:18px;margin-bottom:18px;display:block;">`
                  : `<div style="width:100%;height:180px;display:flex;align-items:center;justify-content:center;font-size:64px;border-radius:18px;margin-bottom:18px;background:#111827;">${item.emoji || "🍽️"}</div>`
              }

              <h3>${item.name}</h3>
              <p>${item.price} Kč</p>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");
}

function odpoved() {
  const text = document.getElementById("dotaz").value.toLowerCase();
  const vysledek = document.getElementById("vysledek");

  if (text.includes("menu")) {
    vysledek.innerHTML = menu
      .map(item => `${item.emoji || "🍽️"} ${item.name} - ${item.price} Kč`)
      .join("<br>");
  } else if (text.includes("otev")) {
    vysledek.innerHTML = "🕒 Otevřeno každý den 10:00–22:00.";
  } else if (text.includes("rezerv")) {
    document.getElementById("rezervace").scrollIntoView({ behavior: "smooth" });
    vysledek.innerHTML = "📅 Formulář rezervace je níže.";
  } else {
    vysledek.innerHTML = "Zkus napsat: <b>menu</b>, <b>otevřeno</b> nebo <b>rezervace</b>.";
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
document.addEventListener("DOMContentLoaded", () => {
  const menuToggle = document.getElementById("menuToggle");
  const navLinks = document.getElementById("navLinks");

  if (!menuToggle || !navLinks) return;

  menuToggle.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");

    menuToggle.textContent = isOpen ? "✕" : "☰";
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  navLinks.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      navLinks.classList.remove("open");
      menuToggle.textContent = "☰";
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
});
loadMenu();
function openFoodDetail(id) {
  const item = menu.find(food => food.id === id);

  if (!item) return;

  document.getElementById("modalFoodName").textContent = item.name;
  document.getElementById("modalFoodPrice").textContent = `${item.price} Kč`;
  document.getElementById("modalFoodDescription").textContent =
    item.description || "Neuvedeno";
  document.getElementById("modalFoodIngredients").textContent =
    item.ingredients || "Neuvedeno";
  document.getElementById("modalFoodWeight").textContent =
    item.weight || "Neuvedeno";
  document.getElementById("modalFoodAllergens").textContent =
    item.allergens || "Neuvedeno";

  document.getElementById("foodModal").classList.add("open");
}

function closeFoodDetail() {
  document.getElementById("foodModal").classList.remove("open");
}
document.addEventListener("DOMContentLoaded", function () {
  const foodModal = document.getElementById("foodModal");

  if (!foodModal) return;

  foodModal.addEventListener("click", function (event) {
    if (event.target === foodModal) {
      closeFoodDetail();
    }
  });
});
