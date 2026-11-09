#!/usr/bin/env python3
"""Builds the MeshKit Print Job Log workbook (Etsy product).

Jobs: up to 200 print jobs with per-job filament, energy, wear, labour and
channel-fee costs (same cost model as src/core/cost.ts, without the failure
buffer because these are actual jobs), profit and margin.
Monthly P&L: SUMIFS by month over the Jobs table.

    python tools/etsy/build_job_log.py            # -> tools/etsy/dist/MeshKit-Print-Job-Log-v1.0.xlsx
    python tools/etsy/build_job_log.py --verify   # recalculates with `formulas` and checks the sample rows
"""
from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.utils import get_column_letter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402

VERSION = "1.0"
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dist" / f"MeshKit-Print-Job-Log-v{VERSION}.xlsx"
CAMPAIGN = "joblog"
JOB_ROWS = 200
MONTHS = 24

MATERIALS = [("PLA", 20), ("PETG", 25), ("ABS", 22), ("ASA", 28), ("TPU", 35), ("Nylon", 45), ("Resin", 35)]
CUSTOM_MATERIALS = 3
CHANNELS = [
    ("Etsy", 0.065, 0.03, 0.25, 0.20),
    ("Shopify", 0.0, 0.029, 0.30, 0.0),
    ("eBay", 0.1325, 0.0, 0.30, 0.0),
    ("Direct", 0.0, 0.0, 0.0, 0.0),
]
CUSTOM_CHANNELS = 2
STATUSES = ["Queued", "Printing", "Done", "Failed"]
FIRST_MONTH = dt.date(2026, 10, 1)

SAMPLE_JOBS = [
    # date, order ref, customer, channel, ads, item, qty, material, grams, hours, labour min, other $, price $, status, reason
    (dt.date(2026, 10, 6), "ETSY-3181", "J. Alvarez", "Etsy", "No", "Phone stand", 1, "PLA", 48.5, 3.7, 10, 0, 19.99, "Done", None),
    (dt.date(2026, 10, 14), "ETSY-3190", "M. Chen", "Etsy", "Yes", "Dice tower", 1, "PETG", 185, 11.2, 20, 1.5, 44.00, "Done", None),
    (dt.date(2026, 10, 21), "ETSY-3190b", "M. Chen", "Etsy", "No", "Dice tower (reprint)", 1, "PETG", 90, 5.0, 5, 0, 0, "Failed", "Layer shift at 45%"),
    (dt.date(2026, 11, 3), "INV-022", "Local school", "Direct", "No", "Cable clips (set of 10)", 5, "PLA", 160, 10.5, 25, 4.0, 60.00, "Done", None),
    (dt.date(2026, 11, 8), "ETSY-3204", "S. Patel", "Etsy", "No", "Planter", 2, "ASA", 420, 19.0, 30, 0, 58.00, "Printing", None),
]


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
def build_settings(wb):
    ws = wb.create_sheet("Settings")
    C.widths(ws, {"A": 42, "B": 18, "C": 18, "D": 18, "E": 16, "F": 16, "G": 16})
    C.title(ws, "Settings - printer costs, material prices, marketplace fees",
            "Type in the yellow cells once. Jobs reads everything from here.")
    S = {}
    rows = [
        ("Printer power draw (W)", "Watts", 150, "0", "Average draw while printing. Typical desktop FDM: 100-200 W."),
        ("Electricity rate ($ per kWh)", "Rate", 0.16, C.MONEY, "From your utility bill."),
        ("Machine wear and maintenance ($ per hour)", "Wear", 0.15, C.MONEY, "Printer price / expected lifetime hours, plus consumables."),
        ("Labour rate ($ per hour)", "Labour", 20, C.MONEY, "Your time for setup, removal, finishing and packing."),
        ("Etsy offsite ads fee (%)", "Ads", 0.15, C.PCT, "Added to the fee rate on jobs marked Offsite ad = Yes (Etsy only)."),
    ]
    r = 4
    for label, key, default, fmt, help_ in rows:
        ws.cell(row=r, column=1, value=label)
        C.input_cell(ws, f"B{r}", default, fmt)
        ws.cell(row=r, column=3, value=help_).font = C.MUTED
        S[key] = f"Settings!$B${r}"
        r += 1
    r += 1
    ws.cell(row=r, column=1, value="MATERIAL PRICES").font = C.H2_FONT
    ws.cell(row=r, column=3, value="Filament cost per job = grams x price per kg / 1000. Add your own in the blank rows.").font = C.MUTED
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
    r = last + 2
    ws.cell(row=r, column=1, value="STATUS VALUES").font = C.H2_FONT
    ws.cell(row=r, column=3, value="Fixed: Queued, Printing, Done, Failed. Monthly P&L counts Failed rows for the failure rate.").font = C.MUTED
    ws.freeze_panes = "A4"
    C.protect(ws)
    return S


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
JOB_COLS = [
    ("Date", 11), ("Order ref", 12), ("Customer", 16), ("Channel", 10), ("Offsite ad?", 9), ("Item", 24), ("Qty", 6),
    ("Material", 10), ("Grams (total)", 9), ("Hours (total)", 9), ("Labour min", 9), ("Other cost $", 10), ("Price charged $", 11),
    ("Status", 10), ("Failure reason", 24),
    # calculated
    ("$ / kg", 9), ("Filament $", 10), ("Energy $", 9), ("Wear $", 9), ("Labour $", 9), ("Channel fees $", 10),
    ("Total cost $", 11), ("Profit $", 11), ("Margin", 8), ("Month", 10), ("Failed", 7),
]


