// Selection is a UI preference. Database policies and server endpoints verify membership.
let availableRestaurantMemberships = [];
let multiRestaurantEnabled = false;

function readRestaurantSelection(userId) {
  try {
    const value = JSON.parse(sessionStorage.getItem('dashboardRestaurantSelection') || 'null');
    return value?.userId === userId && Number.isSafeInteger(value.restaurantId) && value.restaurantId > 0
      ? value.restaurantId : null;
  } catch { return null; }
}

function rememberRestaurantSelection(userId, restaurantId) {
  if (!userId || !Number.isSafeInteger(Number(restaurantId)) || Number(restaurantId) < 1) return false;
  try {
    sessionStorage.setItem('dashboardRestaurantSelection', JSON.stringify({ userId, restaurantId: Number(restaurantId) }));
    return true;
  } catch { return false; }
}

function selectRestaurantMembership(memberships, userId) {
  const selectedId = readRestaurantSelection(userId);
  const selected = memberships.find(row => Number(row.restaurant_id) === selectedId);
  if (selected) return selected;
  if (memberships.length === 1) {
    rememberRestaurantSelection(userId, memberships[0].restaurant_id);
    return memberships[0];
  }
  return null;
}

function renderRestaurantChoices() {
  for (const id of ['restaurantSwitcher', 'restaurantChooserSelect']) {
    const select = document.getElementById(id);
    if (!select) continue;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = dashboardText('Vyber restauraci');
    placeholder.disabled = true;
    select.appendChild(placeholder);
    for (const membership of availableRestaurantMemberships) {
      const option = document.createElement('option');
      option.value = String(membership.restaurant_id);
      const name = String(membership.restaurants?.name || `${dashboardText("Restaurace")} #${membership.restaurant_id}`);
      const role = { owner: dashboardText('Majitel'), manager: dashboardText('Manažer'), staff: dashboardText('Obsluha') }[membership.role];
      option.textContent = `${name} · ${role}`;
      select.appendChild(option);
    }
    select.value = currentRestaurantId == null ? '' : String(currentRestaurantId);
  }
  const wrapper = document.getElementById('restaurantSwitcherWrapper');
  if (wrapper) wrapper.hidden = availableRestaurantMemberships.length < 2;
}

function showRestaurantChooser() {
  showLogin();
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('restaurantChooserForm').style.display = '';
  renderRestaurantChoices();
}

function switchDashboardRestaurant(value, askToDiscard = true) {
  const userId = parseJwt(getAccessToken())?.sub;
  const membership = availableRestaurantMemberships.find(row => Number(row.restaurant_id) === Number(value));
  if (!userId || !membership || Number(value) === Number(currentRestaurantId)) return;
  if (askToDiscard && !window.confirm(dashboardText('Přepnout restauraci? Neuložené změny se zahodí.'))) {
    renderRestaurantChoices();
    return;
  }
  if (!rememberRestaurantSelection(userId, membership.restaurant_id)) {
    showDashboardNotice(dashboardText('Výběr restaurace se nepodařilo uložit. Povol úložiště prohlížeče a zkus to znovu.'), 'error');
    return;
  }
  ++dashboardSessionVersion;
  currentRestaurantId = null;
  currentUserId = null;
  currentUserRole = null;
  showLogin();
  document.getElementById('error').textContent = dashboardText('Přepínám restauraci…');
  document.getElementById('loginButton').disabled = true;
  location.reload();
}

