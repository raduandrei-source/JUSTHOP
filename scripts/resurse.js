#!/usr/bin/env node
// Gestionare resurse: data/resources.json (ce vede site-ul) și data/loturi/AAAA-LL-ZZ.json
// (toate candidatele unui lot, cu decizia Da/Nu — istoricul din care se calculează autorii de încredere).
//
//   node scripts/resurse.js list [data]
//   node scripts/resurse.js publish-lot data/loturi/2026-10-25.json
//   node scripts/resurse.js new-candidate <data> candidat.json     (adaugă în lot cu următorul nr, accept = Da)
//   node scripts/resurse.js remove <data> <n> [n...]
//   node scripts/resurse.js autori [min-decizii]
//   node scripts/resurse.js sync-categories categorii.json   (adaugă/actualizează categoriile din foaia Excel)
//   node scripts/resurse.js remove-test
//
// Data se dă ca 10.11.2026 sau 2026-11-10. Numărul n al unei resurse e cel din lot (cel din Excel) și rămâne fix.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'resources.json');
const LOTURI = path.join(ROOT, 'data', 'loturi');

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const writeJson = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n', 'utf8'); };
const data = readJson(FILE);
const save = () => writeJson(FILE, data);

const toIso = s => {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new Error(`Dată invalidă: ${s} (folosește 10.11.2026 sau 2026-11-10)`);
};
const toRo = iso => iso.split('-').reverse().join('.');
const lotPath = iso => path.join(LOTURI, `${iso}.json`);
const sorted = list => [...list].sort((a, b) => b.added.localeCompare(a.added) || a.n - b.n);
const catIds = new Set(data.categories.map(c => c.id));

// Software: programele despre care e resursa (ex. Rhino, Grasshopper, QGIS). Lista din casetă de pe site se
// generează automat din aceste câmpuri, deci un program nou apare singur. Numele se aliniază la cele existente
// (fără diferențe de majuscule sau spații), ca „rhino" și „Rhino" să nu devină două categorii.
function knownSoftware() {
  const map = new Map();
  const add = s => { if (s && !map.has(s.toLowerCase())) map.set(s.toLowerCase(), s); };
  data.resources.forEach(r => (r.software || []).forEach(add));
  for (const f of fs.existsSync(LOTURI) ? fs.readdirSync(LOTURI) : []) {
    readJson(path.join(LOTURI, f)).candidates.forEach(c => (c.software || []).forEach(add));
  }
  return map;
}
function normSoftware(list) {
  const known = knownSoftware();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw).trim().replace(/\s+/g, ' ');
    if (!s) continue;
    const canon = known.get(s.toLowerCase()) || s;
    if (!out.includes(canon)) out.push(canon);
  }
  return out;
}

function checkCats(c) {
  if (!Array.isArray(c.cats) || !c.cats.length) throw new Error(`Fără categorii: ${c.title}`);
  const bad = c.cats.filter(x => !catIds.has(x));
  if (bad.length) throw new Error(`Categorie necunoscută ${bad.join(', ')} la: ${c.title}`);
  if (c.cats.length > 3) console.warn(`Atenție: ${c.cats.length} categorii la „${c.title}” (recomandat maximum 3).`);
}

