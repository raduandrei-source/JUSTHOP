# Formular de propuneri (Google Forms + Sheets)

## 1. Formularul
forms.google.com → formular nou, titlu **Propune o resursă pentru justhop**.

Descriere (copiază): *Propune un curs, tutorial, articol sau carte de arhitectură digitală. Verific fiecare propunere înainte să o public. Adresa contului tău Google se folosește doar pentru moderare și nu apare pe site; vezi politica de confidențialitate: https://justhop.nevermindthe.name/confidentialitate.html*

Întrebări, în această ordine:
1. **Link resursă**: răspuns scurt, obligatoriu. Validare a răspunsului → *Expresie regulată* → *Se potrivește* → `^https?://\S+$`, mesaj „Lipește un link care începe cu https://".
2. **Discipline (maximum 3)**: casete de selectare, obligatoriu, cele 13 discipline cu forma `GH – Grasshopper` (codul în față, ca importul să le recunoască).
3. **Programe / software**: răspuns scurt, opțional (ex. Rhino, Grasshopper).
4. **De ce merită**: paragraf, opțional.
5. **Numele cu care să apară**: răspuns scurt, opțional (apare ca „propus de …").

Setări → Răspunsuri:
- **Colectează adresele de email → Verificate** (obligă autentificarea cu cont Google)
- **Limitează la 1 răspuns**: lăsat dezactivat (altfel colegii nu pot propune mai multe resurse)
- Împiedică abuzul: oprești oricând din *Răspunsuri → Acceptă răspunsuri*.

Fila *Răspunsuri* → **Legare la Foi de calcul** (creează Sheet-ul).

## 2. Sheet-ul
Prima foaie (răspunsurile) are coloanele: A Marcaj de timp, B Email, C Link, D Discipline, E Programe, F De ce, G Nume.
- În **H1** scrie `Decizie`. Selectează H2:H1000 → *Date → Validare date → Listă: Da, Nu*.
- Adaugă o foaie nouă numită `Pentru justhop`, în A1:
  `=QUERY('Răspunsuri la formular 1'!A:H; "select A, C, D, E, F, G, H where C is not null"; 1)`
  (numele primei foi poate diferi; copiază-l exact). Foaia asta **nu conține emailurile**.
- *Fișier → Partajare → Publică pe web* → alegi **doar foaia `Pentru justhop`**, format **CSV** → Publică → copiezi linkul.

Sheet-ul în sine rămâne privat. Linkul CSV nu îl pui pe site; îl dai doar mie.

## 3. Procesare
Marchezi Da / Nu în coloana Decizie. Apoi îmi spui „actualizează propunerile" și îmi dai linkul CSV (o singură dată; îl rețin în memoria proiectului).
Rulez `node scripts/propuneri.js <link-csv>`, completez titlul, durata, nivelul, categoriile, programele și descrierea pentru fiecare Da, le public cu „propus de …".
Promisiune din politica de confidențialitate: emailurile se șterg din Sheet în cel mult 30 de zile după decizie (ștergi coloana B sau rândul).

# Ștergerea automată a dezabonaților (la 10 zile)

`api/cleanup.js` rulează zilnic (cron în `vercel.json`, ora 03:00 UTC) și șterge din Brevo contactele dezabonate de peste 10 zile.
În Vercel → Settings → Environment Variables adaugi **CRON_SECRET** (un șir lung aleator; Vercel îl trimite singur cronului) și redeploy. `BREVO_API_KEY` și `BREVO_LIST_ID` există deja.

Verificare după deploy (fără să ștergă nimic): deschide în browser `https://justhop.nevermindthe.name/api/cleanup?dry=1` cu antetul `Authorization: Bearer <CRON_SECRET>`, sau rulează din PowerShell:
`Invoke-RestMethod -Uri "https://justhop.nevermindthe.name/api/cleanup?dry=1" -Headers @{Authorization="Bearer <CRON_SECRET>"}`
Răspunsul arată câte contacte ar fi șterse (`due`). Ștergerile reale: maximum 100 pe rulare.
