// Test fără rețea pentru api/cleanup.js: Brevo e înlocuit cu un fals.  node scripts/test-cleanup.js
const assert = require('assert');
const handler = require('../api/cleanup.js');

const call = (req) => new Promise(resolve => {
  const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  handler({ headers: { authorization: 'Bearer s3cret' }, query: {}, ...req }, res);
});
const ago = d => new Date(Date.now() - d * 86_400_000).toISOString();
let deletes = [], reads = [];
const fake = (all, delStatus = 204) => {
  global.fetch = async (url, opt = {}) => {
    if (opt.method === 'DELETE') { deletes.push(url); return { ok: delStatus < 300, status: delStatus, json: async () => ({}) }; }
    const u = new URL(url); const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
    reads.push(off);
    return { ok: true, status: 200, json: async () => ({ contacts: all.slice(off, off + lim) }) };
  };
};
const reset = () => { deletes = []; reads = []; };

(async () => {
  const run = async (name, fn) => { reset(); await fn(); console.log('ok  ' + name); };
  Object.assign(process.env, { BREVO_API_KEY: 'k', BREVO_LIST_ID: '3', CRON_SECRET: 's3cret' });

  const contacts = [
    { email: 'activ@x.ro', emailBlacklisted: false, modifiedAt: ago(40) },                  // abonat: nu se atinge
    { email: 'vechi@x.ro', emailBlacklisted: true, modifiedAt: ago(11) },                   // dezabonat de 11 zile: se șterge
    { email: 'recent@x.ro', emailBlacklisted: true, modifiedAt: ago(3) },                   // dezabonat de 3 zile: rămâne
    { email: 'lista@x.ro', emailBlacklisted: false, listUnsubscribed: [3], modifiedAt: ago(30) }, // scos din lista noastră: se șterge
    { email: 'alta@x.ro', emailBlacklisted: false, listUnsubscribed: [9], modifiedAt: ago(30) },  // altă listă: rămâne
    { email: 'fara-data@x.ro', emailBlacklisted: true },                                    // fără dată: rămâne
  ];

  await run('fără CRON_SECRET -> 503', async () => {
    const s = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
    assert.equal((await call({})).code, 503); process.env.CRON_SECRET = s;
  });
  await run('antet greșit -> 401, fără niciun apel', async () => {
    fake(contacts);
    assert.equal((await call({ headers: { authorization: 'Bearer altceva' } })).code, 401);
    assert.equal((await call({ headers: {} })).code, 401);
    assert.equal(reads.length + deletes.length, 0);
  });
  await run('dry=1 numără și nu șterge', async () => {
    fake(contacts);
    const r = await call({ query: { dry: '1' } });
    assert.equal(r.code, 200); assert.equal(r.body.due, 2); assert.equal(deletes.length, 0);
  });
  await run('șterge doar dezabonații de peste 10 zile', async () => {
    fake(contacts);
    const r = await call({});
    assert.equal(r.code, 200); assert.equal(r.body.deleted, 2);
    assert.deepEqual(deletes.map(u => decodeURIComponent(u.split('/contacts/')[1].split('?')[0])).sort(), ['lista@x.ro', 'vechi@x.ro']);
    assert.ok(deletes.every(u => u.endsWith('?identifierType=email_id')));
  });
  await run('RETENTION_DAYS schimbă pragul', async () => {
    process.env.RETENTION_DAYS = '2'; fake(contacts);
    assert.equal((await call({})).body.deleted, 3); delete process.env.RETENTION_DAYS;
  });
  await run('paginare: 2500 contacte -> 3 pagini citite', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ email: `u${i}@x.ro`, emailBlacklisted: false, modifiedAt: ago(1) }));
    fake(many); await call({});
    assert.deepEqual(reads, [0, 1000, 2000]);
  });
  await run('plafon de 100 ștergeri pe rulare', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ email: `u${i}@x.ro`, emailBlacklisted: true, modifiedAt: ago(20) }));
    fake(many); const r = await call({});
    assert.equal(r.body.deleted, 100); assert.equal(r.body.due, 150);
  });
  await run('ștergere eșuată (500) -> numărată ca eșuată', async () => {
    fake(contacts, 500); const r = await call({});
    assert.equal(r.body.deleted, 0); assert.equal(r.body.failed, 2);
  });
  await run('citire eșuată -> 502, nimic șters', async () => {
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    assert.equal((await call({})).code, 502); assert.equal(deletes.length, 0);
  });

  console.log('\ntoate testele au trecut');
})().catch(e => { console.error('EȘEC:', e.message); process.exit(1); });
