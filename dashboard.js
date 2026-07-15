const SUPABASE_URL = "https://decpnnbaejxjbpmyjocs.supabase.co";
const SUPABASE_KEY =
  "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json"
};

let reservations = [];
let foods = [];

let editingFoodId = null;
let editingImageUrl = "";

document.addEventListener("DOMContentLoaded", () => {
  loadReservations();
  loadFoods();

  const search = document.getElementById("search");

  if (search) {
    search.addEventListener("input", applyFilters);
  }

  const statusFilter = document.getElementById("statusFilter");

  if (statusFilter) {
    statusFilter.addEventListener("change", applyFilters);
  }
});

/* =========================================
   REZERVACE
========================================= */

async function loadReservations() {
  const table = document.getElementById("reservationTable");

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?select=*&order=id.desc`,
      { headers }
    );

    const data = await res.json();

    if (!res.ok) {
      if (table) {
        table.innerHTML = `
          <tr>
            <td colspan="9">
              Chyba: ${JSON.stringify(data)}
            </td>
          </tr>
        `;
      }

      return;
    }

    reservations = Array.isArray(data) ? data : [];
const pendingReservations = reservations.filter(
  reservation => (reservation.status || "Čeká") === "Čeká"
);

const pendingCount = document.getElementById("pendingCount");

if (pendingCount) {
  pendingCount.innerText = pendingReservations.length;
}
    const totalCount = document.getElementById("totalCount");

    if (totalCount) {
      totalCount.innerText = reservations.length;
    }

    const today = new Date().toISOString().split("T")[0];

    const todayReservations = reservations.filter(
      reservation => reservation.date === today
    );

    const todayCount = document.getElementById("todayCount");

    if (todayCount) {
      todayCount.innerText = todayReservations.length;
    }

    renderReservations(reservations);
  } catch (error) {
    if (table) {
      table.innerHTML = `
        <tr>
          <td colspan="9">
            JS chyba: ${error.message}
          </td>
        </tr>
      `;
    }
  }
}

function formatDate(date) {
  if (!date) return "-";

  const parts = date.split("-");

  if (parts.length !== 3) {
    return date;
  }

  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function renderReservations(data) {
  const table = document.getElementById("reservationTable");

  if (!table) return;

  if (!data.length) {
    table.innerHTML = `
      <tr>
        <td colspan="9">Žádné rezervace.</td>
      </tr>
    `;

    return;
  }

  table.innerHTML = data
    .map(
      reservation => `
        <tr>
          <td>${reservation.name || "-"}</td>
          <td>${reservation.people || "-"}</td>
          <td>${formatDate(reservation.date)}</td>
          <td>${reservation.time || "-"}</td>
          <td>
  ${
    reservation.phone
      ? `<a class="contactLink" href="tel:${reservation.phone}">
          ${reservation.phone}
        </a>`
      : "-"
  }
</td>

<td>
  ${
    reservation.email
      ? `<a class="contactLink" href="mailto:${reservation.email}">
          ${reservation.email}
        </a>`
      : "-"
  }
</td>
          <td>${reservation.note || "-"}</td>

          <td>
            <span class="status ${reservation.status || "Čeká"}">
              ${reservation.status || "Čeká"}
            </span>
          </td>

          <td>
          <button
  class="editBtn"
  onclick="editReservation(${reservation.id})"
>
  ✏️
</button>

<button
  onclick="updateStatus(${reservation.id}, 'Potvrzeno')"
>
  ✅
</button>

<button
  onclick="updateStatus(${reservation.id}, 'Zrušeno')"
>
  ❌
</button>

<button
  class="deleteBtn"
  onclick="deleteReservation(${reservation.id})"
>
  🗑️
</button>
          </td>
        </tr>
      `
    )
    .join("");
}

async function updateStatus(id, status) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status })
      }
    );

    if (!res.ok) {
      alert("Nepodařilo se změnit stav.");
      console.error(await res.text());
      return;
    }

    loadReservations();
  } catch (error) {
    alert("Při změně stavu nastala chyba.");
    console.error(error);
  }
}

async function deleteReservation(id) {
  const confirmed = confirm("Opravdu smazat rezervaci?");

  if (!confirmed) return;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!res.ok) {
      alert("Nepodařilo se smazat rezervaci.");
      console.error(await res.text());
      return;
    }

    loadReservations();
  } catch (error) {
    alert("Při mazání rezervace nastala chyba.");
    console.error(error);
  }
}

function applyFilters() {
  const searchInput = document.getElementById("search");
  const statusInput = document.getElementById("statusFilter");

  const search = searchInput
    ? searchInput.value.toLowerCase().trim()
    : "";

  const status = statusInput
    ? statusInput.value
    : "";

  const filtered = reservations.filter(reservation => {
    const name = (reservation.name || "").toLowerCase();
    const phone = (reservation.phone || "").toLowerCase();
    const email = (reservation.email || "").toLowerCase();

    const matchSearch =
      name.includes(search) ||
      phone.includes(search) ||
      email.includes(search);

    const reservationStatus =
      reservation.status || "Čeká";

    const matchStatus =
      status === "" ||
      reservationStatus === status;

    return matchSearch && matchStatus;
  });

  renderReservations(filtered);
}

/* =========================================
   MENU
========================================= */

async function loadFoods() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/menu?select=*&order=id.desc`,
      { headers }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("Chyba při načítání menu:", data);
      return;
    }

    foods = Array.isArray(data) ? data : [];

    const foodCount = document.getElementById("foodCount");

    if (foodCount) {
      foodCount.innerText = foods.length;
    }

    renderFoods();
  } catch (error) {
    console.error("Chyba menu:", error);
  }
}

