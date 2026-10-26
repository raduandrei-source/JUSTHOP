#!/usr/bin/env python3
"""Excelul de lucru pentru un lot de resurse (data/loturi/AAAA-LL-ZZ.json).

  python scripts/lot_excel.py export data/loturi/2026-10-25.json lot-25.10.2026.xlsx
  python scripts/lot_excel.py read   lot-25.10.2026.xlsx data/loturi/2026-10-25.json

Coloane: Nr | Accept (Da/Nu) | Resursă (click = link) | Categorii (coduri, prima = principală) | Detalii
export păstrează alegerile deja făcute în fișier (Accept și Categorii), pe baza linkului.
read scrie în lot Accept și Categorii și raportează (JSON) rândurile noi: linkuri lipite în coloana Resursă,
pe un rând fără Nr, cu restul gol. Completarea lor (titlu, categorii, descriere) o face Claude, la comandă.
"""
import json, math, os, re, sys, glob
from openpyxl import Workbook, load_workbook
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.comments import Comment

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
F = "Arial"


def load_json(p):
    with open(p, encoding="utf-8-sig") as f:
        return json.load(f)


def categories():
    return load_json(os.path.join(ROOT, "data", "resources.json"))["categories"]


HEX = re.compile(r"^#?[0-9A-Fa-f]{6}$")


def sheet_categories(path):
    """Rândurile din foaia „Categorii” a unui Excel existent (editate de utilizator), în ordinea din foaie."""
    if not os.path.exists(path):
        return []
    wb = load_workbook(path)
    if "Categorii" not in wb.sheetnames:
        return []
    ws = wb["Categorii"]
    out = []
    for row in range(2, ws.max_row + 1):
        cid = ws.cell(row=row, column=1).value
        if cid is None or not str(cid).strip():
            continue
        name = ws.cell(row=row, column=2).value
        color = ws.cell(row=row, column=3).value
        color = str(color).strip() if color else ""
        out.append({"id": str(cid).strip().upper(), "name": str(name).strip() if name else "",
                    "color": ("#" + color.lstrip("#").upper()) if HEX.match(color) else ""})
    return out


def dur(m):
    return f"{m // 60}h{m % 60:02d}" if m >= 60 else f"{m} min"


def kviews(v):
    if v >= 1_000_000:
        return f"{v / 1e6:.1f}M vizionări"
    if v >= 1000:
        return f"{round(v / 1000)}k vizionări"
    return f"{v} vizionări"


def other_lots(current_date):
    """Toate candidatele din celelalte loturi, pentru istoricul autorilor."""
    out = []
    for p in glob.glob(os.path.join(ROOT, "data", "loturi", "*.json")):
        lot = load_json(p)
        if lot["date"] != current_date:
            out += lot["candidates"]
    return out


def details(c, lot, past):
    bits = []
    if c.get("min"):
        bits.append(dur(c["min"]))
    if c.get("author"):
        bits.append(c["author"])
    if c.get("views"):
        bits.append(kviews(c["views"]))
    if c.get("rating"):
        bits.append(f"★{c['rating']}")
    if c.get("pub"):
        y, m, _ = c["pub"].split("-")
        bits.append(f"{m}.{y}")
    bits.append(c["level"])
    if c["platform"] != "YouTube":
        bits.append(c["platform"])
    text = " · ".join(bits)
    if c.get("flag"):
        text += "\n⚠ " + c["flag"]
    if c.get("author"):
        same = [x["n"] for x in lot["candidates"] if x.get("author") == c["author"] and x["n"] != c["n"]]
        before = [x for x in past if x.get("author") == c["author"] and x.get("accept") == "Da"]
        bits2 = []
        if same:
            bits2.append("același autor în lot: nr " + ", ".join(map(str, same)))
        if before:
            bits2.append(f"{len(before)} acceptate în loturi anterioare")
        if bits2:
            text += "\n↪ " + " · ".join(bits2)
    return text


def columns(ws):
    """Coloanele după antet, ca să meargă și pe fișiere mai vechi (fără Categorii / Software)."""
    idx = {}
    for c in range(1, ws.max_column + 1):
        h = str(ws.cell(row=1, column=c).value or "").strip().lower()
        if h == "nr": idx["nr"] = c
        elif h == "accept": idx["accept"] = c
        elif h.startswith("resurs"): idx["res"] = c
        elif h == "categorii": idx["cats"] = c
        elif h == "software": idx["soft"] = c
        elif h == "detalii": idx["det"] = c
    return idx


