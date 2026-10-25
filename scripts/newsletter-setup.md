# Newsletter: ce trebuie configurat (o singură dată)

Codul e scris și testat cu un Brevo simulat (`node scripts/test-subscribe.js`). Mai lipsesc conturile și setările, pe care le faci tu.
Cheia API nu se trimite în chat și nu intră în cod: se pune doar în setările Vercel.

## 1. Brevo (gratuit: 300 de emailuri/zi, 100.000 de contacte)
1. Cont pe brevo.com.
2. **Expeditor și domeniu:** adaugă expeditorul (ex. `newsletter@nevermindthe.name`) și autentifică domeniul cu înregistrările DNS cerute de Brevo (cod de verificare, DKIM, DMARC). DNS-ul îl modifici la firma unde ai domeniul. Fără asta emailurile ajung în spam.
3. **Listă de contacte** numită „justhop". Notează numărul ei (List ID).
4. **Atribute de contact** (Contacts → Settings → Contact attributes), cu numele exact, majuscule:
   - `CATEGORII` — tip Text
   - `FRECVENTA` — tip Text
   - `ZIUA` — tip Număr
5. **Șablon pentru confirmarea abonării (double opt-in)**: creează-l în Brevo, cu butonul/linkul de confirmare pe care îl pune editorul. Notează ID-ul șablonului. Căile din meniu diferă uneori; dacă nu-l găsești, spune-mi ce vezi.
6. **Cheie API** (SMTP & API → API keys), numită „justhop-site".

## 2. Vercel (Project → Settings → Environment Variables)
| Nume | Valoare |
|---|---|
| `BREVO_API_KEY` | cheia de la pasul 6 |
| `BREVO_LIST_ID` | numărul listei |
| `BREVO_DOI_TEMPLATE_ID` | numărul șablonului |
| `SITE_URL` | adresa site-ului, ex. `https://justhop.vercel.app` |

După ce le salvezi, trebuie un redeploy (un push nou sau „Redeploy").

## 3. Pagina de confidențialitate
Completează câmpurile galbene din `confidentialitate.html` (operator, contact, dată, zile de păstrare, transferul către Vercel). Nu publica formularul cu ele necompletate.

## 4. Testul final
Abonare cu o adresă reală, confirmare din email, verificare că apare în lista Brevo cu atributele CATEGORII, FRECVENTA, ZIUA, apoi dezabonare.
