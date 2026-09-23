const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://decpnnbaejxjbpmyjocs.supabase.co";

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";


function send(
  res,
  status,
  body
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  return res
    .status(status)
    .json(body);
}


function serviceHeaders(
  extra = {}
) {
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY není nastavený na Vercelu."
    );
  }

  return {
    apikey:
      SERVICE_ROLE_KEY,

    Authorization:
      `Bearer ${SERVICE_ROLE_KEY}`,

    "Content-Type":
      "application/json",

    ...extra
  };
}


async function supabase(
  path,
  options = {}
) {
  return fetch(
    `${SUPABASE_URL}${path}`,
    {
      ...options,

      headers:
        serviceHeaders(
          options.headers ||
          {}
        )
    }
  );
}


async function getAuthenticatedUser(
  req
) {
  const callerToken =
    String(
      req.headers.authorization ||
      ""
    ).replace(
      /^Bearer\s+/i,
      ""
    );

  if (!callerToken) {
    const error =
      new Error(
        "Chybí přihlášení."
      );

    error.status = 401;

    throw error;
  }

  const userResponse =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${callerToken}`
        }
      }
    );

  if (!userResponse.ok) {
    const error =
      new Error(
        "Přihlášení vypršelo."
      );

    error.status = 401;

    throw error;
  }

  return userResponse.json();
}


async function getOwnerContext(
  userId
) {
  const membershipResponse =
    await supabase(
      `/rest/v1/restaurant_team?user_id=eq.${encodeURIComponent(
        userId
      )}&active=eq.true&select=restaurant_id,role&limit=1`
    );

  if (!membershipResponse.ok) {
    const errorText =
      await membershipResponse
        .text()
        .catch(
          () => ""
        );

    throw new Error(
      errorText ||
      "Nepodařilo se ověřit členství v restauraci."
    );
  }

  const memberships =
    await membershipResponse.json();

  const membership =
    Array.isArray(
      memberships
    )
      ? memberships[0]
      : null;

  // Pokud aktivní team membership existuje,
  // je autoritativní. Manager/staff nesmí obejít
  // svou roli přes starý záznam v profiles.
  if (
    membership?.restaurant_id
  ) {
    const role =
      String(
        membership.role ||
        ""
      )
        .toLowerCase()
        .trim();

    if (role !== "owner") {
      const error =
        new Error(
          "Pozvat zaměstnance může pouze majitel."
        );

      error.status = 403;

      throw error;
    }

    return {
      restaurantId:
        Number(
          membership.restaurant_id
        ),

      role:
        "owner",

      source:
        "restaurant_team"
    };
  }

  // Historický owner může být vedený pouze v profiles.
  // Fallback je povolen výhradně pro ownera.
  const profileResponse =
    await supabase(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(
        userId
      )}&role=eq.owner&select=restaurant_id,role&limit=1`
    );

  if (!profileResponse.ok) {
    const errorText =
      await profileResponse
        .text()
        .catch(
          () => ""
        );

    throw new Error(
      errorText ||
      "Nepodařilo se ověřit profil majitele."
    );
  }

  const profiles =
    await profileResponse.json();

  const profile =
    Array.isArray(
      profiles
    )
      ? profiles[0]
      : null;

  if (
    !profile?.restaurant_id
  ) {
    const error =
      new Error(
        "Pozvat zaměstnance může pouze majitel."
      );

    error.status = 403;

    throw error;
  }

  return {
    restaurantId:
      Number(
        profile.restaurant_id
      ),

    role:
      "owner",

    source:
      "profiles"
  };
}


function getInviteRedirectUrl(req) {
  // Redirect nesmí být odvozený z Host / X-Forwarded-Host hlaviček,
  // protože ty nejsou vhodným bezpečnostním základem pro odkaz v e-mailu.
  // Produkce má používat explicitní APP_URL; Vercel URL je bezpečný fallback.
  const configuredBaseUrl =
    String(process.env.APP_URL || "").trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${String(process.env.VERCEL_PROJECT_PRODUCTION_URL).trim()}`
      : "") ||
    (process.env.VERCEL_URL
      ? `https://${String(process.env.VERCEL_URL).trim()}`
      : "");

  if (!configuredBaseUrl) {
    throw new Error(
      "Chybí APP_URL nebo Vercel deployment URL pro pozvánky."
    );
  }

  let baseUrl;

  try {
    baseUrl = new URL(configuredBaseUrl);
  } catch (_) {
    throw new Error(
      "APP_URL / Vercel deployment URL nemá platný formát."
    );
  }

  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
    throw new Error(
      "Adresa aplikace pro pozvánky musí používat HTTPS."
    );
  }

  baseUrl.pathname = "/invite.html";
  baseUrl.search = "";
  baseUrl.hash = "";

  return baseUrl.toString();
}