async function loadMultiRestaurantCapability() {
  const sessionVersion = dashboardSessionVersion;
  const userId = currentUserId;
  const restaurantId = currentRestaurantId;
  const current = () => sessionVersion === dashboardSessionVersion && userId === currentUserId && restaurantId === currentRestaurantId;
  multiRestaurantEnabled = false;
  const button = document.getElementById('addRestaurantButton');
  if (button) button.hidden = true;
  if (!availableRestaurantMemberships.some(row => row.role === 'owner')) return;
  try {
    const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/rpc/multi_restaurant_enabled`, {
      method: 'POST', headers: getHeaders(), body: '{}'
    });
    if (!response.ok || !current()) return;
    const enabled = await response.json();
    if (!current()) return;
    multiRestaurantEnabled = enabled === true;
    if (button) button.hidden = !multiRestaurantEnabled;
  } catch { /* Existing installations keep their single-restaurant workflow. */ }
}

function readPendingRestaurantCreation(userId) {
  try {
    const value = JSON.parse(sessionStorage.getItem('pendingAdditionalRestaurant') || 'null');
    return value?.userId === userId && typeof value.name === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
      ? value : null;
  } catch { return null; }
}

function showAdditionalRestaurantForm() {
  if (!multiRestaurantEnabled || !availableRestaurantMemberships.some(row => row.role === 'owner')) return;
  const userId = parseJwt(getAccessToken())?.sub;
  if (!userId) return;
  showLogin();
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('additionalRestaurantForm').style.display = '';
  const pending = readPendingRestaurantCreation(userId);
  const input = document.getElementById('additionalRestaurantName');
  input.value = pending?.name || '';
  input.disabled = Boolean(pending);
  document.getElementById('additionalRestaurantStatus').textContent = pending
    ? dashboardText('Předchozí založení nemá ověřený výsledek. Tlačítkem dokončíš stejný požadavek.') : '';
  document.getElementById('additionalRestaurantButton').disabled = false;
}

function closeAdditionalRestaurantForm() {
  if (document.getElementById('additionalRestaurantCancel').disabled) return;
  hideLogin();
  document.getElementById('additionalRestaurantForm').style.display = 'none';
}

async function createAdditionalRestaurant(event) {
  event.preventDefault();
  const sessionVersion = dashboardSessionVersion;
  const userId = parseJwt(getAccessToken())?.sub;
  const current = () => sessionVersion === dashboardSessionVersion && !!userId && parseJwt(getAccessToken())?.sub === userId;
  const button = document.getElementById('additionalRestaurantButton');
  const status = document.getElementById('additionalRestaurantStatus');
  const input = document.getElementById('additionalRestaurantName');
  const cancel = document.getElementById('additionalRestaurantCancel');
  if (button.disabled || !current() || !multiRestaurantEnabled || !availableRestaurantMemberships.some(row => row.role === 'owner')) return;
  let request = readPendingRestaurantCreation(userId);
  if (!request) {
    const name = input.value.trim();
    if (name.length < 2 || name.length > 120) {
      status.textContent = dashboardText('Zadej název restaurace (2–120 znaků).');
      return;
    }
    request = { userId, name, requestId: crypto.randomUUID() };
    try { sessionStorage.setItem('pendingAdditionalRestaurant', JSON.stringify(request)); }
    catch { status.textContent = dashboardText('Požadavek se nepodařilo uložit. Povol úložiště prohlížeče a zkus to znovu.'); return; }
  }
  button.disabled = true;
  cancel.disabled = true;
  input.disabled = true;
  status.textContent = dashboardText('Zakládám restauraci…');
  try {
    const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/rpc/create_additional_owner_restaurant`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify({ p_name: request.name, p_request_id: request.requestId })
    });
    if (!current()) return;
    if (!response.ok) throw new Error('Creation was not confirmed.');
    const restaurantId = await response.json();
    if (!current()) return;
    if (!['number', 'string'].includes(typeof restaurantId) || !Number.isSafeInteger(Number(restaurantId)) || Number(restaurantId) < 1) throw new Error('Invalid restaurant ID.');
    if (!rememberRestaurantSelection(userId, restaurantId)) throw new Error('Selection was not saved.');
    sessionStorage.removeItem('pendingAdditionalRestaurant');
    ++dashboardSessionVersion;
    setDashboardBackgroundInert(true);
    location.reload();
  } catch {
    if (!current()) return;
    status.textContent = dashboardText('Založení se nepodařilo ověřit. Zkus to znovu: systém dokončí stejný požadavek a nezaloží druhou kopii.');
    button.disabled = false;
  } finally {
    if (current()) cancel.disabled = false;
  }
}