def split_list(raw):
    out = []
    for x in re.split(r"[,;]+", str(raw or "")):
        x = " ".join(x.split())
        if x and x not in out:
            out.append(x)
    return out


def sheet_software(path):
    """Programele din foaia „Software” a unui Excel existent (inclusiv cele adăugate de utilizator)."""
    if not os.path.exists(path):
        return []
    wb = load_workbook(path)
    if "Software" not in wb.sheetnames:
        return []
    ws = wb["Software"]
    return [str(ws.cell(row=r, column=1).value).strip() for r in range(2, ws.max_row + 1)
            if ws.cell(row=r, column=1).value and str(ws.cell(row=r, column=1).value).strip()]


def all_software():
    """Toate programele cunoscute: din resursele publicate și din toate loturile, cele mai folosite primele."""
    counts = {}
    for r in load_json(os.path.join(ROOT, "data", "resources.json"))["resources"]:
        for s in r.get("software", []):
            counts[s] = counts.get(s, 0) + 1
    for p in glob.glob(os.path.join(ROOT, "data", "loturi", "*.json")):
        for c in load_json(p)["candidates"]:
            for s in c.get("software", []):
                counts.setdefault(s, 0)
    return sorted(counts, key=lambda s: (-counts[s], s.lower()))


def old_choices(path):
    """Alegerile din fișierul existent: {url: (accept, cats, software)}; merge și pe layouturi mai vechi."""
    if not os.path.exists(path):
        return {}
    ws = load_workbook(path).worksheets[0]
    col = columns(ws)
    out = {}
    for row in range(2, ws.max_row + 1):
        c = ws.cell(row=row, column=col.get("res", 3))
        url = c.hyperlink.target if c.hyperlink else None
        if not url:
            continue
        acc = ws.cell(row=row, column=col.get("accept", 2)).value
        cats = ws.cell(row=row, column=col["cats"]).value if "cats" in col else None
        soft = ws.cell(row=row, column=col["soft"]).value if "soft" in col else None
        out[url] = (acc, cats, soft)
    return out