function toResource(c, date) {
  // descEn = descrierea în engleză; site-ul are comutator RO/EN, deci fiecare resursă nouă se scrie în ambele limbi
  for (const k of ['title', 'platform', 'level', 'desc', 'descEn', 'url']) {
    if (!c[k]) throw new Error(`Lipsește "${k}" la: ${c.title || JSON.stringify(c)}`);
  }
  checkCats(c);
  const r = {
    title: c.title, cats: c.cats, software: normSoftware(c.software), platform: c.platform, level: c.level, desc: c.desc, descEn: c.descEn, url: c.url,
    author: c.author || null, authorUrl: c.authorUrl || null, added: date, n: c.n,
  };
  if (c.proposedBy) r.proposedBy = String(c.proposedBy).replace(/\s+/g, ' ').trim().slice(0, 60);   // numele ales de cel care a propus, niciodată emailul
  return r;
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'list') {
  const only = args[0] && toIso(args[0]);
  let last = null;
  for (const r of sorted(data.resources)) {
    if (only && r.added !== only) continue;
    if (r.added !== last) { last = r.added; console.log(`\n${toRo(r.added)}`); }
    console.log(`  ${String(r.n).padStart(2)}. [${r.cats.join('+')}] ${r.title}${r.test ? '  (test)' : ''}`);
  }
} else if (cmd === 'publish-lot') {
  const lot = readJson(args[0]);
  const toAdd = lot.candidates.filter(c => c.accept === 'Da' &&
    !data.resources.some(r => r.added === lot.date && r.n === c.n));
  const undecided = lot.candidates.filter(c => !c.accept).length;
  const swBefore = new Set(data.resources.flatMap(r => r.software || []));
  const added = toAdd.map(c => toResource(c, lot.date));
  data.resources.push(...added);
  save();
  console.log(`${added.length} resurse adăugate la ${toRo(lot.date)} (nr: ${added.map(r => r.n).join(', ') || '—'}).`);
  const swNew = [...new Set(added.flatMap(r => r.software))].filter(s => !swBefore.has(s));
  if (swNew.length) console.log(`Programe noi în casetă: ${swNew.join(', ')}`);
  if (undecided) console.log(`${undecided} candidate fără decizie, neadăugate.`);
} else if (cmd === 'new-candidate') {
  const date = toIso(args[0]);
  const c = readJson(args[1]);
  checkCats(c);
  c.software = normSoftware(c.software);
  const file = lotPath(date);
  const lot = fs.existsSync(file) ? readJson(file) : { date, candidates: [] };
  const n = Math.max(0, ...lot.candidates.map(x => x.n), ...data.resources.filter(r => r.added === date).map(r => r.n)) + 1;
  // implicit: link lipit de proprietar (accept Da, manual). O propunere din exterior (source: "propunere") sau o
  // candidată căutată de mine ("review": true, cu "suggest") intră cu accept gol, ca să decizi tu în Excel.
  const needsReview = c.source === 'propunere' || c.review === true;
  const { review, ...rest } = c;
  lot.candidates.push({ ...rest, n, accept: needsReview ? (c.accept || null) : 'Da', manual: !needsReview });
  writeJson(file, lot);
  console.log(`Candidat adăugat în lotul ${toRo(date)} cu nr ${n}.`);
} else if (cmd === 'remove') {
  const date = toIso(args[0]);
  const nums = args.slice(1).map(Number);
  if (!nums.length || nums.some(Number.isNaN)) throw new Error('Dă cel puțin un număr: remove 10.11.2026 3');
  const gone = data.resources.filter(r => r.added === date && nums.includes(r.n));
  const missing = nums.filter(n => !gone.some(r => r.n === n));
  if (missing.length) throw new Error(`Nu există nr ${missing.join(', ')} la ${toRo(date)}.`);
  data.resources = data.resources.filter(r => !gone.includes(r));
  save();
  const file = lotPath(date);
  if (fs.existsSync(file)) {
    const lot = readJson(file);
    lot.candidates.forEach(c => { if (nums.includes(c.n)) { c.accept = 'Nu'; c.removed = true; } });
    writeJson(file, lot);
  }
  gone.forEach(r => console.log(`Scos: ${toRo(r.added)} nr ${r.n} — ${r.title}`));
} else if (cmd === 'autori') {
  const min = Number(args[0] || 1);
  const stats = {};
  for (const f of fs.existsSync(LOTURI) ? fs.readdirSync(LOTURI) : []) {
    for (const c of readJson(path.join(LOTURI, f)).candidates) {
      if (!c.author || !['Da', 'Nu'].includes(c.accept)) continue;
      const s = stats[c.author] || (stats[c.author] = { da: 0, nu: 0 });
      if (c.accept === 'Da') s.da++; else s.nu++;
    }
  }
  const rows = Object.entries(stats)
    .map(([a, s]) => ({ a, ...s, tot: s.da + s.nu, rate: Math.round(100 * s.da / (s.da + s.nu)) }))
    .filter(r => r.tot >= min)
    .sort((x, y) => y.da - x.da || y.rate - x.rate || x.a.localeCompare(y.a));
  rows.forEach(r => console.log(`${String(r.da).padStart(2)} Da / ${r.nu} Nu  (${String(r.rate).padStart(3)}%)  ${r.a}`));
  if (!rows.length) console.log('Nicio decizie înregistrată încă.');
} else if (cmd === 'software') {
  // programele din casetă, cu numărul de resurse publicate pentru fiecare
  const counts = {};
  data.resources.forEach(r => (r.software || []).forEach(s => { counts[s] = (counts[s] || 0) + 1; }));
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  rows.forEach(([s, n]) => console.log(`${String(n).padStart(3)}  ${s}`));
  const none = data.resources.filter(r => !(r.software || []).length).length;
  console.log(`\n${rows.length} programe; ${none} resurse fără program.`);
} else if (cmd === 'sync-categories') {
  // fișier: [{id, name, color}] în ordinea din foaia „Categorii” a Excelului (scris de lot_excel.py read ... <fișier>)
  const rows = readJson(args[0]);
  const PALETTE = ['#B91C1C', '#0369A1', '#4D7C0F', '#A21CAF', '#0F766E', '#92400E', '#4338CA', '#BE185D', '#334155', '#A16207'];
  const used = () => new Set(data.categories.map(c => c.color.toLowerCase()));
  const out = [];
  const log = [];
  for (const r of rows) {
    if (!/^[A-Z0-9]{1,5}$/.test(r.id)) throw new Error(`Cod invalid: "${r.id}" (1–5 litere/cifre, majuscule)`);
    if (!r.name) throw new Error(`Categoria ${r.id} nu are nume.`);
    const old = data.categories.find(c => c.id === r.id);
    if (old) {
      const was = `${old.name} ${old.color}`;
      old.name = r.name;
      if (r.color) old.color = r.color;
      if (was !== `${old.name} ${old.color}`) log.push(`actualizată: ${r.id} → ${old.name} ${old.color}`);
      out.push(old);
    } else {
      const color = r.color || PALETTE.find(p => !used().has(p.toLowerCase())) || '#555555';
      const c = { id: r.id, name: r.name, color };
      data.categories.push(c);
      out.push(c);
      log.push(`nouă: ${c.id} · ${c.name} ${c.color}${r.color ? '' : ' (culoare aleasă automat)'} — de adăugat „nameEn” (numele în engleză) în data/resources.json`);
    }
  }
  // ordinea din foaie; categoriile lipsite din foaie rămân la coadă (nu se șterg automat, ca să nu piardă resurse)
  const missing = data.categories.filter(c => !out.includes(c));
  missing.forEach(c => {
    const n = data.resources.filter(r => r.cats.includes(c.id)).length;
    log.push(`atenție: ${c.id} lipsește din foaie și rămâne (${n} resurse); nu o șterg automat`);
  });
  data.categories = [...out, ...missing];
  save();
  console.log(log.length ? log.join('\n') : 'Categorii deja la zi.');
} else if (cmd === 'remove-test') {
  const before = data.resources.length;
  data.resources = data.resources.filter(r => !r.test);
  save();
  console.log(`${before - data.resources.length} resurse de test scoase.`);
} else {
  console.log('Comenzi: list [data] | publish-lot lot.json | new-candidate <data> c.json | remove <data> <n...> | autori [min] | software | sync-categories cat.json | remove-test');
  process.exit(cmd ? 1 : 0);
}
