#!/usr/bin/env python3
"""Builds the MeshKit 3D Print Pricing Calculator workbook (Etsy product).

The maths is a line-for-line port of src/core/cost.ts (calculatePrintCost):
adjusted hours with a time-correction %, material / energy / wear costs, a
failure buffer, unit cost, two pricing modes (markup multiplier or target
margin after fees), channel fee % + fixed fee, profit, margin and a
below-cost warning. The sheet adds labour, post-processing and shipping on
top of the engine's unit cost before pricing.

    python tools/etsy/build_pricing.py            # -> tools/etsy/dist/MeshKit-3D-Print-Pricing-Calculator-v1.0.xlsx
    python tools/etsy/build_pricing.py --verify   # also recalculates with `formulas` and checks the engine fixtures
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402

VERSION = "1.0"
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dist" / f"MeshKit-3D-Print-Pricing-Calculator-v{VERSION}.xlsx"
CAMPAIGN = "pricing"
BATCH_ROWS = 30

MATERIALS = [("PLA", 20), ("PETG", 25), ("ABS", 22), ("ASA", 28), ("TPU", 35), ("Nylon", 45), ("Resin", 35)]
CUSTOM_MATERIALS = 3
# channel, transaction %, payment %, payment fixed $, listing fee $
CHANNELS = [
    ("Etsy", 0.065, 0.03, 0.25, 0.20),
    ("Shopify", 0.0, 0.029, 0.30, 0.0),
    ("eBay", 0.1325, 0.0, 0.30, 0.0),
    ("Direct", 0.0, 0.0, 0.0, 0.0),
]
CUSTOM_CHANNELS = 1
MODES = ["Markup multiplier", "Target margin"]


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
def build_settings(wb):
    ws = wb.create_sheet("Settings")
    C.widths(ws, {"A": 42, "B": 18, "C": 18, "D": 18, "E": 16, "F": 16, "G": 16, "H": 50})
    C.title(ws, "Settings - your printer, shop and marketplace fees",
            "Type in the yellow cells once. Quote and Batch read everything from here.")
    S = {}
    rows = [
        ("PRINTER AND SHOP", None, None, None, None),
        ("Printer power draw (W)", "Watts", 150, "0", "Average draw while printing. Typical desktop FDM: 100-200 W; large or enclosed: 250-400 W."),
        ("Electricity rate ($ per kWh)", "Rate", 0.16, C.MONEY, "From your utility bill."),
        ("Machine wear and maintenance ($ per hour)", "Wear", 0.15, C.MONEY, "Printer price / expected lifetime hours, plus nozzles, belts, plates. $0.10-0.30 is typical."),
        ("Failure and waste buffer (%)", "Fail", 0.07, C.PCT, "Covers failed prints, purge and supports. Applied to material + energy + wear."),
        ("Labour rate ($ per hour)", "Labour", 20, C.MONEY, "What your time is worth for setup, removal and finishing."),
        ("Print-time correction (%)", "TimeCorr", 0.0, C.PCT, "Slicers usually under-estimate. +10% is a common correction; 0 = use slicer time as-is."),
        ("PRICING", None, None, None, None),
        ("Pricing mode", "Mode", MODES[0], None, "Markup multiplier: price = cost x multiplier (+ fees). Target margin: price is solved so the margin AFTER fees equals the target."),
        ("Default markup multiplier", "Markup", 3.5, "0.00", "3-4x is common for small shops; below 1x sells at a loss."),
        ("Default target margin (%)", "Target", 0.50, C.PCT, "Profit as a share of the selling price, after marketplace fees. Must be under 100% minus the fee %."),
        ("Etsy offsite ads fee (%)", "Ads", 0.15, C.PCT, "Charged only on orders attributed to Etsy offsite ads (12% for shops over $10k/yr). Toggle per quote."),
    ]
    r = 4
    for label, key, default, fmt, help_ in rows:
        if key is None:
            ws.cell(row=r, column=1, value=label).font = C.H2_FONT
            r += 1
            continue
        ws.cell(row=r, column=1, value=label)
        C.input_cell(ws, f"B{r}", default, fmt)
        ws.cell(row=r, column=3, value=help_).font = C.MUTED
        S[key] = f"Settings!$B${r}"
        if key == "Mode":
            C.list_validation(ws, MODES, [f"B{r}"], allow_blank=False)
        r += 1

    r += 1
    ws.cell(row=r, column=1, value="MATERIAL PRICES").font = C.H2_FONT
    ws.cell(row=r, column=3, value="Add your own materials in the blank yellow rows; they appear in the dropdowns.").font = C.MUTED
    r += 1
    C.header(ws, r, ["Material", "Price per kg ($)", "Notes"])
    first = r + 1
    for i in range(len(MATERIALS) + CUSTOM_MATERIALS):
        rr = first + i
        name, price = MATERIALS[i] if i < len(MATERIALS) else (None, None)
        C.input_cell(ws, f"A{rr}", name)
        C.input_cell(ws, f"B{rr}", price, C.MONEY)
        C.input_cell(ws, f"C{rr}")
    last = first + len(MATERIALS) + CUSTOM_MATERIALS - 1
    S["MatNames"] = f"Settings!$A${first}:$A${last}"
    S["MatTable"] = f"Settings!$A${first}:$B${last}"
    r = last + 2

    ws.cell(row=r, column=1, value="MARKETPLACE FEES").font = C.H2_FONT
    ws.cell(row=r, column=3, value="Checked November 2026 (US). Fees change - edit the yellow cells. Etsy: 6.5% transaction + 3% + $0.25 payment + $0.20 listing.").font = C.MUTED
    r += 1
    C.header(ws, r, ["Channel", "Transaction fee %", "Payment processing %", "Payment fixed fee ($)", "Listing fee ($)", "Total % (calc)", "Total fixed $ (calc)"], height=32)
    first = r + 1
    for i in range(len(CHANNELS) + CUSTOM_CHANNELS):
        rr = first + i
        row = CHANNELS[i] if i < len(CHANNELS) else (None, None, None, None, None)
        C.input_cell(ws, f"A{rr}", row[0])
        C.input_cell(ws, f"B{rr}", row[1], C.PCT)
        C.input_cell(ws, f"C{rr}", row[2], C.PCT)
        C.input_cell(ws, f"D{rr}", row[3], C.MONEY)
        C.input_cell(ws, f"E{rr}", row[4], C.MONEY)
        C.calc_cell(ws, f"F{rr}", f"=N(B{rr})+N(C{rr})", C.PCT)
        C.calc_cell(ws, f"G{rr}", f"=N(D{rr})+N(E{rr})", C.MONEY)
    last = first + len(CHANNELS) + CUSTOM_CHANNELS - 1
    S["ChanNames"] = f"Settings!$A${first}:$A${last}"
    S["ChanTable"] = f"Settings!$A${first}:$G${last}"
    S["EtsyRow"] = first
    ws.freeze_panes = "A4"
    C.protect(ws)
    return S


# ---------------------------------------------------------------------------
# Quote + hidden Calc
# ---------------------------------------------------------------------------
QUOTE_INPUTS = [
    ("THE PRINT", None, None, None, None),
    ("Material", "Mat", "PLA", None, "Dropdown from Settings."),
    ("Price per kg override ($, blank = Settings price)", "PpkOverride", None, C.MONEY, "Use for a specific spool price."),
    ("Filament used (g)", "Grams", 48.5, "0.0", "From the slicer. Include supports and purge."),
    ("Print time (hours)", "Hours", 3.7, "0.00", "Slicer estimate; Settings can correct it by a %."),
    ("Labour (minutes per unit)", "LabourMin", 10, "0", "Setup, removal, support cleanup, packing."),
    ("Post-processing, hardware, inserts ($ per unit)", "Post", 0, C.MONEY, "Paint, magnets, screws, sanding supplies."),
    ("Shipping and packaging ($ per unit)", "Ship", 0, C.MONEY, "Leave 0 if the buyer pays shipping separately."),
    ("Quantity in this order", "Qty", 1, "0", ""),
    ("SELLING", None, None, None, None),
    ("Channel", "Chan", "Etsy", None, "Fee table lives on Settings."),
    ("Etsy offsite ads on this order?", "Ads", "No", None, "Yes adds the offsite-ads % (Settings) to the fee rate. Etsy only."),
    ("Markup multiplier (blank = Settings default)", "MarkupOv", None, "0.00", "Used only in Markup multiplier mode."),
    ("Target margin % (blank = Settings default)", "TargetOv", None, C.PCT, "Used only in Target margin mode."),
]

CALC_ROWS = [
    ("pricePerKg", "=IF({PpkOverride}<>\"\",{PpkOverride},IFERROR(VLOOKUP({Mat},{MatTable},2,FALSE),0))"),
    ("adjustedHours", "={Hours}*(1+{TimeCorr})"),
    ("materialCost", "={Grams}/1000*{pricePerKg}"),
    ("energyCost", "={Watts}/1000*{adjustedHours}*{Rate}"),
    ("wearCost", "={adjustedHours}*{Wear}"),
    ("baseTotal", "={materialCost}+{energyCost}+{wearCost}"),
    ("engineUnitCost", "={baseTotal}*(1+{Fail})"),
    ("failureBuffer", "={engineUnitCost}-{baseTotal}"),
    ("labourCost", "={LabourMin}/60*{Labour}"),
    ("totalCost", "={engineUnitCost}+{labourCost}+{Post}+{Ship}"),
    ("feeRate", "=IFERROR(VLOOKUP({Chan},{ChanTable},6,FALSE),0)+IF(AND({Chan}=\"Etsy\",{Ads}=\"Yes\"),{AdsPct},0)"),
    ("feeFixed", "=IFERROR(VLOOKUP({Chan},{ChanTable},7,FALSE),0)"),
    ("markup", "=IF({MarkupOv}<>\"\",{MarkupOv},{Markup})"),
    ("targetMargin", "=IF({TargetOv}<>\"\",{TargetOv},{Target})"),
    ("isTargetMode", "=IF({Mode}=\"Target margin\",1,0)"),
    ("denomTarget", "=1-{feeRate}-{targetMargin}"),
    ("denomMarkup", "=1-{feeRate}"),
    ("price", "=IF({isTargetMode}=1,IF({denomTarget}<=0,0,({totalCost}+{feeFixed})/{denomTarget}),IF({denomMarkup}<=0,0,({totalCost}*{markup}+{feeFixed})/{denomMarkup}))"),
    ("fees", "={price}*{feeRate}+{feeFixed}"),
    ("profit", "={price}-{totalCost}-{fees}"),
    ("margin", "=IF({price}>0,{profit}/{price},\"\")"),
    ("belowCost", "=IF(OR(AND({isTargetMode}=0,{markup}<1),AND({price}<{totalCost},{totalCost}>0)),1,0)"),
    ("invalid", "=IF({isTargetMode}=1,IF({denomTarget}<=0,1,0),IF({denomMarkup}<=0,1,0))"),
    ("priceForTarget", "=IF({denomTarget}<=0,0,({totalCost}+{feeFixed})/{denomTarget})"),
    ("profitAtTarget", "={priceForTarget}-{totalCost}-({priceForTarget}*{feeRate}+{feeFixed})"),
    ("price99", "=IF({price}<=0,0,CEILING({price}+0.01,1)-0.01)"),
]


def build_quote(wb, S):
    ws = wb.create_sheet("Quote")
    calc = wb.create_sheet("Calc")
    C.widths(ws, {"A": 46, "B": 16, "C": 16, "D": 10, "E": 3})
    C.title(ws, "Quote - price one print",
            "Yellow cells are inputs. Costs, price, fees and profit update instantly. Printer and fee settings are on the Settings tab.")
    Q = {}
    r = 4
    for label, key, default, fmt, help_ in QUOTE_INPUTS:
        if key is None:
            ws.cell(row=r, column=1, value=label).font = C.H2_FONT
            r += 1
            continue
        ws.cell(row=r, column=1, value=label)
        C.input_cell(ws, f"B{r}", default, fmt)
        ws.cell(row=r, column=3, value=help_).font = C.MUTED
        Q[key] = f"Quote!$B${r}"
        r += 1
    C.list_validation(ws, "=" + S["MatNames"], [Q["Mat"].split("!")[1].replace("$", "")])
    C.list_validation(ws, "=" + S["ChanNames"], [Q["Chan"].split("!")[1].replace("$", "")])
    C.list_validation(ws, ["Yes", "No"], [Q["Ads"].split("!")[1].replace("$", "")])

    # hidden Calc sheet: one named row per engine quantity
    refs = dict(S)
    refs.update(Q)
    refs["AdsPct"] = S["Ads"]
    calc["A1"] = "Engine - do not edit. Mirrors src/core/cost.ts calculatePrintCost; Quote displays these cells."
    calc["A1"].font = C.MUTED
    calc.column_dimensions["A"].width = 20
    calc.column_dimensions["B"].width = 16
    K = {}
    for i, (name, _) in enumerate(CALC_ROWS, start=2):
        K[name] = f"Calc!$B${i}"
    refs.update(K)
    for i, (name, formula) in enumerate(CALC_ROWS, start=2):
        calc.cell(row=i, column=1, value=name)
        calc.cell(row=i, column=2, value=formula.format(**refs))
    calc.sheet_state = "hidden"
    C.protect(calc)

    qty = Q["Qty"]
    # --- cost breakdown
    ws.cell(row=r, column=1, value="COST PER UNIT").font = C.H2_FONT
    r += 1
    C.header(ws, r, ["Item", "Per unit", f"Order (x qty)", "Share"])
    r += 1
    breakdown = [
        ("Material", K["materialCost"]),
        ("Energy", K["energyCost"]),
        ("Machine wear", K["wearCost"]),
        ("Failure buffer", K["failureBuffer"]),
        ("Labour", K["labourCost"]),
        ("Post-processing and hardware", Q["Post"]),
        ("Shipping and packaging", Q["Ship"]),
    ]
    bd_first = r
    for label, ref in breakdown:
        ws.cell(row=r, column=1, value=label)
        C.calc_cell(ws, f"B{r}", f"={ref}", C.MONEY)
        C.calc_cell(ws, f"C{r}", f"={ref}*{qty}", C.MONEY)
        C.calc_cell(ws, f"D{r}", f"=IF({K['totalCost']}>0,{ref}/{K['totalCost']},0)", "0%")
        r += 1
    bd_last = r - 1
    ws.cell(row=r, column=1, value="Total cost").font = C.BOLD
    C.calc_cell(ws, f"B{r}", f"={K['totalCost']}", C.MONEY, bold=True)
    C.calc_cell(ws, f"C{r}", f"={K['totalCost']}*{qty}", C.MONEY, bold=True)
    C.calc_cell(ws, f"D{r}", f"=SUM(D{bd_first}:D{bd_last})", "0%")
    Q["TotalCostCell"] = f"B{r}"
    r += 2

    # --- price and profit
    ws.cell(row=r, column=1, value="PRICE AND PROFIT").font = C.H2_FONT
    r += 1
    C.header(ws, r, ["Item", "Per unit", "Order (x qty)"])
    r += 1
    ws.cell(row=r, column=1, value="Pricing mode in use")
    C.calc_cell(ws, f"B{r}", f"=IF({K['isTargetMode']}=1,\"Target margin \"&TEXT({K['targetMargin']},\"0%\"),\"Markup \"&TEXT({K['markup']},\"0.0#\")&\"x\")")
    ws.merge_cells(f"B{r}:C{r}")
    r += 1
    money_rows = [
        ("Price per unit (what to charge)", K["price"], True, "PriceCell"),
        ("Marketplace fees", K["fees"], False, "FeesCell"),
        ("Net after fees", f"({K['price']}-{K['fees']})", False, "NetCell"),
        ("Profit", K["profit"], True, "ProfitCell"),
    ]
    for label, ref, bold, key in money_rows:
        ws.cell(row=r, column=1, value=label).font = C.BOLD if bold else Font()
        c = C.calc_cell(ws, f"B{r}", f"={ref}", C.MONEY, bold=bold)
        if key == "PriceCell":
            c.font = C.BIG_RESULT
        C.calc_cell(ws, f"C{r}", f"={ref}*{qty}", C.MONEY, bold=bold)
        Q[key] = f"B{r}"
        r += 1
    ws.cell(row=r, column=1, value="Margin (profit / price, after fees)")
    C.calc_cell(ws, f"B{r}", f"={K['margin']}", C.PCT)
    Q["MarginCell"] = f"B{r}"
    r += 1
    ws.cell(row=r, column=1, value="Check")
    C.calc_cell(ws, f"B{r}", f"=IF({K['invalid']}=1,\"Fee % + target margin must be below 100%\",IF({K['belowCost']}=1,\"WARNING: selling below cost\",\"OK\"))")
    ws.merge_cells(f"B{r}:C{r}")
    ws[f"B{r}"].font = Font(bold=True, color=C.ACCENT)
    Q["CheckCell"] = f"B{r}"
    r += 1
    ws.cell(row=r, column=1, value="Rounded .99 price (optional)")
    C.calc_cell(ws, f"B{r}", f"={K['price99']}", C.MONEY)
    r += 2

    # --- marketplace fee detail
    ws.cell(row=r, column=1, value="MARKETPLACE FEES").font = C.H2_FONT
    r += 1
    detail = [
        ("Fee rate applied (incl. offsite ads if Yes)", K["feeRate"], C.PCT),
        ("Fixed fees per sale (payment + listing)", K["feeFixed"], C.MONEY),
        ("Price needed for the target margin AFTER fees", K["priceForTarget"], C.MONEY),
        ("Profit per unit at that price", K["profitAtTarget"], C.MONEY),
    ]
    for label, ref, fmt in detail:
        ws.cell(row=r, column=1, value=label)
        C.calc_cell(ws, f"B{r}", f"={ref}", fmt)
        if "target margin" in label:
            Q["PriceForTargetCell"] = f"B{r}"
            ws[f"B{r}"].font = C.BOLD
        r += 1
    ws.cell(row=r, column=1, value=f"Target margin used: the Quote override if set, otherwise the Settings default. Fees and margin are both taken out of the selling price.").font = C.MUTED
    r += 1

    # --- chart
    chart = BarChart()
    chart.type = "bar"
    chart.style = 10
    chart.title = "Cost per unit breakdown"
    chart.y_axis.title = "$"
    chart.legend = None
    chart.height, chart.width = 7.5, 14
    data = Reference(ws, min_col=2, min_row=bd_first, max_row=bd_last)
    cats = Reference(ws, min_col=1, min_row=bd_first, max_row=bd_last)
    chart.add_data(data, titles_from_data=False)
    chart.set_categories(cats)
    chart.series[0].graphicalProperties.solidFill = C.ACCENT
    ws.add_chart(chart, "F4")
    ws.freeze_panes = "A4"
    C.protect(ws)
    return Q, K


# ---------------------------------------------------------------------------
# Batch
# ---------------------------------------------------------------------------
BATCH_COLS = [
    ("#", 5), ("Job / item", 22), ("Material", 10), ("Grams", 9), ("Hours", 9), ("Labour min", 9),
    ("Post-proc $ / unit", 10), ("Shipping $ / unit", 10), ("Qty", 6), ("Channel", 10), ("Offsite ads?", 9),
    ("Markup x (blank = default)", 11), ("Target margin (blank = default)", 11),
    # calculated
    ("$ / kg", 9), ("Material $", 10), ("Energy $", 10), ("Wear $", 10), ("Failure buffer $", 10), ("Labour $", 10),
    ("Unit cost", 11), ("Fee %", 8), ("Fee fixed $", 9), ("Price / unit", 11), ("Fees / unit", 10), ("Profit / unit", 11),
    ("Margin", 8), ("Order revenue", 12), ("Order profit", 12), ("Check", 12),
]
SAMPLE_BATCH = [
    ("Phone stand", "PLA", 48.5, 3.7, 10, 0, 0, 1, "Etsy", "No"),
    ("Dice tower", "PETG", 185, 11.2, 20, 1.5, 0, 2, "Etsy", "Yes"),
    ("Cable clips (set of 10)", "PLA", 32, 2.1, 5, 0, 0.8, 5, "Direct", "No"),
]


def build_batch(wb, S):
    ws = wb.create_sheet("Batch")
    C.title(ws, "Batch - price up to 30 jobs at once",
            "Type one job per row in the yellow columns. Qty blank = 1. Markup / target margin blank = Settings default. Pricing mode comes from Settings.")
    HR = 4
    C.header(ws, HR, [h for h, _ in BATCH_COLS], height=44)
    for i, (_, w) in enumerate(BATCH_COLS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    first = HR + 1
    last = first + BATCH_ROWS - 1
    mode_tm = f"IF({S['Mode']}=\"Target margin\",1,0)"
    for i in range(BATCH_ROWS):
        r = first + i
        ws.cell(row=r, column=1, value=i + 1)
        for col, fmt in ((2, None), (3, None), (4, "0.0"), (5, "0.00"), (6, "0"), (7, C.MONEY), (8, C.MONEY), (9, "0"), (10, None), (11, None), (12, "0.00"), (13, C.PCT)):
            C.input_cell(ws, ws.cell(row=r, column=col), fmt=fmt)
        if i < len(SAMPLE_BATCH):
            for col, v in enumerate(SAMPLE_BATCH[i], start=2):
                ws.cell(row=r, column=col, value=v)
        active = f'AND(D{r}="",E{r}="")'
        g = f'=IF(N{r}="","",'
        qty = f"IF(I{r}=\"\",1,I{r})"
        mk = f"IF(L{r}<>\"\",L{r},{S['Markup']})"
        tm = f"IF(M{r}<>\"\",M{r},{S['Target']})"
        f = {
            "N": f'=IF({active},"",IFERROR(VLOOKUP(C{r},{S["MatTable"]},2,FALSE),0))',
            "O": f"{g}D{r}/1000*N{r})",
            "P": f"{g}{S['Watts']}/1000*E{r}*(1+{S['TimeCorr']})*{S['Rate']})",
            "Q": f"{g}E{r}*(1+{S['TimeCorr']})*{S['Wear']})",
            "R": f"{g}(O{r}+P{r}+Q{r})*{S['Fail']})",
            "S": f"{g}F{r}/60*{S['Labour']})",
            "T": f"{g}O{r}+P{r}+Q{r}+R{r}+S{r}+G{r}+H{r})",
            "U": f"{g}IFERROR(VLOOKUP(J{r},{S['ChanTable']},6,FALSE),0)+IF(AND(J{r}=\"Etsy\",K{r}=\"Yes\"),{S['Ads']},0))",
            "V": f"{g}IFERROR(VLOOKUP(J{r},{S['ChanTable']},7,FALSE),0))",
            "W": f"{g}IF({mode_tm}=1,IF(1-U{r}-{tm}<=0,0,(T{r}+V{r})/(1-U{r}-{tm})),IF(1-U{r}<=0,0,(T{r}*{mk}+V{r})/(1-U{r}))))",
            "X": f"{g}W{r}*U{r}+V{r})",
            "Y": f"{g}W{r}-T{r}-X{r})",
            "Z": f"{g}IF(W{r}>0,Y{r}/W{r},\"\"))",
            "AA": f"{g}W{r}*{qty})",
            "AB": f"{g}Y{r}*{qty})",
            "AC": f"{g}IF(W{r}<T{r},\"BELOW COST\",\"OK\"))",
        }
        fmts = {"N": C.MONEY, "O": C.MONEY, "P": C.MONEY, "Q": C.MONEY, "R": C.MONEY, "S": C.MONEY, "T": C.MONEY,
                "U": C.PCT, "V": C.MONEY, "W": C.MONEY, "X": C.MONEY, "Y": C.MONEY, "Z": C.PCT, "AA": C.MONEY, "AB": C.MONEY, "AC": None}
        for col, formula in f.items():
            C.calc_cell(ws, f"{col}{r}", formula, fmts[col], bold=col in ("T", "W", "Y"))
    tr = last + 1
    ws.cell(row=tr, column=2, value="Totals").font = C.BOLD
    for col in ("D", "E", "I", "AA", "AB"):
        fmt = C.MONEY if col in ("AA", "AB") else "#,##0.0"
        C.calc_cell(ws, f"{col}{tr}", f"=SUM({col}{first}:{col}{last})", fmt, bold=True)
    ws.cell(row=tr, column=20, value="Jobs priced:").font = C.BOLD
    C.calc_cell(ws, f"U{tr}", f'=COUNT(T{first}:T{last})', "0", bold=True)
    ws.cell(row=tr, column=22, value="Avg margin:").font = C.BOLD
    C.calc_cell(ws, f"W{tr}", f'=IF(AA{tr}>0,AB{tr}/AA{tr},0)', C.PCT, bold=True)
    C.list_validation(ws, "=" + S["MatNames"], [f"C{first}:C{last}"])
    C.list_validation(ws, "=" + S["ChanNames"], [f"J{first}:J{last}"])
    C.list_validation(ws, ["Yes", "No"], [f"K{first}:K{last}"])
    ws.freeze_panes = f"C{first}"
    C.protect(ws)
    return {"first": first, "last": last, "totals": tr}


# ---------------------------------------------------------------------------
# Limitations, Start Here
# ---------------------------------------------------------------------------
LIMITATIONS = [
    ("Single printer profile", "Watts, wear and failure rate are shop-wide. A resin printer and an FDM farm have different numbers.", "Save one copy of the file per printer type, or change Settings before each quote."),
    ("Fees are a snapshot", "Marketplace fees, VAT on fees and regional payment rates change. Etsy numbers are the US defaults as of November 2026.", "Edit the fee table on Settings; the blank row is for any other channel."),
    ("Labour is marked up with everything else", "In Markup mode your time is multiplied too; in Target margin mode it is part of cost. Some sellers prefer to add labour after markup.", "Set labour minutes to 0 and add your time to the Post-processing cost instead."),
    ("No slicer file import", "Grams and hours are typed by hand.", "The free calculator at meshkit.pro reads G-code and 3MF files and fills these numbers for you."),
    ("No multi-material split", "One material per quote or batch row.", "Add a second batch row for the second material and combine the costs."),
    ("No tax, VAT or sales tax", "Prices here are before any tax you collect or remit.", "Add your tax rule on top of the price shown."),
    ("Margin is after fees only", "Rent, software, insurance and your own salary are not in the unit cost.", "Raise the wear rate or add a fixed amount in Post-processing to spread overhead."),
]
STEPS = [
    "Open Settings and type your printer power, electricity rate, wear rate, failure buffer, labour rate, material prices and the pricing mode you want (markup multiplier or target margin).",
    "On Quote, pick the material, enter grams and hours from your slicer, labour minutes, any hardware or shipping cost, the quantity and the sales channel.",
    "Read the cost breakdown, the price to charge, marketplace fees, net after fees, profit and margin. The Check cell warns if you would sell below cost.",
    "The Marketplace fees block shows the price you need for your target margin after fees, whichever mode you are in. Toggle offsite ads for Etsy orders that came through ads.",
    "Use Batch to price up to 30 jobs at once with the same settings; totals are at the bottom. Read Limitations for what the sheet does not do.",
]
NOTES = [
    "The maths matches the free MeshKit 3D print cost calculator exactly: material + energy + wear, times a failure buffer, then labour and extras, then the markup or margin, then channel fees.",
    "Percent cells: type 7 for 7% (or 0.07). Prices are per unit unless the column says Order.",
]


def build():
    wb = Workbook()
    wb.remove(wb.active)
    S = build_settings(wb)
    Q, K = build_quote(wb, S)
    B = build_batch(wb, S)
    C.build_limitations(
        wb, rows=LIMITATIONS, campaign=CAMPAIGN,
        intro="A spreadsheet is the right tool for a price list you own and can audit. These are the edges; the third column says what to do about each.")
    C.build_start(wb, product="3D Print Pricing Calculator", version=VERSION, steps=STEPS, campaign=CAMPAIGN, notes=NOTES)
    # order: Start Here, Settings, Quote, Batch, Limitations, (Calc hidden)
    order = ["Start Here", "Settings", "Quote", "Batch", "Limitations", "Calc"]
    wb._sheets = [wb[n] for n in order]
    wb.active = 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    return OUT, S, Q, B


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
def _cell(ref):
    """'Settings!$B$5' -> ('Settings', 'B5')"""
    sheet, cell = ref.split("!")
    return sheet, cell.replace("$", "")


def verify(path: Path, S, Q, B):
    ok = True
    visible = ["Start Here", "Settings", "Quote", "Batch", "Limitations"]
    vals = C.recalc(path)
    errs = C.scan_errors(vals, visible + ["Calc"])
    if errs:
        ok = False
        print("errors in default workbook:", *errs[:20], sep="\n  ")
    # hand-computed defaults: PLA $20/kg, 48.5 g, 3.7 h, 150 W, $0.16/kWh, $0.15/h wear, 7% buffer,
    # + 10 min labour at $20/h, 3.5x markup, Etsy 9.5% + $0.45
    unit = (48.5 / 1000 * 20 + 150 / 1000 * 3.7 * 0.16 + 3.7 * 0.15) * 1.07
    labour = 10 / 60 * 20
    total = unit + labour
    price = (total * 3.5 + 0.45) / (1 - 0.095)
    fees = price * 0.095 + 0.45
    got_total = C.num(vals[("QUOTE", Q["TotalCostCell"])])
    got_price = C.num(vals[("QUOTE", Q["PriceCell"])])
    got_fees = C.num(vals[("QUOTE", Q["FeesCell"])])
    got_profit = C.num(vals[("QUOTE", Q["ProfitCell"])])
    got_target = C.num(vals[("QUOTE", Q["PriceForTargetCell"])])
    exp_target = (total + 0.45) / (1 - 0.095 - 0.5)
    print(f"defaults: total cost {got_total:.4f} (exp {total:.4f}), price {got_price:.4f} (exp {price:.4f}), "
          f"fees {got_fees:.4f} (exp {fees:.4f}), profit {got_profit:.4f}, price for 50% target {got_target:.4f} (exp {exp_target:.4f})")
    for name, g, e in (("total", got_total, total), ("price", got_price, price), ("fees", got_fees, fees),
                       ("profit", got_profit, price - total - fees), ("target", got_target, exp_target)):
        if not C.close(g, e):
            ok = False
            print(f"  !! default {name} mismatch: sheet {g} vs expected {e}")
    assert vals[("QUOTE", Q["CheckCell"])] == "OK", vals[("QUOTE", Q["CheckCell"])]
    # batch row 1 mirrors the quote defaults
    b1 = C.num(vals[("BATCH", f"W{B['first']}")])
    if not C.close(b1, got_price):
        ok = False
        print(f"  !! batch row 1 price {b1} != quote price {got_price}")
    b_rev = C.num(vals[("BATCH", f"AA{B['totals']}")])
    print(f"defaults: batch row 1 price {b1:.4f} matches quote; batch total revenue {b_rev:.2f}; "
          f"check cells: {[vals[('BATCH', f'AC{B['first'] + i}')] for i in range(3)]}")
    # every batch row beyond the samples must be blank, not an error
    assert vals[("BATCH", f"W{B['last']}")] == "", vals[("BATCH", f"W{B['last']}")]

    # --- engine fixtures ----------------------------------------------------
    fixtures = sorted((ROOT / "fixtures").glob("*.json"))
    if not fixtures:
        print("!! no fixtures found; run: npx vite-node tools/etsy/export-fixtures.ts")
        ok = False
    for fx in fixtures:
        data = json.loads(fx.read_text())
        inp, res = data["input"], data["result"]
        wb = load_workbook(path)
        st, qt = wb["Settings"], wb["Quote"]

        def put(ref, v):
            sheet, cell = _cell(ref)
            (st if sheet == "Settings" else qt)[cell] = v

        put(S["Watts"], inp["watts"])
        put(S["Rate"], inp["electricityRatePerKwh"])
        put(S["Wear"], inp["wearRatePerHour"])
        put(S["Fail"], inp["failurePct"] / 100)
        put(S["TimeCorr"], inp.get("timeCorrectionPct", 0) / 100)
        put(S["Mode"], "Target margin" if inp.get("pricingMode") == "target_margin" else "Markup multiplier")
        put(S["Markup"], inp.get("markupMultiplier", 3.5))
        put(S["Target"], inp.get("targetMarginPct", 50) / 100)
        er = S["EtsyRow"]
        st[f"B{er}"] = inp["channelFeePct"] / 100
        st[f"C{er}"] = 0
        st[f"D{er}"] = inp["channelFixedFee"]
        st[f"E{er}"] = 0
        put(Q["PpkOverride"], inp["pricePerKg"])
        put(Q["Grams"], inp["grams"])
        put(Q["Hours"], inp["hours"])
        put(Q["LabourMin"], 0)
        put(Q["Post"], 0)
        put(Q["Ship"], 0)
        put(Q["Qty"], 1)
        put(Q["Chan"], "Etsy")
        put(Q["Ads"], "No")
        put(Q["MarkupOv"], None)
        put(Q["TargetOv"], None)
        tmp = C.temp_copy(path)
        wb.save(tmp)
        v = C.recalc(tmp)
        C.cleanup(tmp)
        got = {
            "unitCost": C.num(v[("QUOTE", Q["TotalCostCell"])]),
            "sellingPrice": C.num(v[("QUOTE", Q["PriceCell"])]),
            "channelFees": C.num(v[("QUOTE", Q["FeesCell"])]),
            "profit": C.num(v[("QUOTE", Q["ProfitCell"])]),
        }
        line = []
        for k, g in got.items():
            e = res[k]
            rel = abs(g - e) / max(1e-9, abs(e)) if e else abs(g - e)
            line.append(f"{k} {g:.4f} vs {e:.4f} ({rel * 100:.3f}%)")
            if not C.close(g, e):
                ok = False
                print(f"  !! {data['case']}: {k} sheet {g} vs engine {e}")
        margin = v[("QUOTE", Q["MarginCell"])]
        margin_ok = res["marginPct"] is None or abs(round(C.num(margin) * 100) - res["marginPct"]) <= 1
        if not margin_ok:
            ok = False
            print(f"  !! {data['case']}: margin {margin} vs engine {res['marginPct']}")
        print(f"{data['case']}: " + " | ".join(line) + f" | margin {C.num(margin) * 100:.1f}% vs {res['marginPct']}%")
    print("VERIFY:", "PASS" if ok else "FAIL")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    p, S, Q, B = build()
    print(f"wrote {p} ({p.stat().st_size // 1024} KB)")
    if "--verify" in sys.argv:
        verify(p, S, Q, B)