def export(lot_path, out_path):
    lot = load_json(lot_path)
    past = other_lots(lot["date"])
    kept = old_choices(out_path)
    cats_def = categories()

    wb = Workbook()
    ws = wb.active
    y, m, d = lot["date"].split("-")
    ws.title = f"Lot {d}.{m}.{y}"

    thin = Side(style="thin", color="BDBDBD")
    border = Border(bottom=thin)
    headers = ["Nr", "Accept", "Resursă (click = deschide linkul)", "Categorii", "Software", "Detalii"]
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=c, value=h)
        cell.font = Font(name=F, bold=True, color="FFFFFF", size=10)
        cell.fill = PatternFill("solid", fgColor="1C1C1C")
        cell.alignment = Alignment(horizontal="center" if c in (1, 2, 4) else "left", vertical="center")
    ws.row_dimensions[1].height = 24
    ws["B1"].comment = Comment("Da sau Nu din lista derulantă. Galben = nehotărât.", "justhop")
    ws["D1"].comment = Comment("Coduri separate prin virgulă, prima = categoria principală (max. 3). Ex: GH, SIM", "justhop")
    ws["E1"].comment = Comment("Programele despre care e resursa, separate prin virgulă. Ex: Rhino, Grasshopper. Un program nou apare singur în caseta de pe site.", "justhop")
    for col, w in {"A": 5, "B": 9, "C": 46, "D": 12, "E": 22, "F": 62}.items():
        ws.column_dimensions[col].width = w

    for i, c in enumerate(lot["candidates"], 2):
        accept = c.get("accept") or c.get("suggest")
        cats = ", ".join(c["cats"])
        soft = ", ".join(c.get("software", []))
        if c["url"] in kept:  # alegerile tale din fișier au prioritate față de sugestiile mele
            acc, kc, ks = kept[c["url"]]
            accept = acc if acc in ("Da", "Nu") else None  # și o celulă golită de tine rămâne goală
            if kc:
                cats = kc
            if ks is not None:
                soft = ks
        flagged_text = details(c, lot, past)
        title = c["title"] + ("" if c["platform"] == "YouTube" else f" [{c['platform']}]")

        a = ws.cell(row=i, column=1, value=c["n"])
        b = ws.cell(row=i, column=2, value=accept)
        t = ws.cell(row=i, column=3, value=title)
        k = ws.cell(row=i, column=4, value=cats)
        s = ws.cell(row=i, column=5, value=soft or None)
        e = ws.cell(row=i, column=6, value=flagged_text)
        t.hyperlink = c["url"]
        t.font = Font(name=F, size=10, color="0563C1", underline="single")
        a.font = Font(name=F, size=10, bold=True)
        b.font = Font(name=F, size=11, bold=True)
        k.font = Font(name="Consolas", size=10, bold=True)
        s.font = Font(name=F, size=9)
        e.font = Font(name=F, size=9, color="333333")
        a.alignment = b.alignment = k.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        t.alignment = e.alignment = s.alignment = Alignment(wrap_text=True, vertical="center")
        for cell in (a, b, t, k, s, e):
            cell.border = border
        lines = max(math.ceil(len(title) / 50), math.ceil(len(soft) / 22) if soft else 1,
                    sum(math.ceil(len(p) / 74) for p in flagged_text.split("\n")))
        ws.row_dimensions[i].height = max(22, lines * 13 + 8)

    last = len(lot["candidates"]) + 1
    # rânduri libere sub tabel pentru linkuri noi (validarea Da/Nu se întinde și pe ele)
    val_last = last + 30
    dv = DataValidation(type="list", formula1='"Da,Nu"', allow_blank=True)
    dv.error, dv.errorTitle, dv.showErrorMessage = "Alege Da sau Nu.", "Valoare invalidă", True
    ws.add_data_validation(dv)
    dv.add(f"B2:B{val_last}")

    # dropdown pentru Categorii: lista vine din foaia „Categorii” (se extinde singură când adaugi rânduri);
    # stilul „information” lasă să scrii și mai multe coduri, separate prin virgulă
    dvc = DataValidation(type="list", formula1="ListaCategorii", allow_blank=True, errorStyle="information")
    dvc.errorTitle = "Mai multe categorii?"
    dvc.error = "Valoarea nu e un cod din listă. E în regulă dacă ai scris mai multe coduri separate prin virgulă (ex. GH, SIM). Verific la citire."
    dvc.showErrorMessage = True
    ws.add_data_validation(dvc)
    dvc.add(f"D2:D{val_last}")

    # dropdown pentru Software: lista vine din foaia „Software”; același stil, poți scrie mai multe programe cu virgulă
    dvs = DataValidation(type="list", formula1="ListaSoftware", allow_blank=True, errorStyle="information")
    dvs.errorTitle = "Program nou sau mai multe programe?"
    dvs.error = "Valoarea nu e în listă. E în regulă dacă e un program nou sau mai multe, separate prin virgulă (ex. Rhino, Grasshopper): apare singur în caseta de pe site."
    dvs.showErrorMessage = True
    ws.add_data_validation(dvs)
    dvs.add(f"E2:E{val_last}")

    # foaia Software: lista programelor (cele existente + cele adăugate de tine aici)
    soft_names = sheet_software(out_path)
    seen_s = {x.lower() for x in soft_names}
    soft_names += [s_ for s_ in all_software() if s_.lower() not in seen_s]
    ss = wb.create_sheet("Software")
    hc = ss.cell(row=1, column=1, value="Program")
    hc.font = Font(name=F, bold=True, color="FFFFFF", size=10)
    hc.fill = PatternFill("solid", fgColor="1C1C1C")
    for r_, name in enumerate(soft_names, 2):
        ss.cell(row=r_, column=1, value=name).font = Font(name=F, size=10)
    ss.column_dimensions["A"].width = 34
    ss.column_dimensions["C"].width = 70
    sn_ = ss.cell(row=1, column=3, value=(
        "Lista programelor din caseta de pe site. Un program nou nu trebuie adăugat aici ca să apară pe site: "
        "e destul să-l scrii în coloana Software a unei resurse. Lista de aici doar alimentează dropdown-ul."))
    sn_.font = Font(name=F, size=9, italic=True, color="555555")
    sn_.alignment = Alignment(wrap_text=True, vertical="top")
    ss.row_dimensions[1].height = 48
    ss.freeze_panes = "A2"
    wb.defined_names["ListaSoftware"] = DefinedName(
        "ListaSoftware", attr_text="OFFSET(Software!$A$2,0,0,COUNTA(Software!$A$2:$A$400),1)")

    # foaia Categorii: editabilă; păstrează rândurile adăugate de tine chiar dacă nu au ajuns încă pe site
    sheet_rows = sheet_categories(out_path)
    seen = {r["id"] for r in sheet_rows}
    sheet_rows += [dict(c) for c in cats_def if c["id"] not in seen]
    cs = wb.create_sheet("Categorii")
    for c, h in enumerate(["Cod", "Nume", "Culoare (hex, opțional)"], 1):
        cell = cs.cell(row=1, column=c, value=h)
        cell.font = Font(name=F, bold=True, color="FFFFFF", size=10)
        cell.fill = PatternFill("solid", fgColor="1C1C1C")
    for r, cat in enumerate(sheet_rows, 2):
        cs.cell(row=r, column=1, value=cat["id"]).font = Font(name="Consolas", size=11, bold=True)
        cs.cell(row=r, column=2, value=cat["name"]).font = Font(name=F, size=10)
        col = cs.cell(row=r, column=3, value=cat.get("color") or None)
        col.font = Font(name="Consolas", size=10, color="FFFFFF", bold=True)
        if cat.get("color") and HEX.match(cat["color"]):
            col.fill = PatternFill("solid", fgColor=cat["color"].lstrip("#"))
    for col, w in {"A": 9, "B": 34, "C": 22}.items():
        cs.column_dimensions[col].width = w
    cs.column_dimensions["E"].width = 70
    note = cs.cell(row=1, column=5, value=(
        "Categorie nouă: adaugă un rând la sfârșit (Cod scurt, ex. STR · Nume · Culoare opțional; "
        "dacă o lași goală, aleg eu una).\n"
        "Dropdown-ul Categorii din foaia lotului o vede imediat. Pe site apare când îmi spui „actualizează”."))
    note.font = Font(name=F, size=9, italic=True, color="555555")
    note.alignment = Alignment(wrap_text=True, vertical="top")
    cs.row_dimensions[1].height = 48
    cs.freeze_panes = "A2"
    wb.defined_names["ListaCategorii"] = DefinedName(
        "ListaCategorii", attr_text="OFFSET(Categorii!$A$2,0,0,COUNTA(Categorii!$A$2:$A$200),1)")
    rng = f"B2:B{last}"
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"Da"'], fill=PatternFill("solid", bgColor="C6EFCE", fgColor="C6EFCE"), font=Font(name=F, bold=True, color="006100")))
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"Nu"'], fill=PatternFill("solid", bgColor="FFC7CE", fgColor="FFC7CE"), font=Font(name=F, bold=True, color="9C0006")))
    ws.conditional_formatting.add(rng, FormulaRule(formula=["LEN(B2)=0"], fill=PatternFill("solid", bgColor="FFEB9C", fgColor="FFEB9C")))
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:F{last}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True

    lg = wb.create_sheet("Legendă")
    lg.column_dimensions["A"].width = 12
    lg.column_dimensions["B"].width = 100
    rows = [
        ("Cum completezi", None),
        ("Accept", "Da sau Nu din lista derulantă. Galben = nehotărât, verde = Da, roșu = Nu."),
        ("Categorii", "Alegi din dropdown sau scrii coduri separate prin virgulă; prima e categoria principală, maximum 3. O resursă apare la toate categoriile trecute. Lista codurilor e în foaia „Categorii”, unde poți adăuga și categorii noi."),
        ("Software", "Programele despre care e tutorialul (Rhino, Grasshopper, QGIS…), separate prin virgulă. Alegi din dropdown sau scrii unul nou: apare singur în caseta „Software” de pe site, fără nimic în plus. Lasă gol pentru prelegeri sau materiale fără un program anume."),
        ("Nr", "Numărul din lot; rămâne fix. Îl folosești când ceri „scoate nr 12 din " + f"{d}.{m}.{y}" + "”."),
        ("Link nou", "Lipește linkul în coloana „Resursă”, pe un rând nou sub tabel, lasă restul gol și spune-mi „actualizează”. "
                     "Completez titlul, durata, autorul, categoriile și descrierea, apoi o public."),
        ("⚠ / ↪", "⚠ = rezervă (sponsor, plătit, dată neconfirmată). ↪ = alte resurse ale aceluiași autor."),
    ]
    for r, (a_, b_) in enumerate(rows, 1):
        ca = lg.cell(row=r, column=1, value=a_)
        cb = lg.cell(row=r, column=2, value=b_)
        ca.font = Font(name=F, size=10, bold=True)
        cb.font = Font(name=F, size=10)
        cb.alignment = Alignment(wrap_text=True, vertical="top")
        ca.alignment = Alignment(vertical="top")
    lg["A1"].font = Font(name=F, size=12, bold=True)

    wb.save(out_path)
    print(f"scris {out_path}: {len(lot['candidates'])} rânduri")


