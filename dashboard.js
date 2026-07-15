const SUPABASE_URL =
  "https://decpnnbaejxjbpmyjocs.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";


/* =========================================
   PŘIHLÁŠENÍ A HLAVIČKY
========================================= */

function getAccessToken() {
  return sessionStorage.getItem("supabaseAccessToken");
}

function getHeaders(extraHeaders = {}) {
  const accessToken = getAccessToken();

  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...extraHeaders
  };
}

function hasAccessToken() {
  return Boolean(getAccessToken());
}


/* =========================================
   PROMĚNNÉ
========================================= */

let reservations = [];
let foods = [];

let editingFoodId = null;
let editingImageUrl = "";

let dashboardInitialized = false;


/* =========================================
   SPUŠTĚNÍ DASHBOARDU
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  initializeDashboard();

  /*
    Když uživatel otevře stránku nepřihlášený,
    token vznikne až po přihlášení.
  */
  const loginWatcher = setInterval(() => {
    if (dashboardInitialized) {
      clearInterval(loginWatcher);
      return;
    }

    initializeDashboard();
  }, 500);
});

function initializeDashboard() {
  if (dashboardInitialized || !hasAccessToken()) {
    return;
  }

  dashboardInitialized = true;

  loadReservations();
  loadFoods();

  const search = document.getElementById("search");

  if (search) {
    search.addEventListener("input", applyFilters);
  }

  const statusFilter =
    document.getElementById("statusFilter");

  if (statusFilter) {
    statusFilter.addEventListener(
      "change",
      applyFilters
    );
  }
}


/* =========================================
   REZERVACE – NAČTENÍ
========================================= */

