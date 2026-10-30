// Test pentru scripts/propuneri.js, fără rețea.  node scripts/test-propuneri.js
const assert = require('assert');
const { parseCsv, normUrl, analyse } = require('./propuneri.js');

const known = { set: new Set([normUrl('https://www.youtube.com/watch?v=AAA111')]), catIds: ['GH', 'BIM', 'GIS', 'AI'] };
// aceeași ordine ca în formularul real: Altă disciplină vine după Discipline, iar „Decizie" lipsește
const head = 'Timestamp,Link resursă,Discipline (maximum 3),Altă disciplină care lipsește?,Programe / software,De ce merită,Numele cu care să apară';
const csv = [
  head,
  '30.10.2026 10:00,https://www.youtube.com/watch?v=BBB222,"GH – Grasshopper, AI – AI și fluxuri",Parametric,Rhino; Grasshopper,"Explică ""clar"",\ncu exemple",Ana P.',
  '30.10.2026 10:05,https://youtube.com/watch?v=AAA111&t=30,GH,,,,',            // există deja (alt format de link)
  '30.10.2026 10:07,https://example.com/alt-curs,GIS,,QGIS,,',                  // nouă, fără nume
  '30.10.2026 10:08,nu-e-link,GH,,,,',                                          // invalid
  '30.10.2026 10:09,https://www.youtube.com/watch?v=BBB222,GH,,,,',             // dublură în același CSV
].join('\r\n');

const run = (name, fn) => { fn(); console.log('ok  ' + name); };

run('CSV cu ghilimele, virgule și linie nouă în câmp', () => {
  const rows = parseCsv(csv);
  assert.equal(rows.length, 6);
  assert.equal(rows[1][5], 'Explică "clar",\ncu exemple');
});
run('același link în formate diferite se recunoaște', () => {
  assert.equal(normUrl('https://www.youtube.com/watch?v=AAA111&t=30'), normUrl('https://youtube.com/watch?v=AAA111'));
  assert.equal(normUrl('http://example.com/x/'), normUrl('https://www.example.com/x'));
});
run('fără coloana Decizie: propunerile noi intră toate', () => {
  const a = analyse(csv, known);
  assert.equal(a.process.length, 2);
  assert.equal(a.rejected, 0); assert.equal(a.invalid, 1); assert.equal(a.existing, 2);
  const p = a.process[0];
  assert.equal(p.url, 'https://www.youtube.com/watch?v=BBB222');
  assert.deepEqual(p.cats, ['GH', 'AI']);          // „Altă disciplină" nu se amestecă cu lista bifată
  assert.equal(p.otherCat, 'Parametric');
  assert.deepEqual(p.software, ['Rhino', 'Grasshopper']);
  assert.equal(p.proposedBy, 'Ana P.');
  assert.equal(a.process[1].proposedBy, null);
});
run('coloana Decizie opțională: „Nu" exclude rândul', () => {
  const withDecision = [head + ',Decizie', 'x,https://example.com/a,GH,,,,,Nu', 'x,https://example.com/b,GH,,,,,'].join('\n');
  const a = analyse(withDecision, known);
  assert.equal(a.rejected, 1); assert.equal(a.process.length, 1);
  assert.equal(a.process[0].url, 'https://example.com/b');
});
run('CSV real (publicat acum) fără coloana Link -> eroare clară', () => {
  const real = 'Timestamp,Discipline (maximum 3),Programe / software,De ce merită,Numele cu care să apară,  Altă disciplină care lipsește?';
  assert.throws(() => analyse(real, known), /Link/);
});
console.log('\ntoate testele au trecut');
