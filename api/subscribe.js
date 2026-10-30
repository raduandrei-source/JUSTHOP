// POST /api/subscribe — adaugă un abonat în Brevo, cu confirmare prin email (double opt-in).
// Corp JSON: { email, categories: ["GH","BIM"], frequency: "saptamanal" | "lunar", consent: true, website: "" }
// Variabile de mediu (se setează în Vercel, nu în cod): BREVO_API_KEY, BREVO_LIST_ID, BREVO_DOI_TEMPLATE_ID, SITE_URL
// Atributele CATEGORII (text), FRECVENTA (text) și ZIUA (număr) trebuie să existe în contul Brevo.
const data = require('../data/resources.json');

const CATS = new Set(data.categories.map(c => c.id));
const FREQ = new Set(['saptamanal', 'lunar']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// limitare simplă pe IP; trăiește doar cât instanța funcției, deci ajută dar nu e o garanție
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 5;
}

const send = (res, code, body) => res.status(code).json(body);

// mesajele returnate se văd direct pe site, deci le dăm în limba aleasă de vizitator (câmpul "lang": "ro" | "en")
const MSG = {
  ro: {
    method: 'Metodă nepermisă.', inactive: 'Abonarea nu este activă încă.', limited: 'Prea multe încercări. Mai încearcă peste un minut.',
    badRequest: 'Cerere invalidă.', confirmCheck: 'Verifică-ți emailul pentru confirmare.', badEmail: 'Adresa de email nu pare validă.',
    noConsent: 'Trebuie să fii de acord cu primirea emailurilor.', badFreq: 'Alege cât de des vrei să primești emailuri.',
    badCat: 'Categorie necunoscută.', ok: 'Verifică-ți emailul și confirmă abonarea.', fail: 'Nu am putut înregistra abonarea acum. Încearcă din nou mai târziu.',
  },
  en: {
    method: 'Method not allowed.', inactive: 'Subscribing is not active yet.', limited: 'Too many attempts. Please try again in a minute.',
    badRequest: 'Invalid request.', confirmCheck: 'Check your email to confirm.', badEmail: 'That email address doesn’t look valid.',
    noConsent: 'You need to agree to receive emails.', badFreq: 'Choose how often you want to receive emails.',
    badCat: 'Unknown category.', ok: 'Check your email and confirm your subscription.', fail: 'We couldn’t register your subscription right now. Please try again later.',
  },
};
function langOf(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  return b && b.lang === 'en' ? 'en' : 'ro';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const M = MSG[langOf(req)];
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: M.method });
  }

  const { BREVO_API_KEY, BREVO_LIST_ID, BREVO_DOI_TEMPLATE_ID, SITE_URL } = process.env;
  if (!BREVO_API_KEY || !BREVO_LIST_ID || !BREVO_DOI_TEMPLATE_ID || !SITE_URL) {
    return send(res, 503, { error: M.inactive });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'necunoscut';
  if (limited(ip)) return send(res, 429, { error: M.limited });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, { error: M.badRequest });

  // câmp-capcană: oamenii nu-l văd, roboții îl completează; răspundem ca la succes, fără să facem nimic
  if (body.website) return send(res, 200, { ok: true, message: M.confirmCheck });

  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return send(res, 400, { error: M.badEmail });
  if (body.consent !== true) return send(res, 400, { error: M.noConsent });

  const frequency = String(body.frequency || '');
  if (!FREQ.has(frequency)) return send(res, 400, { error: M.badFreq });

  const requested = Array.isArray(body.categories) ? body.categories : [];
  const categories = [...new Set(requested.map(c => String(c).toUpperCase()))];
  if (categories.some(c => !CATS.has(c))) return send(res, 400, { error: M.badCat });

  // ziua de trimitere = ziua abonării (0 = luni ... 6 = duminică); permite împărțirea trimiterilor pe zile
  const day = (new Date().getUTCDay() + 6) % 7;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        email,
        attributes: { CATEGORII: categories.length ? categories.join(',') : 'TOATE', FRECVENTA: frequency, ZIUA: day },
        includeListIds: [Number(BREVO_LIST_ID)],
        templateId: Number(BREVO_DOI_TEMPLATE_ID),
        redirectionUrl: SITE_URL.replace(/\/$/, '') + '/?abonat=1#newsletter',
      }),
    });
    if (r.ok) return send(res, 200, { ok: true, message: M.ok });

    const detail = await r.json().catch(() => ({}));
    // adresă deja existentă: același răspuns ca la succes, ca să nu aflăm cine e abonat
    if (r.status === 400 && /already|exist/i.test(String(detail.message || ''))) {
      return send(res, 200, { ok: true, message: M.ok });
    }
    console.error('Brevo a răspuns', r.status, detail.code || '');
    return send(res, 502, { error: M.fail });
  } catch (e) {
    console.error('Eroare la apelul Brevo:', e.name);
    return send(res, 502, { error: M.fail });
  } finally {
    clearTimeout(timer);
  }
};