async function loadReservations() {
  const table =
    document.getElementById("reservationTable");

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?select=*&order=id.desc`,
      {
        headers: getHeaders()
      }
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

    reservations = Array.isArray(data)
      ? data
      : [];

    updateReservationStatistics();
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

function updateReservationStatistics() {
  const pendingReservations =
    reservations.filter(
      reservation =>
        (reservation.status || "Čeká") === "Čeká"
    );

  const pendingCount =
    document.getElementById("pendingCount");

  if (pendingCount) {
    pendingCount.innerText =
      pendingReservations.length;
  }

  const totalCount =
    document.getElementById("totalCount");

  if (totalCount) {
    totalCount.innerText = reservations.length;
  }

  const today = getLocalDateString();

  const todayReservations =
    reservations.filter(
      reservation => reservation.date === today
    );

  const todayCount =
    document.getElementById("todayCount");

  if (todayCount) {
    todayCount.innerText =
      todayReservations.length;
  }
}

function getLocalDateString() {
  const now = new Date();

  return new Date(
    now.getTime() -
      now.getTimezoneOffset() * 60000
  )
    .toISOString()
    .split("T")[0];
}

function formatDate(date) {
  if (!date) return "-";

  const parts = date.split("-");

  if (parts.length !== 3) {
    return date;
  }

  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}


/* =========================================
   REZERVACE – VYKRESLENÍ
========================================= */

function renderReservations(data) {
  const table =
    document.getElementById("reservationTable");

  if (!table) return;

  if (!data.length) {
    table.innerHTML = `
      <tr>
        <td colspan="9">
          Žádné rezervace.
        </td>
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

          <td>
            ${formatDate(reservation.date)}
          </td>

          <td>${reservation.time || "-"}</td>

          <td>
            ${
              reservation.phone
                ? `
                  <a
                    class="contactLink"
                    href="tel:${reservation.phone}"
                  >
                    ${reservation.phone}
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
                    href="mailto:${reservation.email}"
                  >
                    ${reservation.email}
                  </a>
                `
                : "-"
            }
          </td>

          <td>${reservation.note || "-"}</td>

          <td>
            <span
              class="status ${
                reservation.status || "Čeká"
              }"
            >
              ${reservation.status || "Čeká"}
            </span>
          </td>

          <td>
            <button
              class="editBtn"
              onclick="editReservation(
                ${reservation.id}
              )"
              title="Upravit rezervaci"
            >
              ✏️
            </button>

            <button
              onclick="updateStatus(
                ${reservation.id},
                'Potvrzeno'
              )"
              title="Potvrdit rezervaci"
            >
              ✅
            </button>

            <button
              onclick="updateStatus(
                ${reservation.id},
                'Zrušeno'
              )"
              title="Zrušit rezervaci"
            >
              ❌
            </button>

            <button
              class="deleteBtn"
              onclick="deleteReservation(
                ${reservation.id}
              )"
              title="Smazat rezervaci"
            >
              🗑️
            </button>
          </td>
        </tr>
      `
    )
    .join("");
}


/* =========================================
   REZERVACE – STAV A SMAZÁNÍ
========================================= */

async function updateStatus(id, status) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
      {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ status })
      }
    );

    if (!res.ok) {
      alert("Nepodařilo se změnit stav.");
      console.error(await res.text());
      return;
    }

    await loadReservations();
  } catch (error) {
    alert("Při změně stavu nastala chyba.");
    console.error(error);
  }
}

async function deleteReservation(id) {
  const confirmed = confirm(
    "Opravdu smazat rezervaci?"
  );

  if (!confirmed) return;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
      {
        method: "DELETE",
        headers: getHeaders()
      }
    );

    if (!res.ok) {
      alert("Nepodařilo se smazat rezervaci.");
      console.error(await res.text());
      return;
    }

    await loadReservations();
  } catch (error) {
    alert(
      "Při mazání rezervace nastala chyba."
    );

    console.error(error);
  }
}


/* =========================================
   REZERVACE – FILTRY
========================================= */

function getFilteredReservations() {
  const searchInput =
    document.getElementById("search");

  const statusInput =
    document.getElementById("statusFilter");

  const search = searchInput
    ? searchInput.value.toLowerCase().trim()
    : "";

  const status = statusInput
    ? statusInput.value
    : "";

  return reservations.filter(reservation => {
    const name =
      (reservation.name || "").toLowerCase();

    const phone =
      (reservation.phone || "").toLowerCase();

    const email =
      (reservation.email || "").toLowerCase();

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
}

function applyFilters() {
  renderReservations(
    getFilteredReservations()
  );
}

function resetFilters() {
  const searchInput =
    document.getElementById("search");

  const statusInput =
    document.getElementById("statusFilter");

  if (searchInput) {
    searchInput.value = "";
  }

  if (statusInput) {
    statusInput.value = "";
  }

  renderReservations(reservations);
}


/* =========================================
   REZERVACE – EXPORT CSV
========================================= */

function exportReservations() {
  const filteredReservations =
    getFilteredReservations();

  if (!filteredReservations.length) {
    alert(
      "Nejsou žádné filtrované rezervace ke stažení."
    );

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

  const rows =
    filteredReservations.map(reservation => [
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
    const text =
      String(value).replace(/"/g, '""');

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


/* =========================================
   REZERVACE – ÚPRAVA
========================================= */

function editReservation(id) {
  const reservation =
    reservations.find(
      item => item.id === id
    );

  if (!reservation) {
    alert("Rezervace nebyla nalezena.");
    return;
  }

  const newName = prompt(
    "Jméno:",
    reservation.name || ""
  );

  if (newName === null) return;

  const newPeople = prompt(
    "Počet osob:",
    reservation.people || ""
  );

  if (newPeople === null) return;

  const newDate = prompt(
    "Datum ve formátu RRRR-MM-DD:",
    reservation.date || ""
  );

  if (newDate === null) return;

  const newTime = prompt(
    "Čas ve formátu HH:MM:",
    reservation.time || ""
  );

  if (newTime === null) return;

  const newPhone = prompt(
    "Telefon:",
    reservation.phone || ""
  );

  if (newPhone === null) return;

  const newEmail = prompt(
    "E-mail:",
    reservation.email || ""
  );

  if (newEmail === null) return;

  const newNote = prompt(
    "Poznámka:",
    reservation.note || ""
  );

  if (newNote === null) return;

  const peopleNumber = Number(newPeople);

  if (
    !newName.trim() ||
    peopleNumber < 1 ||
    peopleNumber > 20 ||
    !newDate ||
    !newTime ||
    !newPhone.trim() ||
    !newEmail.trim()
  ) {
    alert(
      "Zkontroluj všechny údaje rezervace."
    );

    return;
  }

  updateReservation(id, {
    name: newName.trim(),
    people: peopleNumber,
    date: newDate,
    time: newTime,
    phone: newPhone.trim(),
    email: newEmail.trim(),
    note: newNote.trim()
  });
}

async function updateReservation(
  id,
  updatedData
) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${id}`,
      {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify(updatedData)
      }
    );

    if (!res.ok) {
      alert(
        "Nepodařilo se upravit rezervaci."
      );

      console.error(await res.text());
      return;
    }

    alert("Rezervace byla upravena.");

    await loadReservations();
  } catch (error) {
    console.error(error);

    alert(
      "Nastala chyba při úpravě rezervace."
    );
  }
}


/* =========================================
   MENU – NAČTENÍ
========================================= */

