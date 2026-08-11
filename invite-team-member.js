const SUPABASE_URL = process.env.SUPABASE_URL || "https://decpnnbaejxjbpmyjocs.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, body) {
  res.status(status).json(body);
}

async function supabase(path, options = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Použij POST." });
  }

  if (!SERVICE_ROLE_KEY) {
    return send(res, 500, { error: "SUPABASE_SERVICE_ROLE_KEY není nastavený na Vercelu." });
  }

  const callerToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!callerToken) return send(res, 401, { error: "Chybí přihlášení." });

  const fullName = String(req.body?.full_name || "").trim().slice(0, 120);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = String(req.body?.role || "staff").toLowerCase();

  if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: "Neplatný e-mail." });
  if (!["manager", "staff"].includes(role)) return send(res, 400, { error: "Neplatná role." });

  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${callerToken}`
      }
    });

    if (!userResponse.ok) return send(res, 401, { error: "Přihlášení vypršelo." });
    const caller = await userResponse.json();

    let restaurantId = null;
    let callerRole = null;

    const membershipResponse = await supabase(`/rest/v1/restaurant_team?user_id=eq.${encodeURIComponent(caller.id)}&active=eq.true&select=restaurant_id,role&limit=1`);
    if (membershipResponse.ok) {
      const rows = await membershipResponse.json();
      if (rows[0]) {
        restaurantId = rows[0].restaurant_id;
        callerRole = String(rows[0].role || "").toLowerCase();
      }
    }

    if (!restaurantId) {
      const profileResponse = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=restaurant_id,role&limit=1`);
      if (profileResponse.ok) {
        const rows = await profileResponse.json();
        if (rows[0]) {
          restaurantId = rows[0].restaurant_id;
          callerRole = String(rows[0].role || "").toLowerCase();
        }
      }
    }

    if (!restaurantId || callerRole !== "owner") {
      return send(res, 403, { error: "Pozvat zaměstnance může pouze majitel." });
    }

    const existingResponse = await supabase(`/rest/v1/restaurant_team?restaurant_id=eq.${restaurantId}&email=eq.${encodeURIComponent(email)}&select=id,user_id,active&limit=1`);
    if (existingResponse.ok) {
      const existing = (await existingResponse.json())[0];
      if (existing?.active) return send(res, 409, { error: "Tento e-mail už je v týmu." });
    }

    const requestOrigin = req.headers.origin || `https://${req.headers.host}`;
    const appOrigin = String(process.env.APP_URL || requestOrigin).replace(/\/$/, "");
    const inviteRedirectUrl = `${appOrigin}/invite.html`;
    const inviteResponse = await supabase(`/auth/v1/invite?redirect_to=${encodeURIComponent(inviteRedirectUrl)}`, {
      method: "POST",
      body: JSON.stringify({
        email,
        data: { full_name: fullName, restaurant_id: restaurantId, role }
      })
    });

    const inviteData = await inviteResponse.json().catch(() => ({}));
    if (!inviteResponse.ok) {
      const message = String(inviteData.msg || inviteData.message || inviteData.error_description || "Pozvánku se nepodařilo odeslat.");
      return send(res, inviteResponse.status, { error: message });
    }

    const userId = inviteData.id || inviteData.user?.id || null;

    const teamResponse = await supabase(`/rest/v1/restaurant_team?on_conflict=restaurant_id,email`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        restaurant_id: Number(restaurantId),
        user_id: userId,
        email,
        full_name: fullName,
        role,
        active: true,
        invited_at: new Date().toISOString(),
        joined_at: null
      })
    });

    if (!teamResponse.ok) {
      return send(res, 500, { error: `Pozvánka odešla, ale člen týmu se neuložil: ${await teamResponse.text()}` });
    }

    // Profily používají i stávající RLS pravidla aplikace, proto ho vytvoříme hned.
    if (userId) {
      await supabase(`/rest/v1/profiles?on_conflict=id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ id: userId, restaurant_id: Number(restaurantId), role })
      });
    }

    return send(res, 200, {
      ok: true,
      message: `Pozvánka byla odeslána na ${email}.`
    });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: "Pozvánku se nepodařilo odeslat." });
  }
};
