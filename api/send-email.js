import { createHash } from "node:crypto";
const RESEND_API_URL = "https://api.resend.com/emails";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://decpnnbaejxjbpmyjocs.supabase.co";

const SUPABASE_PUBLIC_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_l6ko8NS_92RjQBM2rEzAvA_Sd2hYicb";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const RESTAURANT_TIME_ZONE =
  process.env.RESTAURANT_TIME_ZONE || "Europe/Prague";


function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function formatDate(date) {
  if (!date) return "";

  const [year, month, day] = String(date).split("-");

  return year && month && day
    ? `${day}.${month}.${year}`
    : String(date);
}


function cleanSlug(value) {
  return String(value || "").trim();
}


function isValidDateString(value) {
  const raw = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return false;
  }

  const parsed = new Date(`${raw}T12:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === raw
  );
}


function publicErrorMessage(error, fallback) {
  const status = mapReservationError(error);

  return status >= 500
    ? fallback
    : String(error?.message || fallback);
}


function dashboardErrorMessage(
  error,
  fallback
) {
  const status =
    Number(
      error?.status || 500
    );

  if (status === 401) {
    return "Přihlášení není platné. Přihlas se prosím znovu.";
  }

  if (status === 403) {
    return "K této akci nemáš oprávnění.";
  }

  if (status >= 500) {
    return fallback;
  }

  const message =
    String(
      error?.message || ""
    ).trim();

  if (
    !message ||
    /(?:PGRST|row-level|row level|supabase|schema cache|relation |column |jwt)/i.test(
      message
    )
  ) {
    return fallback;
  }

  return message;
}


function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(value || "").trim()
  );
}


function serviceHeaders(extra = {}) {
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      "Ve Vercelu chybí SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}


function publicHeaders(extra = {}) {
  return {
    apikey: SUPABASE_PUBLIC_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLIC_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}


async function supabaseServiceJson(path, options = {}) {
  const response = await fetch(
    `${SUPABASE_URL}${path}`,
    {
      ...options,
      headers: serviceHeaders(
        options.headers || {}
      )
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      typeof data === "string"
        ? data
        : data?.message ||
          data?.error ||
          data?.hint ||
          `Supabase chyba ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}


async function supabasePublicRpc(
  functionName,
  body
) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(
      functionName
    )}`,
    {
      method: "POST",
      headers: publicHeaders({
        Prefer: "return=representation"
      }),
      body: JSON.stringify(body)
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      typeof data === "string"
        ? data
        : data?.message ||
          data?.error ||
          data?.hint ||
          `Supabase RPC chyba ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}


async function getPublishedRestaurantBySlug(
  slug
) {
  const clean = cleanSlug(slug);

  if (!clean) {
    throw new Error(
      "V požadavku chybí slug restaurace."
    );
  }

  const rows = await supabaseServiceJson(
    `/rest/v1/restaurants?slug=eq.${encodeURIComponent(
      clean
    )}&is_published=eq.true&select=id,name,slug,address,phone,email,logo_url,short_description,website_url,accent_color,is_published&limit=1`,
    {
      method: "GET"
    }
  );

  const restaurant =
    Array.isArray(rows)
      ? rows[0]
      : null;

  if (!restaurant?.id) {
    const error = new Error(
      "Restaurace neexistuje nebo není zveřejněná."
    );

    error.status = 404;

    throw error;
  }

  return restaurant;
}


async function getRestaurantById(
  restaurantId
) {
  const rows = await supabaseServiceJson(
    `/rest/v1/restaurants?id=eq.${Number(
      restaurantId
    )}&select=id,name,slug,address,phone,email,logo_url,short_description,website_url,accent_color,is_published&limit=1`,
    {
      method: "GET"
    }
  );

  const restaurant =
    Array.isArray(rows)
      ? rows[0]
      : null;

  if (!restaurant?.id) {
    const error = new Error(
      "Restaurace neexistuje."
    );

    error.status = 404;

    throw error;
  }

  return restaurant;
}


function timeToMinutes(value) {
  const [h, m] = String(
    value || "00:00"
  )
    .slice(0, 5)
    .split(":")
    .map(Number);

  return (
    Number(h) * 60 +
    Number(m)
  );
}


function getRestaurantNow(
  date = new Date()
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          RESTAURANT_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }
    ).formatToParts(date);

  const values =
    Object.fromEntries(
      parts
        .filter(
          part =>
            part.type !== "literal"
        )
        .map(
          part => [
            part.type,
            part.value
          ]
        )
    );

  return {
    date:
      `${values.year}-${values.month}-${values.day}`,

    minutes:
      Number(values.hour) * 60 +
      Number(values.minute)
  };
}


function getDurationByPeople(
  people,
  settings = {}
) {
  const count =
    Number(people || 1);

  if (count <= 2) {
    return Math.max(
      30,
      Number(
        settings.duration_1_2 ||
        90
      )
    );
  }

  if (count <= 4) {
    return Math.max(
      30,
      Number(
        settings.duration_3_4 ||
        90
      )
    );
  }

  if (count <= 6) {
    return Math.max(
      30,
      Number(
        settings.duration_5_6 ||
        150
      )
    );
  }

  return Math.max(
    30,
    Number(
      settings.duration_7_plus ||
      180
    )
  );
}


function effectiveDuration(
  reservation,
  settings
) {
  const stored =
    Number(
      reservation
        ?.duration_minutes || 0
    );

  const byPeople =
    getDurationByPeople(
      reservation?.people,
      settings
    );

  return Math.max(
    30,
    Number.isFinite(stored)
      ? stored
      : 0,
    byPeople
  );
}


function overlaps(
  a,
  b,
  settings
) {
  if (
    String(a.date) !==
    String(b.date)
  ) {
    return false;
  }

  const aStart =
    timeToMinutes(a.time);

  const bStart =
    timeToMinutes(b.time);

  const aEnd =
    aStart +
    effectiveDuration(
      a,
      settings
    );

  const bEnd =
    bStart +
    effectiveDuration(
      b,
      settings
    );

  return (
    aStart < bEnd &&
    bStart < aEnd
  );
}


function mapReservationError(
  error
) {
  const message =
    String(
      error?.message || ""
    );

  if (
    message.includes(
      "již rezervovan"
    ) ||
    message.includes(
      "blokovaný"
    ) ||
    message.includes(
      "zavřená"
    ) ||
    message.includes(
      "minimální předstih"
    ) ||
    message.includes(
      "příliš daleko"
    ) ||
    message.includes(
      "Neplatný počet hostů"
    ) ||
    message.includes(
      "Stůl neexistuje"
    ) ||
    message.includes(
      "Skupina stolů neexistuje"
    )
  ) {
    return 409;
  }

  if (
    message.includes(
      "Jméno je povinné"
    ) ||
    message.includes(
      "Neplatný formát času"
    ) ||
    message.includes(
      "Je nutný telefon nebo e-mail"
    ) ||
    message.includes(
      "Nelze současně vybrat"
    )
  ) {
    return 400;
  }

  if (
    message.includes(
      "Restaurace neexistuje"
    ) ||
    message.includes(
      "není zveřejněná"
    )
  ) {
    return 404;
  }

  return (
    Number(error?.status) >= 400 &&
    Number(error?.status) < 500
  )
    ? Number(error.status)
    : 500;
}


