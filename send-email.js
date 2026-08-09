const RESEND_API_URL = "https://api.resend.com/emails";

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
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}.${month}.${year}` : date;
}

async function sendResendEmail({ to, subject, html, replyTo }) {
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from:
        process.env.RESEND_FROM_EMAIL ||
        "Restaurace <onboarding@resend.dev>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.message || "Resend odmítl odeslání e-mailu.");
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Povolena je pouze metoda POST." });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({
      error: "Ve Vercelu chybí proměnná RESEND_API_KEY."
    });
  }

  const {
    name = "",
    people = "",
    date = "",
    time = "",
    phone = "",
    email = "",
    note = ""
  } = req.body || {};

  const cleanEmail = String(email).trim();

  if (
    !name ||
    !people ||
    !date ||
    !time ||
    !phone ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
  ) {
    return res.status(400).json({
      error: "Chybí údaje rezervace nebo je neplatný e-mail."
    });
  }

  const safe = {
    name: escapeHtml(name),
    people: escapeHtml(people),
    date: escapeHtml(formatDate(date)),
    time: escapeHtml(time),
    phone: escapeHtml(phone),
    email: escapeHtml(cleanEmail),
    note: escapeHtml(note || "Bez poznámky")
  };

  const customerHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
      <div style="background:#111827;color:#ffffff;padding:24px;text-align:center">
        <h1 style="margin:0;font-size:26px">Potvrzení rezervace</h1>
      </div>
      <div style="padding:28px;color:#1f2937">
        <p>Dobrý den, <strong>${safe.name}</strong>,</p>
        <p>děkujeme za rezervaci. Vaši rezervaci jsme přijali a nyní čeká na potvrzení restaurací.</p>

        <div style="background:#f9fafb;border-radius:12px;padding:18px;margin:22px 0">
          <p style="margin:7px 0"><strong>Datum:</strong> ${safe.date}</p>
          <p style="margin:7px 0"><strong>Čas:</strong> ${safe.time}</p>
          <p style="margin:7px 0"><strong>Počet osob:</strong> ${safe.people}</p>
          <p style="margin:7px 0"><strong>Telefon:</strong> ${safe.phone}</p>
          <p style="margin:7px 0"><strong>Poznámka:</strong> ${safe.note}</p>
        </div>

        <p>V případě změny nás prosím kontaktujte.</p>
        <p style="margin-bottom:0">Těšíme se na vaši návštěvu.</p>
      </div>
    </div>
  `;

  const restaurantHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h1>Nová rezervace</h1>
      <p><strong>Jméno:</strong> ${safe.name}</p>
      <p><strong>Počet osob:</strong> ${safe.people}</p>
      <p><strong>Datum:</strong> ${safe.date}</p>
      <p><strong>Čas:</strong> ${safe.time}</p>
      <p><strong>Telefon:</strong> ${safe.phone}</p>
      <p><strong>E-mail:</strong> ${safe.email}</p>
      <p><strong>Poznámka:</strong> ${safe.note}</p>
    </div>
  `;

  try {
    const customerResult = await sendResendEmail({
      to: cleanEmail,
      subject: `Rezervace na ${safe.date} v ${safe.time}`,
      html: customerHtml
    });

    let restaurantResult = null;
    const restaurantEmail = process.env.RESTAURANT_EMAIL?.trim();

    if (restaurantEmail) {
      restaurantResult = await sendResendEmail({
        to: restaurantEmail,
        subject: `Nová rezervace – ${safe.name}, ${safe.date} ${safe.time}`,
        html: restaurantHtml,
        replyTo: cleanEmail
      });
    }

    return res.status(200).json({
      success: true,
      customerEmailId: customerResult?.id || null,
      restaurantEmailId: restaurantResult?.id || null,
      restaurantNotificationSkipped: !restaurantEmail
    });
  } catch (error) {
    console.error("Chyba při odesílání e-mailu:", error);
    return res.status(500).json({
      error: error.message || "E-mail se nepodařilo odeslat."
    });
  }
}
