#!/usr/bin/env node
// Propuneri primite prin formularul Google: citește fila publicată ca CSV (fără emailuri) și listează propunerile noi.
//
//   node scripts/propuneri.js <url-csv | fisier.csv>          rezumat: noi / excluse / deja existente / invalide
//   node scripts/propuneri.js <url-csv | fisier.csv> --json   la fel, plus lista propunerilor noi ca JSON (pentru „actualizează propunerile")
//
// Coloanele se recunosc după cuvinte din titlu (link, disciplin, program, de ce, nume), în orice ordine. Propunerile noi
// intră în lotul zilei cu Accept gol (source: "propunere", marcate cu albastru în Excel); decizia Da/Nu o iei acolo.
// O coloană „Decizie" în Sheet e opțională: doar „Nu" exclude rândul. Un link care există deja (în resurse sau în orice
// lot, inclusiv cele respinse) nu apare a doua oară, deci comanda se poate rula oricând fără dubluri.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const column = (head, ...words) => head.findIndex(h => words.some(w => plain(h).includes(w)));

// același link, indiferent de www, schemă, slash final sau parametri de urmărire
function normUrl(u) {
  try {
    const x = new URL(String(u).trim());
    const keep = x.hostname.replace(/^www\./, '') === 'youtube.com' && x.searchParams.get('v') ? `?v=${x.searchParams.get('v')}` : '';
    return x.hostname.replace(/^www\./, '').replace(/^m\./, '') + x.pathname.replace(/\/+$/, '') + keep;
  } catch { return null; }
}
const isHttp = u => /^https?:\/\/[^\s]+$/i.test(String(u).trim());

function knownUrls() {
  const set = new Set();
  const res = readJson(path.join(ROOT, 'data', 'resources.json'));
  res.resources.forEach(r => set.add(normUrl(r.url)));
  const dir = path.join(ROOT, 'data', 'loturi');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) readJson(path.join(dir, f)).candidates.forEach(c => set.add(normUrl(c.url)));
  return { set, catIds: res.categories.map(c => c.id) };
}

function analyse(csv, known) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error('CSV gol.');
  const head = rows[0];
  // „Altă disciplină care lipsește?" conține și ea cuvântul „disciplină": o separăm de lista cu casete
  const isOther = h => /alta disciplin|lipse/.test(plain(h));
  const col = { url: column(head, 'link', 'url'), cats: head.findIndex(h => /disciplin|categor/.test(plain(h)) && !isOther(h)),
    other: head.findIndex(isOther), soft: column(head, 'program', 'software'),
    why: column(head, 'de ce', 'motiv', 'nota'), name: column(head, 'nume'), decision: column(head, 'decizie', 'status'), time: column(head, 'marcaj', 'timestamp') };
  if (col.url < 0) throw new Error('Nu găsesc coloana „Link" în prima linie a CSV-ului (verifică foaia publicată și că formularul are întrebarea „Link resursă").');
  const get = (r, i) => (i >= 0 ? String(r[i] || '').trim() : '');
  // Decizia se ia în Excel-ul lotului. O coloană „Decizie" în Sheet e opțională: doar un „Nu" scris acolo exclude rândul (spam evident).
  const out = { process: [], rejected: 0, existing: 0, invalid: 0, seenNow: new Set() };
  const catRe = new RegExp(`\\b(${known.catIds.join('|')})\\b`, 'g');
  for (const r of rows.slice(1)) {
    const url = get(r, col.url);
    if (!isHttp(url)) { out.invalid++; continue; }
    if (plain(get(r, col.decision)) === 'nu') { out.rejected++; continue; }
    const key = normUrl(url);
    if (!key || known.set.has(key) || out.seenNow.has(key)) { out.existing++; continue; }
    out.seenNow.add(key);
    out.process.push({
      url, proposedBy: get(r, col.name) || null,
      cats: [...new Set(get(r, col.cats).match(catRe) || [])],
      software: get(r, col.soft).split(/[,;]/).map(s => s.trim()).filter(Boolean),
      otherCat: get(r, col.other).replace(/\s+/g, ' ').slice(0, 80) || null,
      why: get(r, col.why) || null, received: get(r, col.time) || null,
    });
  }
  delete out.seenNow;
  return out;
}

module.exports = { parseCsv, normUrl, analyse };

if (require.main === module) (async () => {
  const [src, flag] = process.argv.slice(2);
  if (!src) { console.error('Folosire: node scripts/propuneri.js <url-csv | fisier.csv> [--json]'); process.exit(1); }
  let csv;
  if (/^https?:\/\//i.test(src)) {
    const r = await fetch(src, { redirect: 'follow' });
    if (!r.ok) throw new Error(`CSV-ul nu se poate citi (cod ${r.status}). Verifică dacă fila e publicată ca CSV.`);
    csv = await r.text();
  } else csv = fs.readFileSync(src, 'utf8');
  const a = analyse(csv, knownUrls());
  console.log(`Propuneri noi: ${a.process.length} | excluse cu „Nu": ${a.rejected} | deja existente: ${a.existing} | linkuri invalide: ${a.invalid}`);
  if (flag === '--json') console.log(JSON.stringify(a.process, null, 2));
  else a.process.forEach((p, i) => console.log(`  ${i + 1}. ${p.url}${p.proposedBy ? `  (propus de ${p.proposedBy})` : ''}${p.cats.length ? `  [${p.cats.join('+')}]` : ''}`));
})().catch(e => { console.error('Eroare:', e.message); process.exit(1); });
