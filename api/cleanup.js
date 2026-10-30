// GET /api/cleanup — șterge din Brevo adresele dezabonate de mai mult de 10 zile.
// Rulează zilnic prin cron-ul din vercel.json; Vercel trimite antetul Authorization: Bearer <CRON_SECRET>.
// Variabile de mediu: BREVO_API_KEY, BREVO_LIST_ID, CRON_SECRET (setate în Vercel); RETENTION_DAYS (opțional, implicit 10).
// ?dry=1 doar numără, fără să șteargă nimic.
const DAYS = 86_400_000;
const PAGE = 1000;
const MAX_DELETES = 100;   // plasă de siguranță: dacă ceva e greșit, nu golim lista dintr-o singură rulare

const send = (res, code, body) => res.status(code).json(body);

async function brevo(path, key, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch('https://api.brevo.com/v3' + path, {
      ...init, signal: ctrl.signal,
      headers: { 'api-key': key, accept: 'application/json' },
    });
  } finally { clearTimeout(timer); }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { BREVO_API_KEY, BREVO_LIST_ID, CRON_SECRET } = process.env;
  if (!BREVO_API_KEY || !CRON_SECRET) return send(res, 503, { error: 'Curățarea nu este configurată.' });
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) return send(res, 401, { error: 'Neautorizat.' });

  const days = Number(process.env.RETENTION_DAYS) > 0 ? Number(process.env.RETENTION_DAYS) : 10;
  const dry = String((req.query && req.query.dry) || '') === '1';
  const cutoff = Date.now() - days * DAYS;
  const listId = Number(BREVO_LIST_ID);

  try {
    const due = [];
    let scanned = 0;
    for (let offset = 0; ; offset += PAGE) {
      const r = await brevo(`/contacts?limit=${PAGE}&offset=${offset}&sort=asc`, BREVO_API_KEY);
      if (!r.ok) { console.error('Brevo a răspuns', r.status, 'la citirea contactelor'); return send(res, 502, { error: 'Nu am putut citi contactele.' }); }
      const { contacts = [] } = await r.json();
      scanned += contacts.length;
      for (const c of contacts) {
        const unsub = c.emailBlacklisted === true || (Array.isArray(c.listUnsubscribed) && c.listUnsubscribed.includes(listId));
        const since = Date.parse(c.modifiedAt);
        // fără dată sigură nu ștergem: mai bine rămâne o zi în plus decât să dispară un abonat
        if (unsub && c.email && Number.isFinite(since) && since <= cutoff) due.push(c.email);
      }
      if (contacts.length < PAGE) break;
    }

    if (dry) return send(res, 200, { dry: true, scanned, due: due.length, days });

    let deleted = 0, failed = 0;
    for (const email of due.slice(0, MAX_DELETES)) {
      const r = await brevo(`/contacts/${encodeURIComponent(email)}?identifierType=email_id`, BREVO_API_KEY, { method: 'DELETE' });
      if (r.status === 204 || r.status === 404) deleted++; else { failed++; console.error('Ștergere eșuată, cod', r.status); }
    }
    console.log(`curățare: ${scanned} contacte citite, ${deleted} șterse, ${failed} eșuate, ${Math.max(0, due.length - MAX_DELETES)} rămase pentru mâine`);
    return send(res, 200, { scanned, due: due.length, deleted, failed, days });
  } catch (e) {
    console.error('Eroare la curățare:', e.name);
    return send(res, 502, { error: 'Curățarea a eșuat.' });
  }
};