async function saveFood() {
  const name =
    document.getElementById("foodName").value.trim();

  const price =
    document.getElementById("foodPrice").value.trim();

  const emoji =
    document.getElementById("foodEmoji").value.trim() ||
    "🍽️";

  const category =
    document.getElementById("foodCategory").value;

  const description =
    document
      .getElementById("foodDescription")
      .value.trim();

  const ingredients =
    document
      .getElementById("foodIngredients")
      .value.trim();

  const allergens =
    document
      .getElementById("foodAllergens")
      .value.trim();

  const weight =
    document
      .getElementById("foodWeight")
      .value.trim();

  const imageInput =
    document.getElementById("foodImage");

  const imageFile =
    imageInput && imageInput.files
      ? imageInput.files[0]
      : null;

  if (!name || !price) {
    alert("Vyplň název i cenu.");
    return;
  }

  let image_url = editingImageUrl || "";

  try {
    if (imageFile) {
      const fileExt =
        imageFile.name.split(".").pop();

      const randomPart =
        Math.random()
          .toString(36)
          .substring(2);

      const fileName =
        `${Date.now()}-${randomPart}.${fileExt}`;

      const uploadRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/food-images/${fileName}`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": imageFile.type,
            "x-upsert": "true"
          },
          body: imageFile
        }
      );

      if (!uploadRes.ok) {
        alert("Nepodařilo se nahrát fotku.");
        console.error(await uploadRes.text());
        return;
      }

      image_url =
        `${SUPABASE_URL}/storage/v1/object/public/food-images/${fileName}`;
    }

    const foodData = {
      name,
      price: Number(price),
      emoji,
      image_url,
      category,
      description,
      ingredients,
      allergens,
      weight
    };

    const editing = editingFoodId !== null;

    const url = editing
      ? `${SUPABASE_URL}/rest/v1/menu?id=eq.${editingFoodId}`
      : `${SUPABASE_URL}/rest/v1/menu`;

    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers,
      body: JSON.stringify(foodData)
    });

    if (!res.ok) {
      alert(
        editing
          ? "Nepodařilo se upravit jídlo."
          : "Nepodařilo se uložit jídlo."
      );

      console.error(await res.text());
      return;
    }

    resetFoodForm();
    await loadFoods();
  } catch (error) {
    alert("Při ukládání jídla nastala chyba.");
    console.error(error);
  }
}

function renderFoods() {
  const list = document.getElementById("foodList");

  if (!list) return;

  if (!foods.length) {
    list.innerHTML = "<p>Žádná jídla.</p>";
    return;
  }

  list.innerHTML = foods
    .map(
      food => `
        <div class="foodItem">
          ${
            food.image_url
              ? `
                <img
                  src="${food.image_url}"
                  class="foodPhoto"
                  alt="${food.name || "Jídlo"}"
                >
              `
              : ""
          }

          <div class="foodInfo">
            <b>
              ${food.emoji || "🍽️"}
              ${food.name || "Bez názvu"}
            </b>

            <div class="foodPrice">
              ${food.price || 0} Kč
            </div>

            <small>
              ${food.category || "Bez kategorie"}
            </small>
          </div>

          <div class="foodActions">
            <button
              class="editBtn"
              onclick="editFood(${food.id})"
              title="Upravit jídlo"
            >
              ✏️
            </button>

            <button
              class="deleteBtn"
              onclick="deleteFood(${food.id})"
              title="Smazat jídlo"
            >
              🗑️
            </button>
          </div>
        </div>
      `
    )
    .join("");
}

function editFood(id) {
  const food = foods.find(
    item => item.id === id
  );

  if (!food) return;

  editingFoodId = food.id;
  editingImageUrl = food.image_url || "";

  document.getElementById("foodName").value =
    food.name || "";

  document.getElementById("foodPrice").value =
    food.price || "";

  document.getElementById("foodEmoji").value =
    food.emoji || "";

  document.getElementById("foodCategory").value =
    food.category || "Pizza";

  document.getElementById("foodDescription").value =
    food.description || "";

  document.getElementById("foodIngredients").value =
    food.ingredients || "";

  document.getElementById("foodAllergens").value =
    food.allergens || "";

  document.getElementById("foodWeight").value =
    food.weight || "";

  const saveButton =
    document.querySelector(
      'button[onclick="saveFood()"]'
    );

  if (saveButton) {
    saveButton.textContent = "Uložit změny";
  }
 const cancelButton = document.getElementById("cancelEditBtn");

if (cancelButton) {
  cancelButton.style.display = "block";
}
  const foodName =
    document.getElementById("foodName");

  if (foodName) {
    foodName.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    foodName.focus();
  }
}

function resetFoodForm() {
  editingFoodId = null;
  editingImageUrl = "";

  document.getElementById("foodName").value = "";
  document.getElementById("foodPrice").value = "";
  document.getElementById("foodEmoji").value = "";
  document.getElementById("foodDescription").value = "";
  document.getElementById("foodIngredients").value = "";
  document.getElementById("foodAllergens").value = "";
  document.getElementById("foodWeight").value = "";

  const imageInput =
    document.getElementById("foodImage");

  if (imageInput) {
    imageInput.value = "";
  }

  const saveButton =
    document.querySelector(
      'button[onclick="saveFood()"]'
    );

  if (saveButton) {
    saveButton.textContent = "Přidat jídlo";
}
    const cancelButton = document.getElementById("cancelEditBtn");
  
if (cancelButton) {
  cancelButton.style.display = "none";
}
}

async function deleteFood(id) {
  const confirmed =
    confirm("Opravdu smazat jídlo?");

  if (!confirmed) return;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/menu?id=eq.${id}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!res.ok) {
      alert("Nepodařilo se smazat jídlo.");
      console.error(await res.text());
      return;
    }

    if (editingFoodId === id) {
      resetFoodForm();
    }

    await loadFoods();
  } catch (error) {
    alert("Při mazání jídla nastala chyba.");
    console.error(error);
  }
}
function resetFilters() {
  const searchInput = document.getElementById("search");
  const statusInput = document.getElementById("statusFilter");

  if (searchInput) {
    searchInput.value = "";
  }

  if (statusInput) {
    statusInput.value = "";
  }

  renderReservations(reservations);
}
function exportReservations() {
  const searchInput = document.getElementById("search");
  const statusInput = document.getElementById("statusFilter");

  const search = searchInput
    ? searchInput.value.toLowerCase().trim()
    : "";

  const status = statusInput
    ? statusInput.value
    : "";

  const filteredReservations = reservations.filter(reservation => {
    const name = (reservation.name || "").toLowerCase();
    const phone = (reservation.phone || "").toLowerCase();
    const email = (reservation.email || "").toLowerCase();

    const matchSearch =
      name.includes(search) ||
      phone.includes(search) ||
      email.includes(search);

    const reservationStatus =
      reservation.status || "Čeká";

    const matchStatus =
      status === "" ||
      reservationStatus === status;

    return matchSearch && matchStatus;
  });

  if (!filteredReservations.length) {
    alert("Nejsou žádné filtrované rezervace ke stažení.");
    return;
  }

  const columns = [
    "Jméno",
    "Počet osob",
    "Datum",
    "Čas",
    "Telefon",
    "E-mail",
    "Poznámka",
    "Stav"
  ];

  const rows = filteredReservations.map(reservation => [
    reservation.name || "",
    reservation.people || "",
    reservation.date || "",
    reservation.time || "",
    reservation.phone || "",
    reservation.email || "",
    reservation.note || "",
    reservation.status || "Čeká"
  ]);

  const escapeValue = value => {
    const text = String(value).replace(/"/g, '""');
    return `"${text}"`;
  };

  const csv = [
    columns.map(escapeValue).join(";"),
    ...rows.map(row =>
      row.map(escapeValue).join(";")
    )
  ].join("\n");

  const blob = new Blob(
    ["\uFEFF" + csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download =
    `rezervace-${new Date()
      .toISOString()
      .split("T")[0]}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