def read(xlsx_path, lot_path, cats_out=None):
    lot = load_json(lot_path)
    known = {c["id"]: c for c in categories()}
    sheet = sheet_categories(xlsx_path)
    valid = set(known) | {c["id"] for c in sheet}  # codurile din foaie sunt valide chiar înainte de sincronizare
    ws = load_workbook(xlsx_path).worksheets[0]
    col = columns(ws)
    has_cats = "cats" in col
    by_n = {c["n"]: c for c in lot["candidates"]}
    known_soft = {s.lower(): s for s in all_software()}
    report = {"updated": 0, "da": 0, "nu": 0, "undecided": 0, "newLinks": [], "badCats": [], "unknownNr": [], "newSoftware": []}
    for row in range(2, ws.max_row + 1):
        nr = ws.cell(row=row, column=col.get("nr", 1)).value
        title_cell = ws.cell(row=row, column=col.get("res", 3))
        acc = ws.cell(row=row, column=col.get("accept", 2)).value
        acc = acc.strip().capitalize() if isinstance(acc, str) and acc.strip() else None
        if nr is None:
            val = title_cell.value
            if isinstance(val, str) and re.match(r"https?://", val.strip()):
                report["newLinks"].append({"row": row, "url": val.strip(), "accept": acc if acc in ("Da", "Nu") else None})
            continue
        c = by_n.get(int(nr))
        if not c:
            report["unknownNr"].append(nr)
            continue
        c["accept"] = acc if acc in ("Da", "Nu") else None
        report["updated"] += 1
        report["da" if c["accept"] == "Da" else "nu" if c["accept"] == "Nu" else "undecided"] += 1
        if has_cats:
            raw = ws.cell(row=row, column=col["cats"]).value or ""
            codes = [x for x in re.split(r"[,;/\s]+", str(raw).upper()) if x]
            bad = [x for x in codes if x not in valid]
            if bad or not codes:
                report["badCats"].append({"nr": nr, "valoare": raw})
            else:
                c["cats"] = codes
        if "soft" in col:
            names = split_list(ws.cell(row=row, column=col["soft"]).value)
            c["software"] = [known_soft.get(n.lower(), n) for n in names]    # se aliniază la scrierea deja folosită
            for n in names:
                if n.lower() not in known_soft and n not in report["newSoftware"]:
                    report["newSoftware"].append(n)
    with open(lot_path, "w", encoding="utf-8") as f:
        json.dump(lot, f, ensure_ascii=False, indent=2)
        f.write("\n")
    report["newCategories"] = [c for c in sheet if c["id"] not in known]
    report["changedCategories"] = [c["id"] for c in sheet if c["id"] in known and (
        (c["name"] and c["name"] != known[c["id"]]["name"]) or (c["color"] and c["color"].lower() != known[c["id"]]["color"].lower()))]
    if cats_out:  # lista din foaie, pentru: node scripts/resurse.js sync-categories <fișier>
        with open(cats_out, "w", encoding="utf-8") as f:
            json.dump(sheet, f, ensure_ascii=False, indent=2)
            f.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "export" and len(sys.argv) == 4:
        export(sys.argv[2], sys.argv[3])
    elif cmd == "read" and len(sys.argv) in (4, 5):
        read(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) == 5 else None)
    else:
        print(__doc__)
        sys.exit(1)
