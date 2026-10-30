# Formular de propuneri (Google Forms + Sheets)

## 1. Formularul
forms.google.com → formular nou, titlu **Propune o resursă pentru justhop**.

Descriere (copiază): *Propune un curs, tutorial, articol sau carte de arhitectură digitală. Verific fiecare propunere înainte să o public. Adresa contului tău Google se folosește doar pentru moderare și nu apare pe site; vezi politica de confidențialitate: https://justhop.nevermindthe.name/confidentialitate.html*

Întrebări, în această ordine:
1. **Link resursă**: răspuns scurt, obligatoriu. Validare a răspunsului → *Expresie regulată* → *Se potrivește* → `^https?://\S+$`, mesaj „Lipește un link care începe cu https://".
2. **Discipline (maximum 3)**: casete de selectare, obligatoriu, exact cele 13 discipline ale site-ului, cu codul în față (importul recunoaște codul):
   `GH – Grasshopper`, `BIM – BIM`, `GIS – GIS`, `SIM – Simulare energetică`, `FAB – Fabricație digitală`, `VIZ – Vizualizare`, `MC – Modelare computațională`, `AI – AI și fluxuri de lucru`, `CER – Cercetare`, `EBD – Evidence-Based Design`, `REZ – Reziliență structurală`, `FF – Form Finding`, `PUD – Proiectare urbană digitală`.
3. **Altă disciplină care lipsește?**: răspuns scurt, **opțional**.
4. **Programe / software**: răspuns scurt, opțional (ex. Rhino, Grasshopper).
5. **De ce merită**: paragraf, opțional.
6. **Numele cu care să apară**: răspuns scurt, opțional (apare ca „propus de …").

Setări → Răspunsuri:
- **Colectează adresele de email → Verificate** (obligă autentificarea cu cont Google)
- **Limitează la 1 răspuns**: lăsat dezactivat (altfel colegii nu pot propune mai multe resurse)
- Împiedică abuzul: oprești oricând din *Răspunsuri → Acceptă răspunsuri*.

Fila *Răspunsuri* → **Legare la Foi de calcul** (creează Sheet-ul).

## 2. Sheet-ul
Decizia Da/Nu se ia în Excel-ul lotului, nu în Sheet. Sheet-ul e doar inbox.
Prima foaie (răspunsurile) are coloanele (cu emailul verificat activ): A Marcaj de timp, B Email, C Link, D Discipline, E Altă disciplină, F Programe, G De ce, H Nume. Verifică ordinea reală în linia 1.
- Adaugă o foaie nouă numită `Pentru justhop`, în A1:
  `=QUERY('Răspunsuri la formular 1'!A:H; "select A, C, D, E, F, G, H where C is not null"; 1)`
  (numele primei foi poate diferi; copiază-l exact). Foaia asta **nu conține emailurile**.
- *Fișier → Partajare → Publică pe web* → alegi **doar foaia `Pentru justhop`** (niciodată foaia cu răspunsurile, ea conține emailurile), format **CSV** → Publică → copiezi linkul.

Sheet-ul în sine rămâne privat. Linkul CSV nu îl pui pe site; îl dai doar mie.

## 3. Procesare
Îmi spui „actualizează propunerile". Rulez `node scripts/propuneri.js <link-csv>` (linkul e în memoria proiectului), completez titlul, durata, nivelul, categoriile, programele și descrierea pentru fiecare propunere nouă și le adaug în lotul zilei cu Accept gol, source „propunere".
În Excel apar cu 👤 și celule albastre (Nr, Detalii), cu numele și nota celui care a propus; cele căutate de mine nu au marcaj, cele lipite de tine au ✎. Tu pui Da/Nu în Excel, apoi public ce e Da, cu „propus de …".
O disciplină lipsă, sugerată de cineva, apare în Detalii; dacă o vrei, adaugi un rând în foaia „Categorii" din Excel și, la „actualizează", apare pe site. Programele noi apar singure în caseta Software după publicare.
Promisiune din politica de confidențialitate: emailurile se șterg din Sheet în cel mult 30 de zile după decizie (ștergi coloana B sau rândul).

# Ștergerea automată a dezabonaților (la 10 zile)

`api/cleanup.js` rulează zilnic (cron în `vercel.json`, ora 03:00 UTC) și șterge din Brevo contactele dezabonate de peste 10 zile.
În Vercel → Settings → Environment Variables adaugi **CRON_SECRET** (un șir lung aleator; Vercel îl trimite singur cronului) și redeploy. `BREVO_API_KEY` și `BREVO_LIST_ID` există deja.

Verificare după deploy (fără să ștergă nimic): deschide în browser `https://justhop.nevermindthe.name/api/cleanup?dry=1` cu antetul `Authorization: Bearer <CRON_SECRET>`, sau rulează din PowerShell:
`Invoke-RestMethod -Uri "https://justhop.nevermindthe.name/api/cleanup?dry=1" -Headers @{Authorization="Bearer <CRON_SECRET>"}`
Răspunsul arată câte contacte ar fi șterse (`due`). Ștergerile reale: maximum 100 pe rulare.