module.exports =
  async function handler(
    req,
    res
  ) {
    if (
      req.method !== "POST"
    ) {
      res.setHeader(
        "Allow",
        "POST"
      );

      return send(
        res,
        405,
        {
          error:
            "Použij POST."
        }
      );
    }

    if (!SERVICE_ROLE_KEY) {
      return send(
        res,
        500,
        {
          error:
            "SUPABASE_SERVICE_ROLE_KEY není nastavený na Vercelu."
        }
      );
    }

    const fullName =
      String(
        req.body?.full_name ||
        ""
      )
        .trim()
        .slice(
          0,
          120
        );

    const email =
      String(
        req.body?.email ||
        ""
      )
        .trim()
        .toLowerCase()
        .slice(
          0,
          320
        );

    const role =
      String(
        req.body?.role ||
        "staff"
      )
        .toLowerCase()
        .trim();

    if (
      !fullName ||
      fullName.length < 2
    ) {
      return send(
        res,
        400,
        {
          error:
            "Zadej jméno člena týmu."
        }
      );
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
      )
    ) {
      return send(
        res,
        400,
        {
          error:
            "Neplatný e-mail."
        }
      );
    }

    if (
      ![
        "manager",
        "staff"
      ].includes(role)
    ) {
      return send(
        res,
        400,
        {
          error:
            "Neplatná role."
        }
      );
    }

    try {
      const caller =
        await getAuthenticatedUser(
          req
        );

      const ownerContext =
        await getOwnerContext(
          caller.id
        );

      const restaurantId =
        ownerContext.restaurantId;

      const existingResponse =
        await supabase(
          `/rest/v1/restaurant_team?restaurant_id=eq.${restaurantId}&email=eq.${encodeURIComponent(
            email
          )}&select=id,user_id,active&limit=1`
        );

      if (
        !existingResponse.ok
      ) {
        throw new Error(
          await existingResponse
            .text()
            .catch(
              () =>
                "Nepodařilo se ověřit stávajícího člena týmu."
            )
        );
      }

      const existingRows =
        await existingResponse.json();

      const existing =
        Array.isArray(
          existingRows
        )
          ? existingRows[0]
          : null;

      if (
        existing?.active
      ) {
        return send(
          res,
          409,
          {
            error:
              "Tento e-mail už je v týmu."
          }
        );
      }

      const redirectTo =
        getInviteRedirectUrl(
          req
        );

      const inviteResponse =
        await supabase(
          `/auth/v1/invite?redirect_to=${encodeURIComponent(
            redirectTo
          )}`,
          {
            method:
              "POST",

            body:
              JSON.stringify({
                email,

                data: {
                  full_name:
                    fullName,

                  restaurant_id:
                    restaurantId,

                  role
                }
              })
          }
        );

      const inviteData =
        await inviteResponse
          .json()
          .catch(
            () => ({})
          );

      if (
        !inviteResponse.ok
      ) {
        const message =
          String(
            inviteData.msg ||
            inviteData.message ||
            inviteData.error_description ||
            "Pozvánku se nepodařilo odeslat."
          );

        return send(
          res,
          inviteResponse.status,
          {
            error:
              message
          }
        );
      }

      const userId =
        inviteData.id ||
        inviteData.user?.id ||
        null;

      const teamResponse =
        await supabase(
          `/rest/v1/restaurant_team?on_conflict=restaurant_id,email`,
          {
            method:
              "POST",

            headers: {
              Prefer:
                "resolution=merge-duplicates,return=representation"
            },

            body:
              JSON.stringify({
                restaurant_id:
                  restaurantId,

                user_id:
                  userId,

                email,

                full_name:
                  fullName,

                role,

                active:
                  true,

                invited_at:
                  new Date()
                    .toISOString(),

                joined_at:
                  null
              })
          }
        );

      if (
        !teamResponse.ok
      ) {
        console.error(
          "Pozvánka odešla, ale člen týmu se neuložil:",
          await teamResponse.text()
        );

        return send(
          res,
          500,
          {
            error:
              "Pozvánka odešla, ale člen týmu se nepodařilo uložit. Zkuste pozvání zopakovat."
          }
        );
      }

      // Profily používají i stávající RLS pravidla aplikace,
      // proto profil připravíme hned, pokud Supabase vrátil user ID.
      if (userId) {
        const profileResponse =
          await supabase(
            `/rest/v1/profiles?on_conflict=id`,
            {
              method:
                "POST",

              headers: {
                Prefer:
                  "resolution=merge-duplicates"
              },

              body:
                JSON.stringify({
                  id:
                    userId,

                  restaurant_id:
                    restaurantId,

                  role
                })
            }
          );

        if (
          !profileResponse.ok
        ) {
          console.error(
            "Pozvánka a team row byly vytvořeny, ale profil se nepodařilo připravit:",
            await profileResponse.text()
          );
        }
      }

      return send(
        res,
        200,
        {
          ok: true,

          message:
            `Pozvánka byla odeslána na ${email}.`
        }
      );
    } catch (error) {
      console.error(
        "Chyba při pozvání člena týmu:",
        error
      );

      const status =
        Number(
          error?.status
        ) >= 400 &&
        Number(
          error?.status
        ) < 600
          ? Number(
              error.status
            )
          : 500;

      return send(
        res,
        status,
        {
          error:
            error?.message ||
            "Pozvánku se nepodařilo odeslat."
        }
      );
    }
  };