async function loadFoods() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/menu?select=*&order=id.desc`,
      {
        headers: getHeaders()
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error(
        "Chyba při načítání menu:",
        data
      );

      return;
    }

    foods = Array.isArray(data)
      ? data
      : [];

    const foodCount =
      document.getElementById("foodCount");

    if (foodCount) {
      foodCount.innerText = foods.length;
    }

    renderFoods();
  } catch (error) {
    console.error("Chyba menu:", error);
  }
}


/* =========================================
   MENU – ULOŽENÍ A ÚPRAVA
========================================= */

async function saveFood() {
  const name =
    document
      .getElementById("foodName")
      .value.trim();

  const price =
    document
      .getElementById("foodPrice")
      .value.trim();

  const emoji =
    document
      .getElementById("foodEmoji")
      .value.trim() || "🍽️";

  const category =
    document
      .getElementById("foodCategory")
      .value;

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

  let image_url =
    editingImageUrl || "";

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

          headers: getHeaders({
            "Content-Type": imageFile.type,
            "x-upsert": "true"
          }),

          body: imageFile
        }
      );

      if (!uploadRes.ok) {
        alert(
          "Nepodařilo se nahrát fotku."
        );

        console.error(
          await uploadRes.text()
        );

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

    const editing =
      editingFoodId !== null;

    const url = editing
      ? `${SUPABASE_URL}/rest/v1/menu?id=eq.${editingFoodId}`
      : `${SUPABASE_URL}/rest/v1/menu`;

    const res = await fetch(url, {
      method: editing
        ? "PATCH"
        : "POST",

      headers: getHeaders(),

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
    alert(
      "Při ukládání jídla nastala chyba."
    );

    console.error(error);
  }
}


/* =========================================
   MENU – VYKRESLENÍ
========================================= */

function renderFoods() {
  const list =
    document.getElementById("foodList");

  if (!list) return;

  if (!foods.length) {
    list.innerHTML =
      "<p>Žádná jídla.</p>";

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
              ${
                food.category ||
                "Bez kategorie"
              }
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


/* =========================================
   MENU – FORMULÁŘ ÚPRAVY
========================================= */

function editFood(id) {
  const food = foods.find(
    item => item.id === id
  );

  if (!food) return;

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
  ).value =
    food.description || "";

  document.getElementById(
    "foodIngredients"
  ).value =
    food.ingredients || "";

  document.getElementById(
    "foodAllergens"
  ).value =
    food.allergens || "";

  document.getElementById(
    "foodWeight"
  ).value =
    food.weight || "";

  const saveButton =
    document.querySelector(
      'button[onclick="saveFood()"]'
    );

  if (saveButton) {
    saveButton.textContent =
      "Uložit změny";
  }

  const cancelButton =
    document.getElementById(
      "cancelEditBtn"
    );

  if (cancelButton) {
    cancelButton.style.display =
      "block";
  }

  const foodName =
    document.getElementById(
      "foodName"
    );

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

  document.getElementById(
    "foodName"
  ).value = "";

  document.getElementById(
    "foodPrice"
  ).value = "";

  document.getElementById(
    "foodEmoji"
  ).value = "";

  document.getElementById(
    "foodDescription"
  ).value = "";

  document.getElementById(
    "foodIngredients"
  ).value = "";

  document.getElementById(
    "foodAllergens"
  ).value = "";

  document.getElementById(
    "foodWeight"
  ).value = "";

  const imageInput =
    document.getElementById(
      "foodImage"
    );

  if (imageInput) {
    imageInput.value = "";
  }

  const saveButton =
    document.querySelector(
      'button[onclick="saveFood()"]'
    );

  if (saveButton) {
    saveButton.textContent =
      "Přidat jídlo";
  }

  const cancelButton =
    document.getElementById(
      "cancelEditBtn"
    );

  if (cancelButton) {
    cancelButton.style.display =
      "none";
  }
}


/* =========================================
   MENU – SMAZÁNÍ
========================================= */

async function deleteFood(id) {
  const confirmed = confirm(
    "Opravdu smazat jídlo?"
  );

  if (!confirmed) return;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/menu?id=eq.${id}`,
      {
        method: "DELETE",
        headers: getHeaders()
      }
    );

    if (!res.ok) {
      alert(
        "Nepodařilo se smazat jídlo."
      );

      console.error(await res.text());
      return;
    }

    if (editingFoodId === id) {
      resetFoodForm();
    }

    await loadFoods();
  } catch (error) {
    alert(
      "Při mazání jídla nastala chyba."
    );

    console.error(error);
  }
}