function reservationEmailHtml({
  restaurantName,
  title,
  message,
  locale = "cs",
  name,
  lastName,
  date,
  time,
  people,
  placeName,
  statusLabel
}) {
  const labels = locale === "en"
    ? { greeting: "Hello", details: "Reservation details", restaurant: "Restaurant", date: "Date", time: "Time", people: "Guests", table: "Table", status: "Status", footer: "This email was sent automatically by the restaurant." }
    : { greeting: "Dobrý den", details: "Detail rezervace", restaurant: "Restaurace", date: "Datum", time: "Čas", people: "Počet osob", table: "Stůl", status: "Stav", footer: "Tento e-mail byl odeslán automaticky systémem restaurace." };
  const fullName =
    `${String(
      name || ""
    ).trim()} ${String(
      lastName || ""
    ).trim()}`.trim();

  return `
<!doctype html>
<html lang="${locale === "en" ? "en" : "cs"}">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >
  <title>${escapeHtml(title)}</title>
</head>

<body
  style="
    margin:0;
    background:#0f172a;
    font-family:Arial,Helvetica,sans-serif;
    color:#e5e7eb;
  "
>
  <div
    style="
      max-width:620px;
      margin:0 auto;
      padding:32px 16px;
    "
  >
    <div
      style="
        background:#111827;
        border:1px solid #374151;
        border-radius:20px;
        overflow:hidden;
      "
    >
      <div
        style="
          padding:24px;
          background:
            linear-gradient(
              135deg,
              #f97316,
              #ea580c
            );
          color:white;
        "
      >
        <div
          style="
            font-size:14px;
            font-weight:700;
            opacity:.9;
          "
        >
          AI Restaurace PRO
        </div>

        <h1
          style="
            margin:8px 0 0;
            font-size:28px;
            line-height:1.2;
          "
        >
          ${escapeHtml(title)}
        </h1>
      </div>

      <div style="padding:26px;">
        <p
          style="
            margin:0 0 18px;
            font-size:16px;
            line-height:1.6;
          "
        >
          ${labels.greeting}${
            fullName
              ? `${locale === "en" ? " " : ", "}${escapeHtml(
                  fullName
                )}`
              : ""
          },
        </p>

        <p
          style="
            margin:0 0 22px;
            font-size:16px;
            line-height:1.6;
            color:#d1d5db;
          "
        >
          ${escapeHtml(message)}
        </p>

        <div
          style="
            background:#0b1220;
            border:1px solid #273449;
            border-radius:16px;
            padding:18px;
          "
        >
          <div
            style="
              margin-bottom:14px;
              font-size:13px;
              text-transform:uppercase;
              letter-spacing:.08em;
              color:#94a3b8;
            "
          >
            ${labels.details}
          </div>

          <table
            role="presentation"
            style="
              width:100%;
              border-collapse:collapse;
              font-size:15px;
              color:#e5e7eb;
            "
          >
            <tr>
              <td
                style="
                  padding:7px 0;
                  color:#94a3b8;
                "
              >
                ${labels.restaurant}
              </td>

              <td
                style="
                  padding:7px 0;
                  text-align:right;
                  font-weight:700;
                "
              >
                ${escapeHtml(
                  restaurantName
                )}
              </td>
            </tr>

            <tr>
              <td
                style="
                  padding:7px 0;
                  color:#94a3b8;
                "
              >
                ${labels.date}
              </td>

              <td
                style="
                  padding:7px 0;
                  text-align:right;
                  font-weight:700;
                "
              >
                ${escapeHtml(
                  formatDate(date)
                )}
              </td>
            </tr>

            <tr>
              <td
                style="
                  padding:7px 0;
                  color:#94a3b8;
                "
              >
                ${labels.time}
              </td>

              <td
                style="
                  padding:7px 0;
                  text-align:right;
                  font-weight:700;
                "
              >
                ${escapeHtml(
                  String(
                    time || ""
                  ).slice(
                    0,
                    5
                  )
                )}
              </td>
            </tr>

            <tr>
              <td
                style="
                  padding:7px 0;
                  color:#94a3b8;
                "
              >
                ${labels.people}
              </td>

              <td
                style="
                  padding:7px 0;
                  text-align:right;
                  font-weight:700;
                "
              >
                ${escapeHtml(
                  people
                )}
              </td>
            </tr>

            ${
              placeName
                ? `
            <tr>
              <td
                style="
                  padding:7px 0;
                  color:#94a3b8;
                "
              >
                ${labels.table}
              </td>

              <td
                style="
                  padding:7px 0;
                  text-align:right;
                  font-weight:700;
                "
              >
                ${escapeHtml(
                  placeName
                )}
              </td>
            </tr>
            `
                : ""
            }

            <tr>
              <td
                style="
                  padding:7px 0;
                  color:#94a3b8;
                "
              >
                ${labels.status}
              </td>

              <td
                style="
                  padding:7px 0;
                  text-align:right;
                  font-weight:700;
                  color:#fb923c;
                "
              >
                ${escapeHtml(
                  statusLabel
                )}
              </td>
            </tr>
          </table>
        </div>

        <p
          style="
            margin:22px 0 0;
            font-size:13px;
            line-height:1.5;
            color:#94a3b8;
          "
        >
          ${labels.footer}
        </p>
      </div>
    </div>
  </div>
</body>
</html>
`;
}


async function sendResendEmail({
  to,
  subject,
  html,
  replyTo
}) {
  const apiKey =
    String(
      process.env.RESEND_API_KEY ||
      ""
    ).trim();

  if (!apiKey) {
    throw new Error(
      "Ve Vercelu chybí RESEND_API_KEY."
    );
  }

  if (!isValidEmail(to)) {
    throw new Error(
      "Rezervace nemá platný e-mail zákazníka."
    );
  }

  const response =
    await fetch(
      RESEND_API_URL,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${apiKey}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          from:
            process.env
              .RESEND_FROM_EMAIL ||
            "AI Restaurace PRO <rezervace@rajanbentekfa.com>",

          to:
            Array.isArray(to)
              ? to
              : [to],

          subject,

          html,

          ...(replyTo
            ? {
                reply_to:
                  replyTo
              }
            : {})
        })
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    const error =
      new Error(
        data?.message ||
        data?.error ||
        "Resend odmítl odeslání e-mailu."
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}


async function sendReservationCreatedEmail({
  restaurant,
  email,
  locale = "cs",
  name,
  lastName,
  date,
  time,
  people,
  placeName
}) {
  return sendResendEmail({
    to: email,

    subject:
      locale === "en"
        ? `Reservation received – ${restaurant.name}`
        : `Rezervaci jsme přijali – ${restaurant.name}`,

    html:
      reservationEmailHtml({
        locale,
        restaurantName:
          restaurant.name,

        title:
          locale === "en" ? "Reservation received" : "Rezervaci jsme přijali",

        message:
          locale === "en"
            ? "Your reservation has been received and is awaiting confirmation from the restaurant."
            : "Vaše rezervace byla úspěšně uložena a čeká na potvrzení restaurace.",

        name,
        lastName,
        date,
        time,
        people,
        placeName,

        statusLabel:
          locale === "en" ? "Pending" : "Čeká"
      })
  });
}


async function sendReservationStatusEmail({
  restaurant,
  reservation,
  placeName,
  status
}) {
  const confirmed =
    status === "Potvrzeno";
  const locale = reservation.locale === "en" ? "en" : "cs";

  return sendResendEmail({
    to:
      reservation.email,

    subject:
      locale === "en"
        ? `${confirmed ? "Reservation confirmed" : "Reservation cancelled"} – ${restaurant.name}`
        : `${confirmed ? "Rezervace potvrzena" : "Rezervace zrušena"} – ${restaurant.name}`,

    html:
      reservationEmailHtml({
        locale,
        restaurantName:
          restaurant.name,

        title:
          locale === "en"
            ? confirmed ? "Reservation confirmed" : "Reservation cancelled"
            : confirmed ? "Rezervace potvrzena" : "Rezervace zrušena",

        message:
          locale === "en"
            ? confirmed
              ? "The restaurant has confirmed your reservation. We look forward to your visit."
              : "The restaurant has cancelled your reservation. If you need another time, please make a new reservation."
            : confirmed
              ? "Restaurace vaši rezervaci potvrdila. Těšíme se na vaši návštěvu."
              : "Restaurace vaši rezervaci zrušila. Pokud potřebujete nový termín, vytvořte prosím novou rezervaci.",

        name:
          reservation.name,

        lastName:
          reservation.last_name,

        date:
          reservation.date,

        time:
          reservation.time,

        people:
          reservation.people,

        placeName,

        statusLabel:
          locale === "en" ? confirmed ? "Confirmed" : "Cancelled" : status
      })
  });
}


function getRequestBearerToken(
  req
) {
  const authorization =
    String(
      req.headers
        ?.authorization || ""
    ).trim();

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );

  const token =
    match?.[1]?.trim();

  if (!token) {
    const error =
      new Error(
        "Chybí přihlášení uživatele."
      );

    error.status = 401;
    throw error;
  }

  return token;
}