def build_jobs(wb, S):
    ws = wb.create_sheet("Jobs")
    C.title(ws, "Jobs - one row per print job",
            "Yellow = type, grey = calculated. Grams and hours are totals for the row (all pieces). Price charged is what the customer paid for the row, before fees. Five sample rows are included: overwrite or clear them.")
    HR = 4
    C.header(ws, HR, [h for h, _ in JOB_COLS], height=40)
    for i, (_, w) in enumerate(JOB_COLS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    first = HR + 1
    last = first + JOB_ROWS - 1
    for i in range(JOB_ROWS):
        r = first + i
        for col, fmt in ((1, C.DATE), (2, None), (3, None), (4, None), (5, None), (6, None), (7, "0"), (8, None), (9, "0.0"), (10, "0.00"), (11, "0"), (12, C.MONEY), (13, C.MONEY), (14, None), (15, None)):
            C.input_cell(ws, ws.cell(row=r, column=col), fmt=fmt)
        if i < len(SAMPLE_JOBS):
            for col, v in enumerate(SAMPLE_JOBS[i], start=1):
                ws.cell(row=r, column=col, value=v)
        active = f'OR(A{r}<>"",F{r}<>"",I{r}<>"")'
        g = f'=IF(P{r}="","",'
        f = {
            "P": f'=IF({active},IFERROR(VLOOKUP(H{r},{S["MatTable"]},2,FALSE),0),"")',
            "Q": f"{g}I{r}/1000*P{r})",
            "R": f"{g}{S['Watts']}/1000*J{r}*{S['Rate']})",
            "S": f"{g}J{r}*{S['Wear']})",
            "T": f"{g}K{r}/60*{S['Labour']})",
            "U": f"{g}IF(N(M{r})<=0,0,M{r}*(IFERROR(VLOOKUP(D{r},{S['ChanTable']},6,FALSE),0)+IF(AND(D{r}=\"Etsy\",E{r}=\"Yes\"),{S['Ads']},0))+IFERROR(VLOOKUP(D{r},{S['ChanTable']},7,FALSE),0)))",
            "V": f"{g}Q{r}+R{r}+S{r}+T{r}+N(L{r}))",
            "W": f"{g}N(M{r})-V{r}-U{r})",
            "X": f"{g}IF(N(M{r})>0,W{r}/M{r},\"\"))",
            "Y": f'=IF(A{r}="","",DATE(YEAR(A{r}),MONTH(A{r}),1))',
            "Z": f'{g}IF(N{r}="Failed",1,0))',
        }
        fmts = {"P": C.MONEY, "Q": C.MONEY, "R": C.MONEY, "S": C.MONEY, "T": C.MONEY, "U": C.MONEY, "V": C.MONEY,
                "W": C.MONEY, "X": C.PCT, "Y": "mmm yyyy", "Z": "0"}
        for col, formula in f.items():
            C.calc_cell(ws, f"{col}{r}", formula, fmts[col], bold=col in ("V", "W"))
    tr = last + 1
    ws.cell(row=tr, column=6, value="Totals").font = C.BOLD
    for col, fmt in (("G", "0"), ("I", "#,##0"), ("J", "#,##0.0"), ("M", C.MONEY), ("Q", C.MONEY), ("R", C.MONEY), ("S", C.MONEY), ("T", C.MONEY), ("U", C.MONEY), ("V", C.MONEY), ("W", C.MONEY), ("Z", "0")):
        C.calc_cell(ws, f"{col}{tr}", f"=SUM({col}{first}:{col}{last})", fmt, bold=True)
    C.calc_cell(ws, f"X{tr}", f"=IF(M{tr}>0,W{tr}/M{tr},0)", C.PCT, bold=True)
    C.list_validation(ws, "=" + S["ChanNames"], [f"D{first}:D{last}"])
    C.list_validation(ws, ["Yes", "No"], [f"E{first}:E{last}"])
    C.list_validation(ws, "=" + S["MatNames"], [f"H{first}:H{last}"])
    C.list_validation(ws, STATUSES, [f"N{first}:N{last}"])
    ws.freeze_panes = f"C{first}"
    ws.auto_filter.ref = f"A{HR}:Z{last}"
    C.protect(ws)
    return {"first": first, "last": last, "totals": tr}


# ---------------------------------------------------------------------------
# Monthly P&L
# ---------------------------------------------------------------------------
PL_COLS = [
    ("Month", 11), ("Jobs", 7), ("Done", 7), ("Failed", 7), ("Failure rate", 9), ("Hours printed", 9), ("Grams used", 9),
    ("Revenue", 11), ("Filament", 10), ("Energy", 9), ("Wear", 9), ("Labour", 10), ("Other", 9), ("Channel fees", 10),
    ("Total cost", 11), ("Profit", 11), ("Margin", 8),
]


def build_pl(wb, S, J):
    ws = wb.create_sheet("Monthly P&L")
    C.title(ws, "Monthly P&L", f"Revenue, costs, fees and profit by month from the Jobs tab. Change the first month below; {MONTHS} months follow.")
    ws["A4"] = "First month"
    C.input_cell(ws, "B4", FIRST_MONTH, "mmm yyyy")
    ws["C4"] = "Type any date in the month, e.g. 2027-01-01."
    ws["C4"].font = C.MUTED
    HR = 6
    C.header(ws, HR, [h for h, _ in PL_COLS], height=30)
    for i, (_, w) in enumerate(PL_COLS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    jb = lambda col: f"Jobs!${col}${J['first']}:${col}${J['last']}"  # noqa: E731
    first = HR + 1
    last = first + MONTHS - 1
    for i in range(MONTHS):
        r = first + i
        m = f"$A{r}"
        f = {
            "A": f"=DATE(YEAR($B$4),MONTH($B$4)+{i},1)",
            "B": f"=COUNTIFS({jb('Y')},{m})",
            "C": f'=COUNTIFS({jb("Y")},{m},{jb("N")},"Done")',
            "D": f'=COUNTIFS({jb("Y")},{m},{jb("N")},"Failed")',
            "E": f'=IF(B{r}>0,D{r}/B{r},"")',
            "F": f"=SUMIFS({jb('J')},{jb('Y')},{m})",
            "G": f"=SUMIFS({jb('I')},{jb('Y')},{m})",
            "H": f"=SUMIFS({jb('M')},{jb('Y')},{m})",
            "I": f"=SUMIFS({jb('Q')},{jb('Y')},{m})",
            "J": f"=SUMIFS({jb('R')},{jb('Y')},{m})",
            "K": f"=SUMIFS({jb('S')},{jb('Y')},{m})",
            "L": f"=SUMIFS({jb('T')},{jb('Y')},{m})",
            "M": f"=SUMIFS({jb('L')},{jb('Y')},{m})",
            "N": f"=SUMIFS({jb('U')},{jb('Y')},{m})",
            "O": f"=SUMIFS({jb('V')},{jb('Y')},{m})",
            "P": f"=SUMIFS({jb('W')},{jb('Y')},{m})",
            "Q": f'=IF(H{r}>0,P{r}/H{r},"")',
        }
        fmts = {"A": "mmm yyyy", "B": "0", "C": "0", "D": "0", "E": C.PCT, "F": "#,##0.0", "G": "#,##0",
                "H": C.MONEY, "I": C.MONEY, "J": C.MONEY, "K": C.MONEY, "L": C.MONEY, "M": C.MONEY, "N": C.MONEY,
                "O": C.MONEY, "P": C.MONEY, "Q": C.PCT}
        for col, formula in f.items():
            C.calc_cell(ws, f"{col}{r}", formula, fmts[col], bold=col in ("A", "H", "P"))
    tr = last + 1
    ws.cell(row=tr, column=1, value="Total").font = C.BOLD
    for col in "BCDFGHIJKLMNOP":
        fmt = {"B": "0", "C": "0", "D": "0", "F": "#,##0.0", "G": "#,##0"}.get(col, C.MONEY)
        C.calc_cell(ws, f"{col}{tr}", f"=SUM({col}{first}:{col}{last})", fmt, bold=True)
    C.calc_cell(ws, f"E{tr}", f'=IF(B{tr}>0,D{tr}/B{tr},"")', C.PCT, bold=True)
    C.calc_cell(ws, f"Q{tr}", f'=IF(H{tr}>0,P{tr}/H{tr},"")', C.PCT, bold=True)
    ws.cell(row=tr + 1, column=1, value="Jobs dated outside these months are in the Jobs totals row but not here.").font = C.MUTED

    chart = BarChart()
    chart.type = "col"
    chart.style = 10
    chart.title = "Revenue and profit by month"
    chart.y_axis.title = "$"
    chart.height, chart.width = 8, 22
    chart.add_data(Reference(ws, min_col=8, min_row=HR, max_row=last), titles_from_data=True)
    chart.add_data(Reference(ws, min_col=16, min_row=HR, max_row=last), titles_from_data=True)
    chart.set_categories(Reference(ws, min_col=1, min_row=first, max_row=last))
    chart.series[0].graphicalProperties.solidFill = "1F2937"
    chart.series[1].graphicalProperties.solidFill = C.ACCENT
    ws.add_chart(chart, f"A{tr + 3}")
    ws.freeze_panes = f"B{first}"
    C.protect(ws)
    return {"first": first, "last": last, "totals": tr}


LIMITATIONS = [
    ("Costs are estimates from Settings", "Energy and wear use one printer profile; filament uses the Settings price per kg, not the spool you actually used.", "Put the real cost in Other cost and set grams to 0 for a one-off, or keep one copy per printer."),
    ("No failure buffer", "Unlike a quote, a log records what happened; failed prints cost real money and show as rows with zero revenue.", "Watch the failure rate on Monthly P&L; price future work with the MeshKit pricing calculator."),
    ("Fees are a snapshot", "Marketplace fees, VAT on fees and regional payment rates change. Etsy numbers are the US defaults as of November 2026.", "Edit the fee table on Settings."),
    ("One material per row", "Multi-material jobs are not split.", "Use two rows with the same order ref, or type the blended cost in Other cost."),
    ("24 months on the P&L", "Monthly P&L covers two years from the first month you choose.", "Change the first month, or copy the file per year."),
    ("No tax, refunds or shipping income", "Price charged should be the item price. Shipping you charge and refunds you give are not modelled.", "Add shipping income to Price charged and the postage you paid to Other cost if you want them in profit."),
]
STEPS = [
    "Open Settings and type your printer power, electricity rate, wear rate, labour rate and material prices. Check the marketplace fee table.",
    "On Jobs, add one row per print job: date, order reference, customer, channel, item, quantity, material, grams, hours, labour minutes, any other cost, and the price charged.",
    "Filament, energy, wear, labour and channel-fee costs are calculated, then total cost, profit and margin. Set the status as the job moves from Queued to Printing to Done (or Failed, with a reason).",
    "Monthly P&L sums revenue, each cost line, fees, profit, hours, grams, job count and failure rate by month. Change the first month in the yellow cell.",
    "Five sample rows are included: overwrite or clear them. Use the filter arrows on the Jobs header row to find a customer or a failed job.",
]
NOTES = [
    "Channel fees are charged only when Price charged is above zero. Etsy fees include the per-order listing fee; add offsite-ads orders with Offsite ad = Yes.",
]


def build():
    wb = Workbook()
    wb.remove(wb.active)
    S = build_settings(wb)
    J = build_jobs(wb, S)
    PL = build_pl(wb, S, J)
    C.build_limitations(wb, rows=LIMITATIONS, campaign=CAMPAIGN,
                        intro="A spreadsheet is a good job log: every number is visible and yours. These are its edges and what to do about each.")
    C.build_start(wb, product="Print Job Log", version=VERSION, steps=STEPS, campaign=CAMPAIGN, notes=NOTES)
    order = ["Start Here", "Jobs", "Monthly P&L", "Settings", "Limitations"]
    wb._sheets = [wb[n] for n in order]
    wb.active = 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    return OUT, S, J, PL


def verify(path, S, J, PL):
    ok = True
    sheets = ["Start Here", "Jobs", "Monthly P&L", "Settings", "Limitations"]
    vals = C.recalc(path)
    errs = C.scan_errors(vals, sheets)
    if errs:
        ok = False
        print("errors in default workbook:", *errs[:20], sep="\n  ")
    f = J["first"]
    # job 1: PLA 48.5 g @ $20 = 0.97; 3.7 h -> energy 0.0888, wear 0.555; 10 min -> 3.3333; Etsy on 19.99 -> 2.34905
    fees1 = 19.99 * 0.095 + 0.45
    cost1 = 0.97 + 0.0888 + 0.555 + 10 / 60 * 20
    # job 2: PETG 185 g @ 25 = 4.625; 11.2 h -> 0.2688 + 1.68; 20 min -> 6.6667; other 1.5; Etsy + 15% ads on 44
    fees2 = 44 * (0.095 + 0.15) + 0.45
    cost2 = 4.625 + 150 / 1000 * 11.2 * 0.16 + 11.2 * 0.15 + 20 / 60 * 20 + 1.5
    # job 3: failed, price 0 -> fees 0
    cost3 = 90 / 1000 * 25 + 150 / 1000 * 5 * 0.16 + 5 * 0.15 + 5 / 60 * 20
    # job 4: direct, no fees
    cost4 = 160 / 1000 * 20 + 150 / 1000 * 10.5 * 0.16 + 10.5 * 0.15 + 25 / 60 * 20 + 4
    checks = [
        (("JOBS", f"U{f}"), fees1), (("JOBS", f"V{f}"), cost1), (("JOBS", f"W{f}"), 19.99 - cost1 - fees1),
        (("JOBS", f"U{f + 1}"), fees2), (("JOBS", f"V{f + 1}"), cost2), (("JOBS", f"W{f + 1}"), 44 - cost2 - fees2),
        (("JOBS", f"U{f + 2}"), 0), (("JOBS", f"V{f + 2}"), cost3), (("JOBS", f"W{f + 2}"), -cost3), (("JOBS", f"Z{f + 2}"), 1),
        (("JOBS", f"U{f + 3}"), 0), (("JOBS", f"V{f + 3}"), cost4), (("JOBS", f"W{f + 3}"), 60 - cost4),
    ]
    for key, exp in checks:
        got = vals[key]
        if not C.close(got, exp):
            ok = False
            print(f"  !! {key} = {got}, expected {exp}")
    print(f"jobs: row1 fees {C.num(vals[('JOBS', f'U{f}')]):.4f} cost {C.num(vals[('JOBS', f'V{f}')]):.4f} profit {C.num(vals[('JOBS', f'W{f}')]):.4f}; "
          f"row2 (offsite ads) fees {C.num(vals[('JOBS', f'U{f + 1}')]):.4f}; row3 failed profit {C.num(vals[('JOBS', f'W{f + 2}')]):.4f}")
    assert vals[("JOBS", f"V{J['last']}")] == "", "blank rows must stay blank"
    assert vals[("JOBS", f"X{f + 2}")] == "", "margin blank when no revenue"
    # Monthly P&L: Oct 2026 = jobs 1-3, Nov 2026 = jobs 4-5
    p = PL["first"]
    oct_rev, nov_rev = 19.99 + 44 + 0, 60 + 58
    got = {k: C.num(vals[("MONTHLY P&L", k)]) for k in (f"B{p}", f"D{p}", f"E{p}", f"H{p}", f"P{p}", f"B{p + 1}", f"H{p + 1}", f"F{p}", f"B{p + 2}")}
    print(f"p&l: Oct jobs {got[f'B{p}']:.0f} failed {got[f'D{p}']:.0f} rate {got[f'E{p}'] * 100:.1f}% revenue {got[f'H{p}']:.2f} profit {got[f'P{p}']:.2f} hours {got[f'F{p}']:.1f}; "
          f"Nov jobs {got[f'B{p + 1}']:.0f} revenue {got[f'H{p + 1}']:.2f}; Dec jobs {got[f'B{p + 2}']:.0f}")
    exp = {f"B{p}": 3, f"D{p}": 1, f"E{p}": 1 / 3, f"H{p}": oct_rev, f"P{p}": (19.99 - cost1 - fees1) + (44 - cost2 - fees2) - cost3,
           f"B{p + 1}": 2, f"H{p + 1}": nov_rev, f"F{p}": 3.7 + 11.2 + 5.0, f"B{p + 2}": 0}
    for k, e in exp.items():
        if not C.close(got[k], e):
            ok = False
            print(f"  !! p&l {k}: {got[k]} vs {e}")
    tot_rev = C.num(vals[("MONTHLY P&L", f"H{PL['totals']}")])
    jobs_rev = C.num(vals[("JOBS", f"M{J['totals']}")])
    if not C.close(tot_rev, jobs_rev):
        ok = False
        print(f"  !! p&l total revenue {tot_rev} != jobs total {jobs_rev}")
    print(f"p&l total revenue {tot_rev:.2f} == jobs total {jobs_rev:.2f}")
    print("VERIFY:", "PASS" if ok else "FAIL")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    out = build()
    print(f"wrote {out[0]} ({out[0].stat().st_size // 1024} KB)")
    if "--verify" in sys.argv:
        verify(*out)
