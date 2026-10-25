// Test fără rețea pentru api/subscribe.js: apelul către Brevo e înlocuit cu un fals.  node scripts/test-subscribe.js
const assert = require('assert');
const handler = require('../api/subscribe.js');

function call(req) {
  return new Promise(resolve => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'POST', headers: { 'x-forwarded-for': req.ip || '1.1.1.1' }, ...req }, res);
  });
}
const env = { BREVO_API_KEY: 'k', BREVO_LIST_ID: '7', BREVO_DOI_TEMPLATE_ID: '3', SITE_URL: 'https://justhop.example/' };
const good = { email: ' Ana@Facultate.ro ', categories: ['gh', 'BIM'], frequency: 'saptamanal', consent: true };
let calls = [];
const brevo = (status, body = {}) => { global.fetch = async (url, opt) => { calls.push({ url, opt }); return { ok: status < 300, status, json: async () => body }; }; };

(async () => {
  let ip = 0; const fresh = () => ({ ip: '9.9.9.' + (++ip) });
  const run = async (name, fn) => { await fn(); console.log('ok  ' + name); };

  await run('fără variabile de mediu -> 503', async () => {
    const r = await call({ body: good, ...fresh() });
    assert.equal(r.code, 503);
  });
  Object.assign(process.env, env);

  await run('GET -> 405', async () => assert.equal((await call({ method: 'GET', ...fresh() })).code, 405));
  await run('email invalid -> 400', async () => assert.equal((await call({ body: { ...good, email: 'ana@' }, ...fresh() })).code, 400));
  await run('fără acord -> 400', async () => assert.equal((await call({ body: { ...good, consent: false }, ...fresh() })).code, 400));
  await run('frecvență invalidă -> 400', async () => assert.equal((await call({ body: { ...good, frequency: 'zilnic' }, ...fresh() })).code, 400));
  await run('categorie necunoscută -> 400', async () => assert.equal((await call({ body: { ...good, categories: ['XYZ'] }, ...fresh() })).code, 400));

  await run('capcană completată -> 200, fără apel Brevo', async () => {
    calls = []; brevo(201);
    const r = await call({ body: { ...good, website: 'http://spam' }, ...fresh() });
    assert.equal(r.code, 200); assert.equal(calls.length, 0);
  });

  await run('cerere validă -> apel Brevo corect', async () => {
    calls = []; brevo(201);
    const r = await call({ body: good, ...fresh() });
    assert.equal(r.code, 200);
    assert.equal(calls.length, 1);
    const { url, opt } = calls[0];
    assert.equal(url, 'https://api.brevo.com/v3/contacts/doubleOptinConfirmation');
    assert.equal(opt.headers['api-key'], 'k');
    const b = JSON.parse(opt.body);
    assert.equal(b.email, 'ana@facultate.ro');
    assert.deepEqual(b.includeListIds, [7]);
    assert.equal(b.templateId, 3);
    assert.equal(b.redirectionUrl, 'https://justhop.example/?abonat=1#newsletter');
    assert.equal(b.attributes.CATEGORII, 'GH,BIM');
    assert.equal(b.attributes.FRECVENTA, 'saptamanal');
    assert.ok(Number.isInteger(b.attributes.ZIUA) && b.attributes.ZIUA >= 0 && b.attributes.ZIUA <= 6);
  });

  await run('nicio categorie -> TOATE', async () => {
    calls = []; brevo(201);
    await call({ body: { ...good, categories: [] }, ...fresh() });
    assert.equal(JSON.parse(calls[0].opt.body).attributes.CATEGORII, 'TOATE');
  });

  await run('contact existent (400) -> același răspuns ca la succes', async () => {
    brevo(400, { code: 'invalid_parameter', message: 'Contact already exist' });
    const r = await call({ body: good, ...fresh() });
    assert.equal(r.code, 200);
  });

  await run('eroare Brevo (500) -> 502', async () => {
    brevo(500, {});
    const r = await call({ body: good, ...fresh() });
    assert.equal(r.code, 502);
  });

  await run('rețea căzută -> 502', async () => {
    global.fetch = async () => { throw Object.assign(new Error('x'), { name: 'TypeError' }); };
    assert.equal((await call({ body: good, ...fresh() })).code, 502);
  });

  await run('a 6-a cerere/minut de la același IP -> 429', async () => {
    brevo(201);
    let last;
    for (let i = 0; i < 6; i++) last = await call({ body: good, ip: '5.5.5.5' });
    assert.equal(last.code, 429);
  });

  console.log('\ntoate testele au trecut');
})().catch(e => { console.error('EȘEC:', e.message); process.exit(1); });