async function supabaseUserJson(
  path,
  accessToken,
  options = {}
) {
  const response =
    await fetch(
      `${SUPABASE_URL}${path}`,
      {
        ...options,
        headers: {
          apikey:
            SUPABASE_PUBLIC_KEY,
          Authorization:
            `Bearer ${accessToken}`,
          "Content-Type":
            "application/json",
          ...(
            options.headers ||
            {}
          )
        }
      }
    );

  const text =
    await response.text();

  let data = null;

  try {
    data =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error =
      new Error(
        typeof data ===
          "string"
          ? data
          : data?.message ||
            data?.error ||
            data?.hint ||
            `Supabase chyba ${response.status}`
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}


async function getAuthenticatedUser(
  req
) {
  const token =
    getRequestBearerToken(
      req
    );

  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",

        headers: {
          apikey:
            SUPABASE_PUBLIC_KEY,

          Authorization:
            `Bearer ${token}`
        }
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (
    !response.ok ||
    !data?.id
  ) {
    const error =
      new Error(
        "Přihlášení uživatele není platné."
      );

    error.status = 401;

    throw error;
  }

  return data;
}


async function assertActiveRestaurantMember(
  userId,
  restaurantId
) {
  const rows =
    await supabaseServiceJson(
      `/rest/v1/restaurant_team?restaurant_id=eq.${Number(
        restaurantId
      )}&user_id=eq.${encodeURIComponent(
        userId
      )}&active=eq.true&select=user_id,role&limit=1`,

      {
        method: "GET"
      }
    );

  const membership =
    Array.isArray(rows)
      ? rows[0]
      : null;

  if (!membership?.user_id) {
    const error =
      new Error(
        "Pro tuto restauraci nemáš aktivní oprávnění."
      );

    error.status = 403;

    throw error;
  }

  return membership;
}

async function assertRestaurantAccess(
  userId,
  restaurantId
) {
  try {
    return await assertActiveRestaurantMember(
      userId,
      restaurantId
    );
  } catch (error) {
    if (
      Number(
        error?.status || 0
      ) !== 403
    ) {
      throw error;
    }
  }

  const ownerRows =
    await supabaseServiceJson(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(
        userId
      )}&restaurant_id=eq.${Number(
        restaurantId
      )}&role=eq.owner&select=id,restaurant_id,role&limit=1`,
      {
        method:
          "GET"
      }
    );

  const ownerProfile =
    Array.isArray(ownerRows)
      ? ownerRows[0]
      : null;

  if (
    ownerProfile?.id &&
    Number(
      ownerProfile.restaurant_id
    ) === Number(
      restaurantId
    )
  ) {
    return {
      user_id:
        userId,
      restaurant_id:
        Number(
          restaurantId
        ),
      role:
        "owner"
    };
  }

  const error =
    new Error(
      "Pro tuto restauraci nemáš aktivní oprávnění."
    );

  error.status =
    403;

  throw error;
}


async function getReservationPlaceName(
  reservation
) {
  if (
    reservation?.table_id
  ) {
    const rows =
      await supabaseServiceJson(
        `/rest/v1/restaurant_tables?id=eq.${Number(
          reservation.table_id
        )}&restaurant_id=eq.${Number(
          reservation.restaurant_id
        )}&select=name&limit=1`,

        {
          method: "GET"
        }
      );

    return (
      Array.isArray(rows) &&
      rows[0]?.name
    )
      ? rows[0].name
      : `Stůl ${reservation.table_id}`;
  }

  if (
    reservation
      ?.table_group_id
  ) {
    const rows =
      await supabaseServiceJson(
        `/rest/v1/table_groups?id=eq.${Number(
          reservation.table_group_id
        )}&restaurant_id=eq.${Number(
          reservation.restaurant_id
        )}&select=name&limit=1`,

        {
          method: "GET"
        }
      );

    return (
      Array.isArray(rows) &&
      rows[0]?.name
    )
      ? rows[0].name
      : "Skupina stolů";
  }

  return "";
}


async function getDashboardRestaurantInfoOnServer(
  req,
  res
) {
  const restaurantId =
    Number(
      req.body?.restaurant_id
    );

  if (
    !Number.isInteger(
      restaurantId
    ) ||
    restaurantId < 1
  ) {
    return res
      .status(400)
      .json({
        error:
          "Neplatná restaurace."
      });
  }

  try {
    const user =
      await getAuthenticatedUser(
        req
      );

    await assertRestaurantAccess(
      user.id,
      restaurantId
    );

    const restaurant =
      await getRestaurantById(
        restaurantId
      );

    return res
      .status(200)
      .json({
        success:
          true,
        restaurant: {
          id:
            Number(
              restaurant.id
            ),
          name:
            String(
              restaurant.name ||
              "Restaurace"
            ),
          slug:
            String(
              restaurant.slug ||
              ""
            ),
          is_published:
            restaurant.is_published ===
            true,
          address:
            String(
              restaurant.address || ""
            ),
          phone:
            String(
              restaurant.phone || ""
            ),
          email:
            String(
              restaurant.email || ""
            ),
          logo_url:
            String(
              restaurant.logo_url || ""
            ),
          short_description:
            String(
              restaurant.short_description || ""
            ),
          website_url:
            String(
              restaurant.website_url || ""
            ),
          accent_color:
            /^#[0-9a-fA-F]{6}$/.test(
              String(
                restaurant.accent_color || ""
              )
            )
              ? String(
                  restaurant.accent_color
                )
              : "#f59e0b",
          ai_enabled:
            Boolean(
              process.env.OPENAI_API_KEY
            )
        }
      });
  } catch (error) {
    console.error(
      "Chyba při načítání údajů restaurace pro dashboard:",
      error
    );

    const status =
      Number(
        error?.status || 500
      );

    return res
      .status(status)
      .json({
        error:
          status >= 500
            ? "Údaje restaurace se nepodařilo načíst."
            : String(
                error?.message ||
                "Nemáš přístup k této restauraci."
              )
      });
  }
}


async function getPublicRestaurantInfoOnServer(
  req,
  res
) {
  const cleanRestaurantSlug =
    cleanSlug(
      req.body?.slug || ""
    );

  if (
    !cleanRestaurantSlug ||
    cleanRestaurantSlug.length >
      120
  ) {
    return res
      .status(400)
      .json({
        error:
          "Chybí platná restaurace."
      });
  }

  try {
    const restaurant =
      await getPublishedRestaurantBySlug(
        cleanRestaurantSlug
      );

    const restaurantNow =
      getRestaurantNow();

    return res
      .status(200)
      .json({
        success:
          true,
        restaurant: {
          id:
            Number(
              restaurant.id
            ),
          name:
            String(
              restaurant.name ||
              "Restaurace"
            ),
          slug:
            String(
              restaurant.slug ||
              cleanRestaurantSlug
            ),
          address:
            String(
              restaurant.address || ""
            ),
          phone:
            String(
              restaurant.phone || ""
            ),
          email:
            String(
              restaurant.email || ""
            ),
          logo_url:
            String(
              restaurant.logo_url || ""
            ),
          short_description:
            String(
              restaurant.short_description || ""
            ),
          website_url:
            String(
              restaurant.website_url || ""
            ),
          accent_color:
            /^#[0-9a-fA-F]{6}$/.test(
              String(
                restaurant.accent_color || ""
              )
            )
              ? String(
                  restaurant.accent_color
                )
              : "#f59e0b"
        },
        restaurant_date:
          restaurantNow.date,
        time_zone:
          RESTAURANT_TIME_ZONE,
        ai_enabled:
          Boolean(
            process.env.OPENAI_API_KEY
          )
      });
  } catch (error) {
    console.error(
      "Chyba při načítání veřejných údajů restaurace:",
      error
    );

    return res
      .status(
        mapReservationError(
          error
        )
      )
      .json({
        error:
          publicErrorMessage(
            error,
            "Restauraci se nepodařilo načíst."
          )
      });
  }
}


async function getAvailableTimesOnServer(
  req,
  res
) {
  const {
    slug = "",
    people,
    date = ""
  } = req.body || {};

  const cleanRestaurantSlug =
    cleanSlug(slug);

  const peopleNumber =
    Number(people);

  if (
    !cleanRestaurantSlug ||
    cleanRestaurantSlug.length > 120 ||
    !isValidDateString(date) ||
    !Number.isInteger(
      peopleNumber
    ) ||
    peopleNumber < 1
  ) {
    return res
      .status(400)
      .json({
        error:
          "Chybí restaurace, datum nebo platný počet osob."
      });
  }

  try {
    const restaurant =
      await getPublishedRestaurantBySlug(
        cleanRestaurantSlug
      );

    const restaurantId =
      Number(
        restaurant.id
      );

    const dayOfWeek =
      new Date(
        `${date}T12:00:00`
      ).getDay();

    const [
      settingsRows,
      hoursRows,
      blocks,
      tables,
      tableGroups,
      reservations
    ] =
      await Promise.all([
        supabaseServiceJson(
          `/rest/v1/reservation_settings?restaurant_id=eq.${restaurantId}&select=*`,
          {
            method: "GET"
          }
        ),

        supabaseServiceJson(
          `/rest/v1/opening_hours?restaurant_id=eq.${restaurantId}&day_of_week=eq.${dayOfWeek}&select=is_open,open_time,close_time`,
          {
            method: "GET"
          }
        ),

        supabaseServiceJson(
          `/rest/v1/blocked_times?restaurant_id=eq.${restaurantId}&date=eq.${encodeURIComponent(
            date
          )}&select=start_time,end_time,reason`,
          {
            method: "GET"
          }
        ),

        supabaseServiceJson(
          `/rest/v1/restaurant_tables?restaurant_id=eq.${restaurantId}&active=eq.true&select=id,name,capacity,active,room&order=capacity.asc,id.asc`,
          {
            method: "GET"
          }
        ),

        supabaseServiceJson(
          `/rest/v1/table_groups?restaurant_id=eq.${restaurantId}&select=id,name,table_ids,total_capacity,room,active&order=total_capacity.asc,id.asc`,
          {
            method: "GET"
          }
        ),

        supabaseServiceJson(
          `/rest/v1/reservations?restaurant_id=eq.${restaurantId}&date=eq.${encodeURIComponent(
            date
          )}&status=neq.${encodeURIComponent(
            "Zrušeno"
          )}&select=id,date,time,duration_minutes,people,table_id,table_group_id,status`,
          {
            method: "GET"
          }
        )
      ]);

    const settings =
      Array.isArray(
        settingsRows
      ) &&
      settingsRows[0]
        ? settingsRows[0]
        : {};

    const hours =
      Array.isArray(
        hoursRows
      ) &&
      hoursRows[0]
        ? hoursRows[0]
        : null;

    if (
      !hours ||
      !hours.is_open
    ) {
      return res
        .status(200)
        .json({
          success: true,
          slots: [],

          message:
            "V tento den má restaurace zavřeno."
        });
    }

    const minPeople =
      Math.max(
        1,
        Number(
          settings.min_people ||
          1
        )
      );

    const maxPeople =
      Math.max(
        minPeople,
        Number(
          settings.max_people ||
          20
        )
      );

    if (
      peopleNumber <
        minPeople ||
      peopleNumber >
        maxPeople
    ) {
      return res
        .status(400)
        .json({
          error:
            `Počet osob musí být od ${minPeople} do ${maxPeople}.`
        });
    }

    const duration =
      getDurationByPeople(
        peopleNumber,
        settings
      );

    const minAdvanceMinutes =
      Math.max(
        0,
        Number(
          settings
            .min_advance_minutes ??
          60
        )
      );

    const maxAdvanceDays =
      Math.max(
        1,
        Number(
          settings
            .max_advance_days ||
          30
        )
      );

    const nowForLimit =
      getRestaurantNow();

    const maxAllowedDate =
      new Date(
        `${nowForLimit.date}T12:00:00`
      );

    maxAllowedDate.setDate(
      maxAllowedDate.getDate() +
      maxAdvanceDays
    );

    const maxAllowedDateString =
      [
        maxAllowedDate
          .getFullYear(),

        String(
          maxAllowedDate
            .getMonth() + 1
        ).padStart(
          2,
          "0"
        ),

        String(
          maxAllowedDate
            .getDate()
        ).padStart(
          2,
          "0"
        )
      ].join("-");

    if (
      date >
      maxAllowedDateString
    ) {
      return res
        .status(400)
        .json({
          error:
            `Rezervaci lze vytvořit maximálně ${maxAdvanceDays} dní dopředu.`
        });
    }

    const activeGroupedTableIds =
      new Set(
        (
          Array.isArray(tableGroups)
            ? tableGroups
            : []
        )
          .filter(
            group =>
              group.active !== false &&
              Array.isArray(
                group.table_ids
              )
          )
          .flatMap(
            group =>
              group.table_ids.map(
                Number
              )
          )
      );

    const singleCandidates =
      (
        Array.isArray(tables)
          ? tables
          : []
      ).filter(
        table =>
          Number(
            table.capacity
          ) >=
            peopleNumber &&
          !activeGroupedTableIds.has(
            Number(table.id)
          )
      );

    const activeTableIds =
      new Set(
        (
          Array.isArray(tables)
            ? tables
            : []
        ).map(
          table =>
            Number(table.id)
        )
      );

    const groupCandidates =
      (
        Array.isArray(
          tableGroups
        )
          ? tableGroups
          : []
      ).filter(
        group =>
          group.active !== false &&
          Number(
            group
              .total_capacity
          ) >=
            peopleNumber &&
          Array.isArray(
            group.table_ids
          ) &&
          group.table_ids
            .length >= 2 &&
          group.table_ids
            .map(Number)
            .every(
              id =>
                activeTableIds.has(
                  id
                )
            )
      );

    if (
      !singleCandidates.length &&
      !groupCandidates.length
    ) {
      return res
        .status(200)
        .json({
          success: true,
          slots: [],

          message:
            `Pro ${peopleNumber} osob není k dispozici vhodný stůl ani povolená skupina stolů.`
        });
    }

    const groupById =
      new Map(
        (
          Array.isArray(
            tableGroups
          )
            ? tableGroups
            : []
        ).map(
          group => [
            Number(
              group.id
            ),
            group
          ]
        )
      );

    const openMinutes =
      timeToMinutes(
        hours.open_time
      );

    const closeMinutes =
      timeToMinutes(
        hours.close_time
      );

    const restaurantNow =
      getRestaurantNow();

    const slots = [];

    for (
      let start =
        openMinutes;

      start + duration <=
        closeMinutes;

      start += 30
    ) {
      const slotTime =
        `${String(
          Math.floor(
            start / 60
          )
        ).padStart(
          2,
          "0"
        )}:` +
        `${String(
          start % 60
        ).padStart(
          2,
          "0"
        )}`;

      if (
        date <
        restaurantNow.date
      ) {
        continue;
      }

      if (
        date ===
          restaurantNow.date &&
        start <
          restaurantNow.minutes +
            minAdvanceMinutes
      ) {
        continue;
      }

      const end =
        start + duration;

      const blocked =
        (
          Array.isArray(blocks)
            ? blocks
            : []
        ).some(
          block => {
            const blockStart =
              timeToMinutes(
                block.start_time
              );

            const blockEnd =
              timeToMinutes(
                block.end_time
              );

            return (
              start <
                blockEnd &&
              blockStart <
                end
            );
          }
        );

      if (blocked) {
        continue;
      }

      const draft = {
        date,
        time:
          slotTime,
        people:
          peopleNumber,
        duration_minutes:
          duration
      };

      const occupiedIds =
        new Set();

      (
        Array.isArray(
          reservations
        )
          ? reservations
          : []
      ).forEach(
        existing => {
          if (
            !overlaps(
              draft,
              existing,
              settings
            )
          ) {
            return;
          }

          if (
            existing
              .table_group_id
          ) {
            const existingGroup =
              groupById.get(
                Number(
                  existing
                    .table_group_id
                )
              );

            (
              Array.isArray(
                existingGroup
                  ?.table_ids
              )
                ? existingGroup
                    .table_ids
                : []
            ).forEach(
              id =>
                occupiedIds.add(
                  Number(id)
                )
            );
          } else if (
            existing.table_id
          ) {
            occupiedIds.add(
              Number(
                existing
                  .table_id
              )
            );
          }
        }
      );

      const availableTable =
        singleCandidates.find(
          table =>
            !occupiedIds.has(
              Number(
                table.id
              )
            )
        ) || null;

      const availableGroup =
        !availableTable
          ? groupCandidates.find(
              group =>
                group.table_ids
                  .map(Number)
                  .every(
                    id =>
                      !occupiedIds.has(
                        id
                      )
                  )
            ) || null
          : null;

      if (
        availableTable ||
        availableGroup
      ) {
        slots.push(
          slotTime
        );
      }
    }

    return res
      .status(200)
      .json({
        success: true,

        restaurant: {
          id:
            restaurantId,

          slug:
            restaurant.slug,

          name:
            restaurant.name
        },

        slots,

        duration_minutes:
          duration,

        message:
          slots.length
            ? `${slots.length} volných termínů`
            : "Pro zvolený den a počet osob už není volný termín."
      });
  } catch (error) {
    console.error(
      "Chyba při načítání volných časů:",
      error
    );

    return res
      .status(
        mapReservationError(
          error
        )
      )
      .json({
        error:
          publicErrorMessage(
            error,
            "Volné časy se nepodařilo načíst."
          )
      });
  }
}


async function createReservationOnServer(
  req,
  res
) {
  const {
    slug = "",
    name = "",
    last_name = "",
    people,
    date = "",
    time = "",
    phone = "",
    email = "",
    note = "",
    locale = "cs"
  } = req.body || {};

  const cleanRestaurantSlug =
    cleanSlug(slug);

  const cleanName =
    String(name).trim();

  const cleanLastName =
    String(
      last_name
    ).trim();

  const cleanPhone =
    String(
      phone
    ).trim();

  const cleanEmail =
    String(
      email
    )
      .trim()
      .toLowerCase();

  const cleanNote =
    String(
      note || ""
    ).trim();

  const cleanLocale = locale === "en" ? "en" : "cs";

  const peopleNumber =
    Number(people);

  const cleanTime =
    String(
      time || ""
    )
      .trim()
      .slice(
        0,
        5
      );

  if (
    !cleanRestaurantSlug ||
    cleanRestaurantSlug.length > 120 ||
    !cleanName ||
    cleanName.length > 120 ||
    !cleanLastName ||
    cleanLastName.length > 120 ||
    !date ||
    !cleanTime ||
    !cleanPhone ||
    cleanPhone.length > 40 ||
    !cleanEmail ||
    cleanEmail.length > 320 ||
    cleanNote.length > 1000 ||
    !Number.isInteger(
      peopleNumber
    ) ||
    peopleNumber < 1
  ) {
    return res
      .status(400)
      .json({
        error:
          "Chybí povinné údaje rezervace."
      });
  }

  if (
    !isValidDateString(
      date
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "Neplatné datum rezervace."
      });
  }

  if (
    !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(
      cleanTime
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "Neplatný čas rezervace."
      });
  }

  if (
    !isValidEmail(
      cleanEmail
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "Zadej platný e-mail."
      });
  }

  try {
    const restaurant =
      await getPublishedRestaurantBySlug(
        cleanRestaurantSlug
      );

    const restaurantId =
      Number(
        restaurant.id
      );

    const [
      settingsRows,
      tables,
      tableGroups,
      reservations
    ] =
      await Promise.all([
        supabaseServiceJson(
          `/rest/v1/reservation_settings?restaurant_id=eq.${restaurantId}&select=*`,
          {
            method: "GET"
          }
        ),

        supabaseServiceJson(
          `/rest/v1/restaurant_tables?restaurant_id=eq.${restaurantId}&active=eq.true&select=id,name,capacity,active,room&order=capacity.asc,id.asc`,
          {
            method: "GET"
          }
        ),

        supabaseServiceJson(
          `/rest/v1/table_groups?restaurant_id=eq.${restaurantId}&select=id,name,table_ids,total_capacity,room,active&order=total_capacity.asc,id.asc`,
          {
            method: "GET"
          }
        ),

        supabaseServiceJson(
          `/rest/v1/reservations?restaurant_id=eq.${restaurantId}&date=eq.${encodeURIComponent(
            date
          )}&status=neq.${encodeURIComponent(
            "Zrušeno"
          )}&select=id,date,time,duration_minutes,people,table_id,table_group_id,status`,
          {
            method: "GET"
          }
        )
      ]);

    const settings =
      Array.isArray(
        settingsRows
      ) &&
      settingsRows[0]
        ? settingsRows[0]
        : {};

    const minPeople =
      Math.max(
        1,
        Number(
          settings.min_people ||
          1
        )
      );

    const maxPeople =
      Math.max(
        minPeople,
        Number(
          settings.max_people ||
          20
        )
      );

    if (
      peopleNumber <
        minPeople ||
      peopleNumber >
        maxPeople
    ) {
      return res
        .status(400)
        .json({
          error:
            `Počet osob musí být od ${minPeople} do ${maxPeople}.`
        });
    }

    const durationMinutes =
      getDurationByPeople(
        peopleNumber,
        settings
      );

    const activeGroupedTableIds =
      new Set(
        (
          Array.isArray(tableGroups)
            ? tableGroups
            : []
        )
          .filter(
            group =>
              group.active !== false &&
              Array.isArray(
                group.table_ids
              )
          )
          .flatMap(
            group =>
              group.table_ids.map(
                Number
              )
          )
      );

    const singleCandidates =
      (
        Array.isArray(tables)
          ? tables
          : []
      ).filter(
        table =>
          Number(
            table.capacity
          ) >=
            peopleNumber &&
          !activeGroupedTableIds.has(
            Number(table.id)
          )
      );

    const activeTableIds =
      new Set(
        (
          Array.isArray(tables)
            ? tables
            : []
        ).map(
          table =>
            Number(table.id)
        )
      );

    const groupCandidates =
      (
        Array.isArray(
          tableGroups
        )
          ? tableGroups
          : []
      ).filter(
        group =>
          group.active !== false &&
          Number(
            group
              .total_capacity
          ) >=
            peopleNumber &&
          Array.isArray(
            group.table_ids
          ) &&
          group.table_ids
            .length >= 2 &&
          group.table_ids
            .map(Number)
            .every(
              id =>
                activeTableIds.has(
                  id
                )
            )
      );

    if (
      !singleCandidates.length &&
      !groupCandidates.length
    ) {
      return res
        .status(409)
        .json({
          error:
            "Pro tento počet hostů není žádný vhodný aktivní stůl ani povolená skupina stolů."
        });
    }

    const draft = {
      date,
      time:
        cleanTime,
      people:
        peopleNumber,
      duration_minutes:
        durationMinutes
    };

    const groupById =
      new Map(
        (
          Array.isArray(
            tableGroups
          )
            ? tableGroups
            : []
        ).map(
          group => [
            Number(
              group.id
            ),
            group
          ]
        )
      );

    const occupied =
      new Set();

    (
      Array.isArray(
        reservations
      )
        ? reservations
        : []
    ).forEach(
      existing => {
        if (
          !overlaps(
            draft,
            existing,
            settings
          )
        ) {
          return;
        }

        if (
          existing
            .table_group_id
        ) {
          const existingGroup =
            groupById.get(
              Number(
                existing
                  .table_group_id
              )
            );

          (
            Array.isArray(
              existingGroup
                ?.table_ids
            )
              ? existingGroup
                  .table_ids
              : []
          ).forEach(
            id =>
              occupied.add(
                Number(id)
              )
          );
        } else if (
          existing.table_id
        ) {
          occupied.add(
            Number(
              existing
                .table_id
            )
          );
        }
      }
    );

    const selectedTable =
      singleCandidates.find(
        table =>
          !occupied.has(
            Number(
              table.id
            )
          )
      ) || null;

    const selectedGroup =
      !selectedTable
        ? groupCandidates.find(
            group =>
              group.table_ids
                .map(Number)
                .every(
                  id =>
                    !occupied.has(
                      id
                    )
                )
          ) || null
        : null;

    if (
      !selectedTable &&
      !selectedGroup
    ) {
      return res
        .status(409)
        .json({
          error:
            "V tomto čase není volný vhodný stůl ani povolená skupina stolů. Vyber jiný čas."
        });
    }

    // Ochrana veřejného rezervačního formuláře proti spamu.
    // Klíč je svázaný s restaurací + kontaktem zákazníka,
    // takže limit jedné restaurace neovlivní ostatní restaurace.
        // Druhá vrstva ochrany proti spamu podle IP adresy.
    const forwardedFor =
      String(
        req.headers?.["x-forwarded-for"] || ""
      ).trim();

    const realIp =
      String(
        req.headers?.["x-real-ip"] || ""
      ).trim();

    const clientIp =
      forwardedFor
        .split(",")[0]
        .trim() ||
      realIp;

    if (clientIp) {
      const clientIpHash =
  createHash("sha256")
    .update(clientIp)
    .digest("hex");

const ipRateKey =
  `reservation-ip:${restaurantId}:${clientIpHash}`;
      const ipRateLimitResult =
        await supabaseServiceJson(
          "/rest/v1/rpc/check_public_reservation_ip_rate_limit",
          {
            method: "POST",
            headers: {
              Prefer: "return=representation"
            },
            body: JSON.stringify({
              p_rate_key: ipRateKey
            })
          }
        );

      const ipRateLimitAllowed =
        Array.isArray(ipRateLimitResult)
          ? ipRateLimitResult[0]
          : ipRateLimitResult;

      if (ipRateLimitAllowed !== true) {
        return res
          .status(429)
          .json({
            error:
              "Z této sítě bylo odesláno příliš mnoho rezervací. Zkuste to prosím později."
          });
      }
    }
    const rateKey =
      `reservation:${restaurantId}:${cleanEmail}:${cleanPhone}`;

    const rateLimitResult =
      await supabaseServiceJson(
        "/rest/v1/rpc/check_public_reservation_rate_limit",
        {
          method: "POST",
          headers: {
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            p_rate_key: rateKey
          })
        }
      );

    const rateLimitAllowed =
      Array.isArray(rateLimitResult)
        ? rateLimitResult[0]
        : rateLimitResult;

    if (rateLimitAllowed !== true) {
      return res
        .status(429)
        .json({
          error:
            "Bylo odesláno příliš mnoho rezervací. Zkuste to prosím později."
        });
    }

    const rpcResult =
      await supabaseServiceJson(
        "/rest/v1/rpc/create_public_reservation_with_locale",
        {
          method: "POST",
          headers: {
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            p_slug:
              cleanRestaurantSlug,

            p_name:
              cleanName,

            p_people:
              peopleNumber,

            p_date:
              date,

            p_time:
              cleanTime,

            p_phone:
              cleanPhone,

            p_email:
              cleanEmail,

            p_note:
              cleanNote ||
              null,

            p_last_name:
              cleanLastName ||
              null,

            p_table_id:
              selectedTable
                ? Number(
                    selectedTable.id
                  )
                : null,

            p_table_group_id:
              selectedGroup
                ? Number(
                    selectedGroup.id
                  )
                : null,

            p_locale: cleanLocale
          })
        }
      );

    const inserted =
      Array.isArray(
        rpcResult
      )
        ? rpcResult[0] ||
          null
        : rpcResult ||
          null;

    const placeName =
      selectedTable?.name ||
      selectedGroup?.name ||
      "";

    let emailSent =
      false;

    try {
      await sendReservationCreatedEmail({
        restaurant,
        locale: cleanLocale,
        email:
          cleanEmail,
        name:
          cleanName,
        lastName:
          cleanLastName,
        date,
        time:
          cleanTime,
        people:
          peopleNumber,
        placeName
      });

      emailSent =
        true;
    } catch (
      emailError
    ) {
      console.error(
        "Rezervace byla vytvořena, ale potvrzovací e-mail se nepodařilo odeslat:",
        emailError
      );
    }

    return res
      .status(200)
      .json({
        success:
          true,

        apiVersion:
          "slug-rpc-v2-email",

        reservation:
          inserted,

        restaurant: {
          id:
            restaurantId,

          slug:
            restaurant.slug,

          name:
            restaurant.name
        },

        table:
          selectedTable
            ? {
                id:
                  Number(
                    selectedTable.id
                  ),

                name:
                  selectedTable.name,

                capacity:
                  Number(
                    selectedTable.capacity
                  ),

                type:
                  "table"
              }
            : {
                id:
                  Number(
                    selectedGroup.id
                  ),

                name:
                  selectedGroup.name,

                capacity:
                  Number(
                    selectedGroup.total_capacity
                  ),

                table_ids:
                  selectedGroup.table_ids.map(
                    Number
                  ),

                type:
                  "group"
              },

        email: {
          attempted:
            true,

          sent:
            emailSent
        }
      });
  } catch (error) {
    console.error(
      "Chyba při vytvoření rezervace:",
      error
    );

    return res
      .status(
        mapReservationError(
          error
        )
      )
      .json({
        error:
          publicErrorMessage(
            error,
            "Rezervaci se nepodařilo uložit."
          )
      });
  }
}


function dashboardReservationsOverlap(
  first,
  second
) {
  if (
    String(first?.date || "") !==
    String(second?.date || "")
  ) {
    return false;
  }

  const firstStart =
    timeToMinutes(
      first?.time
    );

  const secondStart =
    timeToMinutes(
      second?.time
    );

  const firstDuration =
    Math.max(
      30,
      Number(
        first?.duration_minutes ||
        120
      ) || 120
    );

  const secondDuration =
    Math.max(
      30,
      Number(
        second?.duration_minutes ||
        120
      ) || 120
    );

  return (
    firstStart <
      secondStart +
        secondDuration &&
    secondStart <
      firstStart +
        firstDuration
  );
}


async function validateDashboardReservationAvailabilityOnServer({
  restaurantId,
  reservationId,
  date,
  time,
  durationMinutes,
  tableId,
  tableGroupId,
  status
}) {
  if (
    status === "Zrušeno"
  ) {
    return;
  }

  const dayOfWeek =
    new Date(
      `${date}T12:00:00`
    ).getDay();

  const [
    hoursRows,
    blocks,
    tableGroups,
    reservations
  ] =
    await Promise.all([
      supabaseServiceJson(
        `/rest/v1/opening_hours?restaurant_id=eq.${restaurantId}&day_of_week=eq.${dayOfWeek}&select=is_open,open_time,close_time&limit=1`,
        {
          method:
            "GET"
        }
      ),
      supabaseServiceJson(
        `/rest/v1/blocked_times?restaurant_id=eq.${restaurantId}&date=eq.${encodeURIComponent(
          date
        )}&select=start_time,end_time,reason`,
        {
          method:
            "GET"
        }
      ),
      supabaseServiceJson(
        `/rest/v1/table_groups?restaurant_id=eq.${restaurantId}&select=id,table_ids,active`,
        {
          method:
            "GET"
        }
      ),
      supabaseServiceJson(
        `/rest/v1/reservations?restaurant_id=eq.${restaurantId}&date=eq.${encodeURIComponent(
          date
        )}&id=neq.${reservationId}&status=neq.${encodeURIComponent(
          "Zrušeno"
        )}&select=id,date,time,duration_minutes,table_id,table_group_id,status`,
        {
          method:
            "GET"
        }
      )
    ]);

  const hours =
    (
      Array.isArray(
        hoursRows
      ) &&
      hoursRows[0]
    )
      ? hoursRows[0]
      : {
          is_open:
            true,
          open_time:
            "10:00",
          close_time:
            "22:00"
        };

  if (
    hours.is_open ===
    false
  ) {
    const error =
      new Error(
        "V tento den má restaurace zavřeno."
      );

    error.status = 409;
    throw error;
  }

  const start =
    timeToMinutes(time);

  const end =
    start +
    Number(
      durationMinutes
    );

  const open =
    timeToMinutes(
      hours.open_time ||
      "10:00"
    );

  const close =
    timeToMinutes(
      hours.close_time ||
      "22:00"
    );

  if (
    start < open ||
    end > close
  ) {
    const error =
      new Error(
        `Rezervace musí celá proběhnout mezi ${String(
          hours.open_time ||
          "10:00"
        ).slice(0, 5)} a ${String(
          hours.close_time ||
          "22:00"
        ).slice(0, 5)}.`
      );

    error.status = 409;
    throw error;
  }

  const blocked =
    (
      Array.isArray(
        blocks
      )
        ? blocks
        : []
    ).find(
      block => {
        const blockStart =
          timeToMinutes(
            block?.start_time
          );

        const blockEnd =
          timeToMinutes(
            block?.end_time
          );

        return (
          start <
            blockEnd &&
          blockStart <
            end
        );
      }
    );

  if (blocked) {
    const error =
      new Error(
        blocked.reason
          ? `Čas zasahuje do blokace: ${String(
              blocked.reason
            ).slice(0, 300)}`
          : "Čas zasahuje do blokovaného období."
      );

    error.status = 409;
    throw error;
  }

  if (
    tableId === null &&
    tableGroupId === null
  ) {
    return;
  }

  const groups =
    Array.isArray(
      tableGroups
    )
      ? tableGroups
      : [];

  const groupById =
    new Map(
      groups.map(
        group => [
          Number(
            group.id
          ),
          group
        ]
      )
    );

  const getGroupMemberIds =
    groupId => {
      const group =
        groupById.get(
          Number(
            groupId
          )
        );

      return new Set(
        Array.isArray(
          group?.table_ids
        )
          ? group.table_ids
              .map(Number)
              .filter(
                id =>
                  Number.isInteger(
                    id
                  ) &&
                  id > 0
              )
          : []
      );
    };

  const proposedResourceIds =
    tableGroupId !== null
      ? getGroupMemberIds(
          tableGroupId
        )
      : new Set([
          Number(
            tableId
          )
        ]);

  if (
    tableGroupId !== null &&
    proposedResourceIds.size <
      2
  ) {
    const error =
      new Error(
        "Vybraná skupina stolů není platná."
      );

    error.status = 409;
    throw error;
  }

  const proposed = {
    date,
    time,
    duration_minutes:
      durationMinutes
  };

  const conflict =
    (
      Array.isArray(
        reservations
      )
        ? reservations
        : []
    ).find(
      existing => {
        if (
          !dashboardReservationsOverlap(
            proposed,
            existing
          )
        ) {
          return false;
        }

        let existingResourceIds =
          new Set();

        if (
          existing
            ?.table_group_id !==
            null &&
          existing
            ?.table_group_id !==
            undefined
        ) {
          existingResourceIds =
            getGroupMemberIds(
              existing
                .table_group_id
            );
        } else if (
          existing?.table_id
        ) {
          existingResourceIds =
            new Set([
              Number(
                existing
                  .table_id
              )
            ]);
        }

        for (
          const id of
          proposedResourceIds
        ) {
          if (
            existingResourceIds.has(
              id
            )
          ) {
            return true;
          }
        }

        return false;
      }
    );

  if (conflict) {
    const error =
      new Error(
        "Vybraný stůl nebo skupina stolů je v tomto čase už obsazená."
      );

    error.status = 409;
    throw error;
  }
}


async function createDashboardReservationOnServer(
  req,
  res
) {
  const restaurantId =
    Number(
      req.body?.restaurant_id
    );

  const name =
    String(
      req.body?.name || ""
    ).trim();

  const people =
    Number(
      req.body?.people
    );

  const date =
    String(
      req.body?.date || ""
    ).trim();

  const time =
    String(
      req.body?.time || ""
    )
      .trim()
      .slice(0, 5);

  const durationMinutes =
    Number(
      req.body?.duration_minutes
    );

  const phone =
    String(
      req.body?.phone || ""
    ).trim();

  const email =
    String(
      req.body?.email || ""
    )
      .trim()
      .toLowerCase();

  const note =
    String(
      req.body?.note || ""
    ).trim();

  const rawTableId =
    req.body?.table_id;

  const rawTableGroupId =
    req.body?.table_group_id;

  const tableId =
    rawTableId === null ||
    rawTableId === undefined ||
    rawTableId === ""
      ? null
      : Number(
          rawTableId
        );

  const tableGroupId =
    rawTableGroupId === null ||
    rawTableGroupId === undefined ||
    rawTableGroupId === ""
      ? null
      : Number(
          rawTableGroupId
        );

  if (
    !Number.isInteger(
      restaurantId
    ) ||
    restaurantId < 1 ||
    !name ||
    name.length > 120 ||
    !Number.isInteger(
      people
    ) ||
    people < 1 ||
    people > 30 ||
    !isValidDateString(
      date
    ) ||
    !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(
      time
    ) ||
    !Number.isFinite(
      durationMinutes
    ) ||
    durationMinutes < 30 ||
    durationMinutes > 360 ||
    phone.length > 40 ||
    email.length > 320 ||
    note.length > 1000 ||
    (
      email &&
      !isValidEmail(
        email
      )
    ) ||
    (
      tableId !== null &&
      (
        !Number.isInteger(
          tableId
        ) ||
        tableId < 1
      )
    ) ||
    (
      tableGroupId !== null &&
      (
        !Number.isInteger(
          tableGroupId
        ) ||
        tableGroupId < 1
      )
    ) ||
    (
      tableId !== null &&
      tableGroupId !== null
    ) ||
    (
      tableId === null &&
      tableGroupId === null
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "Některé údaje nové rezervace nejsou platné."
      });
  }

  try {
    const user =
      await getAuthenticatedUser(
        req
      );

    const callerToken =
      getRequestBearerToken(
        req
      );

    await assertRestaurantAccess(
      user.id,
      restaurantId
    );

    if (
      tableId !== null
    ) {
      const [
        tableRows,
        activeGroups
      ] =
        await Promise.all([
          supabaseServiceJson(
            `/rest/v1/restaurant_tables?id=eq.${tableId}&restaurant_id=eq.${restaurantId}&select=id,name,capacity,active&limit=1`,
            {
              method:
                "GET"
            }
          ),
          supabaseServiceJson(
            `/rest/v1/table_groups?restaurant_id=eq.${restaurantId}&active=eq.true&select=id,table_ids`,
            {
              method:
                "GET"
            }
          )
        ]);

      const table =
        Array.isArray(
          tableRows
        )
          ? tableRows[0]
          : null;

      if (
        !table?.id ||
        table.active ===
          false
      ) {
        return res
          .status(409)
          .json({
            error:
              "Vybraný stůl není aktivní nebo nepatří této restauraci."
          });
      }

      if (
        people >
        Number(
          table.capacity || 0
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "Vybraný stůl nemá dostatečnou kapacitu."
          });
      }

      const grouped =
        (
          Array.isArray(
            activeGroups
          )
            ? activeGroups
            : []
        ).some(
          group =>
            Array.isArray(
              group?.table_ids
            ) &&
            group.table_ids
              .map(Number)
              .includes(
                tableId
              )
        );

      if (grouped) {
        return res
          .status(409)
          .json({
            error:
              "Vybraný stůl je součástí aktivní skupiny stolů."
          });
      }
    }

    if (
      tableGroupId !== null
    ) {
      const [
        groupRows,
        activeTables
      ] =
        await Promise.all([
          supabaseServiceJson(
            `/rest/v1/table_groups?id=eq.${tableGroupId}&restaurant_id=eq.${restaurantId}&select=id,name,total_capacity,active,table_ids&limit=1`,
            {
              method:
                "GET"
            }
          ),
          supabaseServiceJson(
            `/rest/v1/restaurant_tables?restaurant_id=eq.${restaurantId}&active=eq.true&select=id`,
            {
              method:
                "GET"
            }
          )
        ]);

      const group =
        Array.isArray(
          groupRows
        )
          ? groupRows[0]
          : null;

      const memberIds =
        Array.isArray(
          group?.table_ids
        )
          ? group.table_ids
              .map(Number)
              .filter(
                id =>
                  Number.isInteger(
                    id
                  ) &&
                  id > 0
              )
          : [];

      const activeTableIds =
        new Set(
          (
            Array.isArray(
              activeTables
            )
              ? activeTables
              : []
          ).map(
            table =>
              Number(
                table.id
              )
          )
        );

      if (
        !group?.id ||
        group.active ===
          false ||
        memberIds.length < 2 ||
        !memberIds.every(
          id =>
            activeTableIds.has(
              id
            )
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "Vybraná skupina stolů není aktivní nebo nemá platné stoly."
          });
      }

      if (
        people >
        Number(
          group
            .total_capacity ||
          0
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "Vybraná skupina stolů nemá dostatečnou kapacitu."
          });
      }
    }

    await validateDashboardReservationAvailabilityOnServer({
      restaurantId,
      reservationId:
        0,
      date,
      time,
      durationMinutes,
      tableId,
      tableGroupId,
      status:
        "Čeká"
    });

    const insertedRows =
      await supabaseUserJson(
        `/rest/v1/reservations?select=id,restaurant_id,name,last_name,people,date,time,duration_minutes,phone,email,note,table_id,table_group_id,status`,
        callerToken,
        {
          method:
            "POST",
          headers: {
            Prefer:
              "return=representation"
          },
          body:
            JSON.stringify({
              restaurant_id:
                restaurantId,
              name,
              last_name:
                null,
              people,
              date,
              time,
              duration_minutes:
                durationMinutes,
              table_id:
                tableId,
              table_group_id:
                tableGroupId,
              phone,
              email,
              note,
              status:
                "Čeká"
            })
        }
      );

    const reservation =
      Array.isArray(
        insertedRows
      )
        ? insertedRows[0]
        : null;

    if (!reservation?.id) {
      return res
        .status(500)
        .json({
          error:
            "Rezervaci se nepodařilo uložit."
        });
    }

    return res
      .status(200)
      .json({
        success:
          true,
        reservation
      });
  } catch (error) {
    console.error(
      "Chyba při vytvoření dashboard rezervace:",
      error
    );

    const statusCode =
      Number(
        error?.status ||
        500
      );

    return res
      .status(
        statusCode >= 400 &&
        statusCode < 600
          ? statusCode
          : 500
      )
      .json({
        error:
          dashboardErrorMessage(
            error,
            "Rezervaci se nepodařilo uložit."
          )
      });
  }
}


async function updateReservationOnServer(
  req,
  res
) {
  const reservationId =
    Number(
      req.body?.reservation_id
    );

  const name =
    String(
      req.body?.name || ""
    ).trim();

  const lastName =
    req.body?.last_name ===
      null ||
    req.body?.last_name ===
      undefined
      ? null
      : String(
          req.body.last_name
        ).trim();

  const people =
    Number(
      req.body?.people
    );

  const date =
    String(
      req.body?.date || ""
    ).trim();

  const time =
    String(
      req.body?.time || ""
    )
      .trim()
      .slice(0, 5);

  const durationMinutes =
    Number(
      req.body?.duration_minutes
    );

  const status =
    String(
      req.body?.status || ""
    ).trim();

  const phone =
    String(
      req.body?.phone || ""
    ).trim();

  const email =
    String(
      req.body?.email || ""
    )
      .trim()
      .toLowerCase();

  const note =
    String(
      req.body?.note || ""
    ).trim();

  const rawTableId =
    req.body?.table_id;

  const rawTableGroupId =
    req.body?.table_group_id;

  const tableId =
    rawTableId === null ||
    rawTableId === undefined ||
    rawTableId === ""
      ? null
      : Number(rawTableId);

  const tableGroupId =
    rawTableGroupId === null ||
    rawTableGroupId === undefined ||
    rawTableGroupId === ""
      ? null
      : Number(rawTableGroupId);

  if (
    !Number.isInteger(
      reservationId
    ) ||
    reservationId < 1
  ) {
    return res
      .status(400)
      .json({
        error:
          "Neplatná rezervace."
      });
  }

  if (
    !name ||
    name.length > 120 ||
    (
      lastName !== null &&
      lastName.length > 120
    ) ||
    !Number.isInteger(
      people
    ) ||
    people < 1 ||
    people > 30 ||
    !isValidDateString(
      date
    ) ||
    !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(
      time
    ) ||
    !Number.isFinite(
      durationMinutes
    ) ||
    durationMinutes < 30 ||
    durationMinutes > 360 ||
    ![
      "Čeká",
      "Potvrzeno",
      "Zrušeno"
    ].includes(status) ||
    phone.length > 40 ||
    email.length > 320 ||
    note.length > 1000 ||
    (
      email &&
      !isValidEmail(email)
    ) ||
    (
      tableId !== null &&
      (
        !Number.isInteger(
          tableId
        ) ||
        tableId < 1
      )
    ) ||
    (
      tableGroupId !== null &&
      (
        !Number.isInteger(
          tableGroupId
        ) ||
        tableGroupId < 1
      )
    ) ||
    (
      tableId !== null &&
      tableGroupId !== null
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "Některé údaje rezervace nejsou platné."
      });
  }

  try {
    const user =
      await getAuthenticatedUser(
        req
      );

    const callerToken =
      getRequestBearerToken(
        req
      );

    const rows =
      await supabaseServiceJson(
        `/rest/v1/reservations?id=eq.${reservationId}&select=id,restaurant_id,status,date,time,duration_minutes,table_id,table_group_id&limit=1`,
        {
          method:
            "GET"
        }
      );

    const existing =
      Array.isArray(rows)
        ? rows[0]
        : null;

    if (!existing?.id) {
      return res
        .status(404)
        .json({
          error:
            "Rezervace neexistuje."
        });
    }

    const restaurantId =
      Number(
        existing.restaurant_id
      );

    await assertRestaurantAccess(
      user.id,
      restaurantId
    );

    if (
      tableId !== null
    ) {
      const tableRows =
        await supabaseServiceJson(
          `/rest/v1/restaurant_tables?id=eq.${tableId}&restaurant_id=eq.${restaurantId}&select=id,name,capacity,active&limit=1`,
          {
            method:
              "GET"
          }
        );

      const table =
        Array.isArray(
          tableRows
        )
          ? tableRows[0]
          : null;

      if (!table?.id) {
        return res
          .status(400)
          .json({
            error:
              "Vybraný stůl nepatří této restauraci."
          });
      }

      if (
        Number(
          people
        ) >
        Number(
          table.capacity || 0
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "Vybraný stůl nemá dostatečnou kapacitu."
          });
      }

      if (
        table.active ===
          false &&
        Number(
          existing.table_id
        ) !== tableId
      ) {
        return res
          .status(409)
          .json({
            error:
              "Vybraný stůl není aktivní."
          });
      }

      if (
        Number(
          existing.table_id
        ) !== tableId
      ) {
        const activeGroups =
          await supabaseServiceJson(
            `/rest/v1/table_groups?restaurant_id=eq.${restaurantId}&active=eq.true&select=id,table_ids`,
            {
              method:
                "GET"
            }
          );

        const belongsToActiveGroup =
          (
            Array.isArray(
              activeGroups
            )
              ? activeGroups
              : []
          )
            .some(
              group =>
                Array.isArray(
                  group?.table_ids
                ) &&
                group.table_ids
                  .map(Number)
                  .includes(
                    tableId
                  )
            );

        if (
          belongsToActiveGroup
        ) {
          return res
            .status(409)
            .json({
              error:
                "Vybraný stůl je součástí aktivní skupiny stolů."
            });
        }
      }
    }

    if (
      tableGroupId !== null
    ) {
      const [
        groupRows,
        activeTables
      ] =
        await Promise.all([
          supabaseServiceJson(
            `/rest/v1/table_groups?id=eq.${tableGroupId}&restaurant_id=eq.${restaurantId}&select=id,name,total_capacity,active,table_ids&limit=1`,
            {
              method:
                "GET"
            }
          ),
          supabaseServiceJson(
            `/rest/v1/restaurant_tables?restaurant_id=eq.${restaurantId}&active=eq.true&select=id`,
            {
              method:
                "GET"
            }
          )
        ]);

      const group =
        Array.isArray(
          groupRows
        )
          ? groupRows[0]
          : null;

      const preservingCurrentGroup =
        Number(
          existing
            .table_group_id
        ) ===
        tableGroupId;

      const memberIds =
        Array.isArray(
          group?.table_ids
        )
          ? group.table_ids
              .map(Number)
              .filter(
                id =>
                  Number.isInteger(
                    id
                  ) &&
                  id > 0
              )
          : [];

      const activeTableIds =
        new Set(
          (
            Array.isArray(
              activeTables
            )
              ? activeTables
              : []
          ).map(
            table =>
              Number(
                table.id
              )
          )
        );

      if (!group?.id) {
        return res
          .status(400)
          .json({
            error:
              "Vybraná skupina stolů nepatří této restauraci."
          });
      }

      if (
        Number(
          people
        ) >
        Number(
          group.total_capacity || 0
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "Vybraná skupina stolů nemá dostatečnou kapacitu."
          });
      }

      if (
        !preservingCurrentGroup &&
        (
          group.active ===
            false ||
          memberIds.length < 2 ||
          !memberIds.every(
            id =>
              activeTableIds.has(
                id
              )
          )
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "Vybraná skupina stolů není aktivní nebo nemá platné aktivní stoly."
          });
      }
    }

    await validateDashboardReservationAvailabilityOnServer({
      restaurantId,
      reservationId,
      date,
      time,
      durationMinutes,
      tableId,
      tableGroupId,
      status
    });

    const previousStatus =
      String(
        existing.status ||
        "Čeká"
      );

    const previousTableFilter = existing.table_id == null
      ? "is.null"
      : `eq.${Number(existing.table_id)}`;
    const previousGroupFilter = existing.table_group_id == null
      ? "is.null"
      : `eq.${Number(existing.table_group_id)}`;

    const changedRows =
      await supabaseUserJson(
        `/rest/v1/reservations?id=eq.${reservationId}&restaurant_id=eq.${restaurantId}&status=eq.${encodeURIComponent(
          previousStatus
        )}&date=eq.${encodeURIComponent(String(existing.date))}&time=eq.${encodeURIComponent(String(existing.time))}&duration_minutes=eq.${Number(existing.duration_minutes)}&table_id=${previousTableFilter}&table_group_id=${previousGroupFilter}&select=id,restaurant_id,name,last_name,people,date,time,duration_minutes,email,phone,note,table_id,table_group_id,status,locale`,
        callerToken,
        {
          method:
            "PATCH",
          headers: {
            Prefer:
              "return=representation"
          },
          body:
            JSON.stringify({
              name,
              last_name:
                lastName,
              people,
              date,
              time,
              duration_minutes:
                durationMinutes,
              table_id:
                tableId,
              table_group_id:
                tableGroupId,
              phone,
              email,
              note,
              status
            })
        }
      );

    const reservation =
      Array.isArray(
        changedRows
      )
        ? changedRows[0]
        : null;

    if (!reservation?.id) {
      return res
        .status(409)
        .json({
          error:
            "Rezervace se mezitím změnila. Obnov data a zkus úpravu znovu."
        });
    }

    const statusChanged =
      previousStatus !==
      status;

    if (
      !statusChanged ||
      ![
        "Potvrzeno",
        "Zrušeno"
      ].includes(status)
    ) {
      return res
        .status(200)
        .json({
          success:
            true,
          changed:
            true,
          email_sent:
            false,
          reservation
        });
    }

    if (
      !isValidEmail(
        reservation.email
      )
    ) {
      return res
        .status(200)
        .json({
          success:
            true,
          changed:
            true,
          email_sent:
            false,
          email_error:
            "Rezervace nemá platný e-mail zákazníka.",
          reservation
        });
    }

    const [
      restaurant,
      placeName
    ] =
      await Promise.all([
        getRestaurantById(
          restaurantId
        ),
        getReservationPlaceName(
          reservation
        )
      ]);

    try {
      const emailResult =
        await sendReservationStatusEmail({
          restaurant,
          reservation,
          placeName,
          status
        });

      return res
        .status(200)
        .json({
          success:
            true,
          changed:
            true,
          email_sent:
            true,
          email_id:
            emailResult?.id ||
            null,
          reservation
        });
    } catch (
      emailError
    ) {
      console.error(
        "Rezervace byla upravena, ale stavový e-mail se nepodařilo odeslat:",
        emailError
      );

      return res
        .status(200)
        .json({
          success:
            true,
          changed:
            true,
          email_sent:
            false,
          email_error:
            "Rezervace byla uložena, ale e-mail se nepodařilo odeslat.",
          reservation
        });
    }
  } catch (error) {
    console.error(
      "Chyba při kompletní úpravě rezervace:",
      error
    );

    const statusCode =
      Number(
        error?.status ||
        500
      );

    return res
      .status(
        statusCode >= 400 &&
        statusCode < 600
          ? statusCode
          : 500
      )
      .json({
        error:
          dashboardErrorMessage(
            error,
            "Rezervaci se nepodařilo upravit."
          )
      });
  }
}


async function updateReservationStatusOnServer(
  req,
  res
) {
  const reservationId = Number(req.body?.reservation_id);
  const status = String(req.body?.status || "").trim();

  if (!Number.isInteger(reservationId) || reservationId < 1) {
    return res.status(400).json({ error: "Neplatné ID rezervace." });
  }

  if (!["Potvrzeno", "Zrušeno"].includes(status)) {
    return res.status(400).json({ error: "Neplatný stav rezervace." });
  }

  try {
    const user = await getAuthenticatedUser(req);
    const callerToken = getRequestBearerToken(req);

    // Nejdřív načteme rezervaci jen kvůli autorizaci restaurace.
    const rows = await supabaseServiceJson(
      `/rest/v1/reservations?id=eq.${reservationId}&select=id,restaurant_id,status&limit=1`,
      { method: "GET" }
    );

    const existing = Array.isArray(rows) ? rows[0] : null;

    if (!existing?.id) {
      return res.status(404).json({ error: "Rezervace neexistuje." });
    }

    await assertRestaurantAccess(user.id, existing.restaurant_id);

    if (String(existing.status) === status) {
      return res.status(200).json({
        success: true,
        changed: false,
        email_sent: false,
        reservation_id: reservationId,
        status
      });
    }

    // Změň pouze stav, který jsme skutečně přečetli. Dva souběžné
    // požadavky s různým cílovým stavem tak neodešlou protichůdné e-maily.
    const changedRows = await supabaseUserJson(
      `/rest/v1/reservations?id=eq.${reservationId}&restaurant_id=eq.${Number(existing.restaurant_id)}&status=eq.${encodeURIComponent(String(existing.status))}&select=id,restaurant_id,name,last_name,people,date,time,email,table_id,table_group_id,status,locale`,
      callerToken,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status })
      }
    );

    const reservation = Array.isArray(changedRows) ? changedRows[0] : null;

    if (!reservation?.id) {
      return res.status(200).json({
        success: true,
        changed: false,
        email_sent: false,
        reservation_id: reservationId,
        status
      });
    }

    if (!isValidEmail(reservation.email)) {
      return res.status(200).json({
        success: true,
        changed: true,
        email_sent: false,
        email_error: "Rezervace nemá platný e-mail zákazníka.",
        reservation_id: reservationId,
        status
      });
    }

    const [restaurant, placeName] = await Promise.all([
      getRestaurantById(reservation.restaurant_id),
      getReservationPlaceName(reservation)
    ]);

    try {
      const emailResult = await sendReservationStatusEmail({
        restaurant,
        reservation,
        placeName,
        status
      });

      return res.status(200).json({
        success: true,
        changed: true,
        email_sent: true,
        email_id: emailResult?.id || null,
        reservation_id: reservationId,
        status
      });
    } catch (emailError) {
      console.error("Stav změněn, ale e-mail se nepodařilo odeslat:", emailError);

      return res.status(200).json({
        success: true,
        changed: true,
        email_sent: false,
        email_error: "Stav byl změněn, ale e-mail se nepodařilo odeslat.",
        reservation_id: reservationId,
        status
      });
    }
  } catch (error) {
    console.error("Chyba při změně stavu rezervace:", error);

    const statusCode =
      Number(error?.status) >= 400 && Number(error?.status) < 600
        ? Number(error.status)
        : 500;

    return res.status(statusCode).json({
      error:
        dashboardErrorMessage(
          error,
          "Stav rezervace se nepodařilo změnit."
        )
    });
  }
}


export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (
    req.method !== "POST"
  ) {
    res.setHeader(
      "Allow",
      "POST"
    );

    return res
      .status(405)
      .json({
        error:
          "Povolena je pouze metoda POST."
      });
  }

  if (
    req.body?.action ===
    "dashboard-restaurant-info"
  ) {
    return getDashboardRestaurantInfoOnServer(
      req,
      res
    );
  }

  if (
    req.body?.action ===
    "restaurant-info"
  ) {
    return getPublicRestaurantInfoOnServer(
      req,
      res
    );
  }

  if (
    req.body?.action ===
    "available-times"
  ) {
    return getAvailableTimesOnServer(
      req,
      res
    );
  }

  if (
    req.body?.action ===
    "create-reservation"
  ) {
    return createReservationOnServer(
      req,
      res
    );
  }

  if (
    req.body?.action ===
    "create-dashboard-reservation"
  ) {
    return createDashboardReservationOnServer(
      req,
      res
    );
  }

  if (
    req.body?.action ===
    "update-reservation"
  ) {
    return updateReservationOnServer(
      req,
      res
    );
  }

  if (
    req.body?.action ===
    "update-reservation-status"
  ) {
    return updateReservationStatusOnServer(
      req,
      res
    );
  }

  return res
    .status(400)
    .json({
      error:
        "Neplatná akce."
    });
}
