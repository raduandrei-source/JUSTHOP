// Test pentru scripts/propuneri.js, fără rețea.  node scripts/test-propuneri.js
const assert = require('assert');
const { parseCsv, normUrl, analyse } = require('./propuneri.js');

const known = { set: new Set([normUrl('https://www.youtube.com/watch?v=AAA111')]), catIds: ['GH', 'BIM', 'GIS', 'AI'] };
const csv = [
  'Marcaj de timp,Link resursă,Discipline,Programe / software,De ce merită,Numele cu care să apară,Decizie',
  '30.10.2026 10:00,https://www.youtube.com/watch?v=BBB222,"GH – Grasshopper, AI – AI și fluxuri",Rhino; Grasshopper,"Explică ""clar"",\ncu exemple",Ana P.,Da',
  '30.10.2026 10:05,https://youtube.com/watch?v=AAA111&t=30,GH,,,,Da',          // există deja (alt format de link)
  '30.10.2026 10:06,https://example.com/curs/,BIM,Revit,,,nu',                   // respinsă
  '30.10.2026 10:07,https://example.com/alt-curs,GIS,QGIS,,,',                   // în așteptare
  '30.10.2026 10:08,nu-e-link,GH,,,,Da',                                         // invalid
  '30.10.2026 10:09,https://www.youtube.com/watch?v=BBB222,GH,,,,Da',            // dublură în același CSV
].join('\r\n');

const run = (name, fn) => { fn(); console.log('ok  ' + name); };

run('CSV cu ghilimele, virgule și linie nouă în câmp', () => {
  const rows = parseCsv(csv);
  assert.equal(rows.length, 7);
  assert.equal(rows[1][4], 'Explică "clar",\ncu exemple');
});
run('același link în formate diferite se recunoaște', () => {
  assert.equal(normUrl('https://www.youtube.com/watch?v=AAA111&t=30'), normUrl('https://youtube.com/watch?v=AAA111'));
  assert.equal(normUrl('http://example.com/x/'), normUrl('https://www.example.com/x'));
});
run('analiza împarte corect propunerile', () => {
  const a = analyse(csv, known);
  assert.equal(a.process.length, 1);
  assert.equal(a.pending, 1); assert.equal(a.rejected, 1); assert.equal(a.invalid, 1); assert.equal(a.existing, 2);
  const p = a.process[0];
  assert.equal(p.url, 'https://www.youtube.com/watch?v=BBB222');
  assert.deepEqual(p.cats, ['GH', 'AI']);
  assert.deepEqual(p.software, ['Rhino', 'Grasshopper']);
  assert.equal(p.proposedBy, 'Ana P.');
});
run('lipsa coloanelor obligatorii -> eroare clară', () => {
  assert.throws(() => analyse('a,b\n1,2', known), /Link/);
});
console.log('\ntoate testele au trecut');
