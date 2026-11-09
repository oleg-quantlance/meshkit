#!/usr/bin/env python3
"""Builds the MeshKit Filament Inventory Tracker workbook (Etsy product).

Spools: up to 60 spools with the empty-spool (tare) weight looked up from the
Tare DB (built from src/data/spools.json) so that "grams left" is
gross weight minus tare, as in src/core/spool.ts.

    python tools/etsy/build_filament_tracker.py            # -> tools/etsy/dist/MeshKit-Filament-Inventory-Tracker-v1.0.xlsx
    python tools/etsy/build_filament_tracker.py --verify   # recalculates with `formulas` and checks the sample rows
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402

VERSION = "1.0"
ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
OUT = ROOT / "dist" / f"MeshKit-Filament-Inventory-Tracker-v{VERSION}.xlsx"
CAMPAIGN = "filament"
SPOOL_ROWS = 60
LOG_ROWS = 100
CUSTOM_TARE_ROWS = 15
TARE_URL = "https://meshkit.pro/empty-spool-weight-database?utm_source=etsy"

MATERIALS = ["PLA", "PLA+", "PETG", "ABS", "ASA", "TPU", "Nylon", "PC", "PVA", "HIPS", "CF-filled", "Other"]
CUSTOM_MATERIALS = 3
LOCATIONS = ["Dry box 1", "Dry box 2", "Dry box 3", "Shelf", "AMS / MMU", "On printer"]
CUSTOM_LOCATIONS = 4

SAMPLE_SPOOLS = [
    # brand, material, colour, purchased, price, net g, tare override, gross now, location, opened
    ("Bambu Lab reusable spool", "PLA", "Jade white", dt.date(2026, 9, 12), 19.99, 1000, None, 820, "AMS / MMU", dt.date(2026, 9, 14)),
    ("Polymaker 1 kg", "PETG", "Black", dt.date(2026, 8, 3), 22.99, 1000, None, 265, "Dry box 1", dt.date(2026, 8, 5)),
    ("Sunlu 1 kg (black)", "PLA+", "Grey", dt.date(2026, 10, 1), 16.49, 1000, None, 1190, "Shelf", None),
    ("Hatchbox 1 kg", "ABS", "Red", dt.date(2026, 7, 20), 24.99, 1000, 231, 410, "Dry box 2", dt.date(2026, 7, 22)),
]
SAMPLE_LOG = [
    (dt.date(2026, 11, 1), "Dry box 1", 0.18, "No", ""),
    (dt.date(2026, 11, 1), "Dry box 2", 0.34, "Yes", "Desiccant was saturated"),
    (dt.date(2026, 11, 8), "Dry box 1", 0.21, "No", ""),
]


def load_spools():
    data = json.loads((REPO / "src" / "data" / "spools.json").read_text())
    makers = {m["slug"]: m["name"] for m in data["makers"]}
    rows = []
    for s in data["spools"]:
        rows.append({
            "brand": s["brand"],
            "maker": makers.get(s["maker"], "Generic") if s["maker"] else "Generic",
            "line": s["line"],
            "type": s["material"],
            "net": s["netG"],
            "tare": s["tareG"],
            "count": len(s["measurements"]),
            "source": ", ".join(sorted({m["source"] for m in s["measurements"]})),
            "verified": max(m["date"] for m in s["measurements"]),
        })
    return data, rows


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
def build_settings(wb):
    ws = wb.create_sheet("Settings")
    C.widths(ws, {"A": 44, "B": 16, "C": 70})
    C.title(ws, "Settings", "Type in the yellow cells. Lists feed the dropdowns on Spools and Dry Box Log.")
    S = {}
    rows = [
        ("Low-stock threshold (g left)", "LowG", 150, "0", "Spools at or below this show LOW on Spools and are counted on Summary."),
        ("Default net weight of a new spool (g)", "NetDefault", 1000, "0", "Used when the Net weight cell on a Spools row is blank."),
        ("Tare to use when a brand is not in the Tare DB (g)", "TareDefault", 220, "0", "Generic plastic spool; cardboard is closer to 140 g. Override per spool in the Tare override column."),
        ("Dry box humidity warning (%)", "HumMax", 0.30, C.PCT, "Readings above this are flagged HIGH on Dry Box Log. Under 20% is ideal for nylon and TPU."),
    ]
    r = 4
    for label, key, default, fmt, help_ in rows:
        ws.cell(row=r, column=1, value=label)
        C.input_cell(ws, f"B{r}", default, fmt)
        ws.cell(row=r, column=3, value=help_).font = C.MUTED
        S[key] = f"Settings!$B${r}"
        r += 1
    r += 1
    ws.cell(row=r, column=1, value="MATERIALS").font = C.H2_FONT
    ws.cell(row=r, column=3, value="Rename or add in the blank yellow cells; Summary groups by these.").font = C.MUTED
    r += 1
    first = r
    for i in range(len(MATERIALS) + CUSTOM_MATERIALS):
        C.input_cell(ws, f"A{first + i}", MATERIALS[i] if i < len(MATERIALS) else None)
    last = first + len(MATERIALS) + CUSTOM_MATERIALS - 1
    S["MatList"] = f"Settings!$A${first}:$A${last}"
    S["MatFirst"], S["MatLast"] = first, last
    r = last + 2
    ws.cell(row=r, column=1, value="LOCATIONS AND DRY BOXES").font = C.H2_FONT
    r += 1
    first = r
    for i in range(len(LOCATIONS) + CUSTOM_LOCATIONS):
        C.input_cell(ws, f"A{first + i}", LOCATIONS[i] if i < len(LOCATIONS) else None)
    last = first + len(LOCATIONS) + CUSTOM_LOCATIONS - 1
    S["LocList"] = f"Settings!$A${first}:$A${last}"
    S["LocFirst"], S["LocLast"] = first, last
    ws.freeze_panes = "A4"
    C.protect(ws)
    return S


# ---------------------------------------------------------------------------
# Tare DB
# ---------------------------------------------------------------------------
def build_tare_db(wb):
    ws = wb.create_sheet("Tare DB")
    data, rows = load_spools()
    C.widths(ws, {"A": 32, "B": 22, "C": 36, "D": 12, "E": 9, "F": 9, "G": 13, "H": 14, "I": 13})
    C.title(ws, "Tare DB - empty spool weights", data["disclaimer"])
    HR = 4
    C.header(ws, HR, ["Brand / spool (dropdown value)", "Maker", "Line", "Spool type", "Net g", "Tare g", "Measurements", "Source", "Last verified"], height=30)
    r = HR + 1
    for s in rows:
        vals = [s["brand"], s["maker"], s["line"], s["type"], s["net"], s["tare"], s["count"], s["source"], s["verified"]]
        for col, v in enumerate(vals, start=1):
            c = ws.cell(row=r, column=col, value=v)
            c.border = C.BOX
            if col == 6:
                c.font = C.BOLD
        r += 1
    custom_first = r
    for i in range(CUSTOM_TARE_ROWS):
        for col in range(1, 10):
            C.input_cell(ws, ws.cell(row=r, column=col))
        if i == 0:
            ws.cell(row=r, column=1).value = None
        r += 1
    last = r - 1
    ws.cell(row=custom_first, column=10, value="<- yellow rows: add your own spools (weigh an empty one once). They appear in the Brand dropdown.").font = C.MUTED
    r += 1
    c = ws.cell(row=r, column=1, value=f"Community-maintained at {TARE_URL}")
    c.hyperlink = TARE_URL
    c.font = Font(bold=True, color=C.ACCENT, underline="single")
    ws.cell(row=r + 1, column=1, value=f"Data snapshot {data['lastVerified']}. Submit your own measurement on that page; medians of community measurements update the online table.").font = C.MUTED
    ws.freeze_panes = f"A{HR + 1}"
    C.protect(ws)
    return {"first": HR + 1, "last": last, "n_db": len(rows), "custom_first": custom_first,
            "BrandList": f"'Tare DB'!$A${HR + 1}:$A${last}", "Table": f"'Tare DB'!$A${HR + 1}:$F${last}"}


# ---------------------------------------------------------------------------
# Spools
# ---------------------------------------------------------------------------
SPOOL_COLS = [
    ("#", 5), ("Brand / spool", 28), ("Material", 10), ("Colour", 12), ("Purchased", 11), ("Price paid ($)", 10),
    ("Net weight (g, blank = default)", 12), ("Tare override (g)", 10), ("Tare used (g)", 10), ("Gross weight now (g)", 11),
    ("Grams left", 10), ("% left", 8), ("Cost per g", 10), ("Value left ($)", 11), ("Flag", 11),
    ("Location", 13), ("Opened", 11), ("Notes", 30),
]


def build_spools(wb, S, T):
    ws = wb.create_sheet("Spools")
    C.title(ws, "Spools - what is on the shelf",
            "Pick the brand, type the gross weight from your kitchen scale; grams left = gross - tare. Tare comes from the Tare DB unless you override it. Yellow = type, grey = calculated.")
    HR = 4
    C.header(ws, HR, [h for h, _ in SPOOL_COLS], height=44)
    for i, (_, w) in enumerate(SPOOL_COLS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    first = HR + 1
    last = first + SPOOL_ROWS - 1
    for i in range(SPOOL_ROWS):
        r = first + i
        ws.cell(row=r, column=1, value=i + 1)
        for col, fmt in ((2, None), (3, None), (4, None), (5, C.DATE), (6, C.MONEY), (7, "0"), (8, "0"), (10, "0"), (16, None), (17, C.DATE), (18, None)):
            C.input_cell(ws, ws.cell(row=r, column=col), fmt=fmt)
        if i < len(SAMPLE_SPOOLS):
            b, m, colour, pd, price, net, tare_ov, gross, loc, opened = SAMPLE_SPOOLS[i]
            for col, v in ((2, b), (3, m), (4, colour), (5, pd), (6, price), (7, net), (8, tare_ov), (10, gross), (16, loc), (17, opened)):
                ws.cell(row=r, column=col, value=v)
        active = f'OR(B{r}<>"",J{r}<>"")'
        net = f'IF(G{r}="",{S["NetDefault"]},G{r})'
        f = {
            "I": f'=IF({active},IF(H{r}<>"",H{r},IFERROR(VLOOKUP(B{r},{T["Table"]},6,FALSE),{S["TareDefault"]})),"")',
            "K": f'=IF(I{r}="","",IF(J{r}="","",MAX(0,J{r}-I{r})))',
            "L": f'=IF(K{r}="","",K{r}/{net})',
            "M": f'=IF(I{r}="","",IF(F{r}="","",F{r}/{net}))',
            "N": f'=IF(K{r}="","",IF(M{r}="","",K{r}*M{r}))',
            "O": f'=IF(I{r}="","",IF(K{r}="","Not weighed",IF(K{r}>{net}*1.05,"CHECK TARE",IF(K{r}<={S["LowG"]},"LOW",""))))',
        }
        fmts = {"I": "0", "K": "0", "L": "0%", "M": C.MONEY4, "N": C.MONEY, "O": None}
        for col, formula in f.items():
            C.calc_cell(ws, f"{col}{r}", formula, fmts[col], bold=col == "K")
    tr = last + 1
    ws.cell(row=tr, column=2, value="Totals").font = C.BOLD
    C.calc_cell(ws, f"F{tr}", f"=SUM(F{first}:F{last})", C.MONEY, bold=True)
    C.calc_cell(ws, f"K{tr}", f"=SUM(K{first}:K{last})", "#,##0", bold=True)
    C.calc_cell(ws, f"N{tr}", f"=SUM(N{first}:N{last})", C.MONEY, bold=True)
    C.calc_cell(ws, f"O{tr}", f'=COUNTIF(O{first}:O{last},"LOW")&" low"', None, bold=True)
    C.list_validation(ws, "=" + T["BrandList"], [f"B{first}:B{last}"])
    C.list_validation(ws, "=" + S["MatList"], [f"C{first}:C{last}"])
    C.list_validation(ws, "=" + S["LocList"], [f"P{first}:P{last}"])
    ws.freeze_panes = f"C{first}"
    C.protect(ws)
    return {"first": first, "last": last, "totals": tr}


# ---------------------------------------------------------------------------
# Dry Box Log
# ---------------------------------------------------------------------------
def build_log(wb, S):
    ws = wb.create_sheet("Dry Box Log")
    C.widths(ws, {"A": 12, "B": 14, "C": 11, "D": 13, "E": 36, "F": 9})
    C.title(ws, "Dry Box Log", "One row per reading. Humidity as a percent (type 25 for 25%). Readings above the Settings warning level are flagged HIGH.")
    HR = 4
    C.header(ws, HR, ["Date", "Box", "Humidity %", "Desiccant changed?", "Notes", "Flag"], height=30)
    first = HR + 1
    last = first + LOG_ROWS - 1
    for i in range(LOG_ROWS):
        r = first + i
        for col, fmt in ((1, C.DATE), (2, None), (3, "0%"), (4, None), (5, None)):
            C.input_cell(ws, ws.cell(row=r, column=col), fmt=fmt)
        if i < len(SAMPLE_LOG):
            for col, v in enumerate(SAMPLE_LOG[i], start=1):
                ws.cell(row=r, column=col, value=v if v != "" else None)
        C.calc_cell(ws, f"F{r}", f'=IF(C{r}="","",IF(C{r}>{S["HumMax"]},"HIGH","ok"))')
    C.list_validation(ws, "=" + S["LocList"], [f"B{first}:B{last}"])
    C.list_validation(ws, ["Yes", "No"], [f"D{first}:D{last}"])
    ws.freeze_panes = f"A{first}"
    C.protect(ws)
    return {"first": first, "last": last}


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
def build_summary(wb, S, P, L):
    ws = wb.create_sheet("Summary")
    C.widths(ws, {"A": 34, "B": 14, "C": 14, "D": 14, "E": 12})
    C.title(ws, "Summary", "Everything here is calculated from Spools and Dry Box Log.")
    sp = lambda col: f"Spools!${col}${P['first']}:${col}${P['last']}"  # noqa: E731
    lg = lambda col: f"'Dry Box Log'!${col}${L['first']}:${col}${L['last']}"  # noqa: E731
    kpis = [
        ("Spools logged", f"=COUNTA({sp('B')})", "0"),
        ("Spools weighed", f"=COUNT({sp('K')})", "0"),
        ("Total filament on hand (g)", f"=SUM({sp('K')})", "#,##0"),
        ("Total value on hand ($)", f"=SUM({sp('N')})", C.MONEY),
        ("Total spent on filament ($)", f"=SUM({sp('F')})", C.MONEY),
        ("Spools low (at or below threshold)", f'=COUNTIF({sp("O")},"LOW")', "0"),
        ("Spools to re-check tare", f'=COUNTIF({sp("O")},"CHECK TARE")', "0"),
        ("Spools not weighed yet", f'=COUNTIF({sp("O")},"Not weighed")', "0"),
        ("Dry box readings above the warning level", f'=COUNTIF({lg("F")},"HIGH")', "0"),
        ("Last dry box reading", f'=IF(COUNT({lg("A")})=0,"",MAX({lg("A")}))', C.DATE),
    ]
    r = 4
    K = {}
    for label, formula, fmt in kpis:
        ws.cell(row=r, column=1, value=label)
        C.calc_cell(ws, f"B{r}", formula, fmt, bold=True)
        K[label] = f"B{r}"
        r += 1
    ws[f"B{K['Total filament on hand (g)']}"].font = C.BIG_RESULT
    r += 1
    ws.cell(row=r, column=1, value="BY MATERIAL").font = C.H2_FONT
    r += 1
    C.header(ws, r, ["Material", "Spools", "Grams left", "Value left ($)", "Low"])
    r += 1
    mfirst = r
    n_mat = S["MatLast"] - S["MatFirst"] + 1
    for i in range(n_mat):
        mr = S["MatFirst"] + i
        C.calc_cell(ws, f"A{r}", f"=IF(Settings!$A${mr}=\"\",\"\",Settings!$A${mr})")
        C.calc_cell(ws, f"B{r}", f'=IF(A{r}="","",COUNTIFS({sp("C")},A{r}))', "0")
        C.calc_cell(ws, f"C{r}", f'=IF(A{r}="","",SUMIFS({sp("K")},{sp("C")},A{r}))', "#,##0")
        C.calc_cell(ws, f"D{r}", f'=IF(A{r}="","",SUMIFS({sp("N")},{sp("C")},A{r}))', C.MONEY)
        C.calc_cell(ws, f"E{r}", f'=IF(A{r}="","",COUNTIFS({sp("C")},A{r},{sp("O")},"LOW"))', "0")
        r += 1
    mlast = r - 1
    ws.cell(row=r, column=1, value="Total").font = C.BOLD
    for col, fmt in (("B", "0"), ("C", "#,##0"), ("D", C.MONEY), ("E", "0")):
        C.calc_cell(ws, f"{col}{r}", f"=SUM({col}{mfirst}:{col}{mlast})", fmt, bold=True)
    K["mat_total_row"] = r
    chart = BarChart()
    chart.type = "col"
    chart.style = 10
    chart.title = "Grams left by material"
    chart.legend = None
    chart.height, chart.width = 7.5, 16
    chart_last = mfirst + len(MATERIALS) - 1
    chart.add_data(Reference(ws, min_col=3, min_row=mfirst, max_row=chart_last), titles_from_data=False)
    chart.set_categories(Reference(ws, min_col=1, min_row=mfirst, max_row=chart_last))
    chart.series[0].graphicalProperties.solidFill = C.ACCENT
    ws.add_chart(chart, "G4")
    C.protect(ws)
    return K


LIMITATIONS = [
    ("Tare weights are typical, not exact", "Spools vary by batch and humidity by 5-15 g, so grams left can be off by that much.", "Weigh one empty spool per brand and type it in the Tare override column or add a row to the Tare DB."),
    ("No metres or print-count estimate", "The sheet tracks grams only.", "The free spool calculator at meshkit.pro converts grams to metres for any material and diameter."),
    ("No barcode or scale integration", "Every gross weight is typed by hand.", "Weigh spools when you load them and when you unload them; two numbers per spool per print session is enough."),
    ("One material per spool row", "Multi-colour or multi-material spools are not split.", "Log each physical spool once; put the detail in Notes."),
    ("Low-stock is a single threshold", "150 g is right for small parts but not for a 400 g vase.", "Change the threshold on Settings, or sort by % left."),
    ("Dry box log is not charted per box", "Summary counts HIGH readings and shows the last date only.", "Filter the Dry Box Log by box, or copy a box's rows next to a chart."),
]
STEPS = [
    "Check Settings: low-stock threshold, default spool weight and the dry box humidity warning. Add any materials or locations you use.",
    "On Spools, pick the brand from the dropdown (the Tare DB fills in the empty-spool weight), the material and colour, and type the price and the gross weight from your scale.",
    "Grams left, % left, cost per gram and value left are calculated. A spool at or below the threshold shows LOW; a weight that cannot be right shows CHECK TARE.",
    "If your brand is missing, weigh one empty spool and add it to the yellow rows at the bottom of Tare DB, or type the tare in the override column.",
    "Log humidity readings on Dry Box Log; Summary totals grams and value by material, counts low spools and charts what is on hand. Four sample spools and three log rows are included: overwrite or clear them.",
]
NOTES = [
    "Gross weight means the spool as it is now, filament included. Grams left = gross - tare, as in the free spool calculator at meshkit.pro.",
]


def build():
    wb = Workbook()
    wb.remove(wb.active)
    S = build_settings(wb)
    T = build_tare_db(wb)
    P = build_spools(wb, S, T)
    L = build_log(wb, S)
    K = build_summary(wb, S, P, L)
    C.build_limitations(wb, rows=LIMITATIONS, campaign=CAMPAIGN,
                        intro="A spreadsheet is a fine inventory for a shelf of spools. These are its edges and what to do about each.")
    C.build_start(wb, product="Filament Inventory Tracker", version=VERSION, steps=STEPS, campaign=CAMPAIGN, notes=NOTES)
    order = ["Start Here", "Spools", "Tare DB", "Dry Box Log", "Summary", "Settings", "Limitations"]
    wb._sheets = [wb[n] for n in order]
    wb.active = 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    return OUT, S, T, P, L, K


def verify(path, S, T, P, L, K):
    ok = True
    sheets = ["Start Here", "Spools", "Tare DB", "Dry Box Log", "Summary", "Settings", "Limitations"]
    vals = C.recalc(path)
    errs = C.scan_errors(vals, sheets)
    if errs:
        ok = False
        print("errors in default workbook:", *errs[:20], sep="\n  ")
    f = P["first"]
    # row 1: Bambu reusable (tare 250), gross 820 -> 570 g, 57%, $19.99/1000 per g -> value 11.3943
    checks = [
        (("SPOOLS", f"I{f}"), 250), (("SPOOLS", f"K{f}"), 570), (("SPOOLS", f"L{f}"), 0.57),
        (("SPOOLS", f"N{f}"), 570 * 19.99 / 1000),
        # row 2: Polymaker cardboard 140 -> 125 g left -> LOW
        (("SPOOLS", f"K{f + 1}"), 125),
        # row 3: Sunlu plastic 195, gross 1190 -> 995 g
        (("SPOOLS", f"K{f + 2}"), 995),
        # row 4: override 231 -> 179 g
        (("SPOOLS", f"I{f + 3}"), 231), (("SPOOLS", f"K{f + 3}"), 179),
    ]
    for key, exp in checks:
        got = vals[key]
        if not C.close(got, exp):
            ok = False
            print(f"  !! {key} = {got}, expected {exp}")
    flags = [vals[("SPOOLS", f"O{f + i}")] for i in range(5)]
    print("sample flags:", flags)
    assert flags == ["", "LOW", "", "", ""], flags
    assert vals[("SPOOLS", f"K{P['last']}")] == "", "blank rows must stay blank"
    total_g = C.num(vals[("SUMMARY", K["Total filament on hand (g)"])])
    total_v = C.num(vals[("SUMMARY", K["Total value on hand ($)"])])
    low = C.num(vals[("SUMMARY", K["Spools low (at or below threshold)"])])
    logged = C.num(vals[("SUMMARY", K["Spools logged"])])
    high = C.num(vals[("SUMMARY", K["Dry box readings above the warning level"])])
    mat_total = C.num(vals[("SUMMARY", f"C{K['mat_total_row']}")])
    exp_g = 570 + 125 + 995 + 179
    exp_v = 570 * 19.99 / 1000 + 125 * 22.99 / 1000 + 995 * 16.49 / 1000 + 179 * 24.99 / 1000
    print(f"summary: logged {logged:.0f}, grams {total_g:.0f} (exp {exp_g}), value {total_v:.2f} (exp {exp_v:.2f}), low {low:.0f}, "
          f"high humidity readings {high:.0f}, by-material total {mat_total:.0f}")
    for name, g, e in (("grams", total_g, exp_g), ("value", total_v, exp_v), ("low", low, 1), ("logged", logged, 4), ("high", high, 1), ("mat_total", mat_total, exp_g)):
        if not C.close(g, e):
            ok = False
            print(f"  !! summary {name}: {g} vs {e}")
    # Tare DB row count equals spools.json
    _, rows = load_spools()
    assert T["n_db"] == len(rows) >= 14, T["n_db"]
    print(f"tare db: {T['n_db']} brands from src/data/spools.json + {CUSTOM_TARE_ROWS} custom rows")
    print("VERIFY:", "PASS" if ok else "FAIL")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    out = build()
    print(f"wrote {out[0]} ({out[0].stat().st_size // 1024} KB)")
    if "--verify" in sys.argv:
        verify(*out)
