"""Shared styling, boilerplate tabs and verification helpers for the MeshKit
Etsy spreadsheet builders (build_pricing.py, build_filament_tracker.py,
build_job_log.py).

Conventions (mirrors ledger-retirement-planner/tools/etsy-sheet/build.py):
  * yellow, unlocked cells are the only place a buyer types;
  * every other cell is a formula or a label, and every sheet is protected
    without a password so formulas are not broken by accident;
  * formulas are plain Excel 2016 / Google Sheets: no LET, LAMBDA, XLOOKUP,
    dynamic arrays or macros.
"""
from __future__ import annotations

import datetime as _dt
import shutil
import tempfile
from pathlib import Path

from openpyxl.styles import Alignment, Border, Font, PatternFill, Protection, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.protection import SheetProtection

# ---------------------------------------------------------------------------
# Palette (MeshKit)
# ---------------------------------------------------------------------------
ACCENT = "C43E0B"
INPUT_FILL = PatternFill("solid", fgColor="FFF4C7")   # yellow = type here
CALC_FILL = PatternFill("solid", fgColor="F3F1EA")
HEAD_FILL = PatternFill("solid", fgColor="1F2937")
ACCENT_FILL = PatternFill("solid", fgColor=ACCENT)
HEAD_FONT = Font(bold=True, color="FFFFFF")
TITLE_FONT = Font(bold=True, size=16, color=ACCENT)
H2_FONT = Font(bold=True, size=12)
BOLD = Font(bold=True)
BIG_RESULT = Font(bold=True, size=14, color=ACCENT)
MUTED = Font(color="6B7280", italic=True)
THIN = Side(style="thin", color="D1D5DB")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP_TOP = Alignment(wrap_text=True, vertical="top")

MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00'
MONEY4 = '"$"#,##0.0000'
PCT = "0.0%"
NUM1 = "#,##0.0"
NUM0 = "#,##0"
DATE = "yyyy-mm-dd"

SUPPORT = "Support: message me on Etsy, use meshkit.pro/about#feedback, or email meshkit@quantlance.com (include the version number above)."
LICENCE = ("Licence: personal and small-business use. You may not resell, share or redistribute this file "
           "or copies of it.")
OPEN_NOTE = ("Google Sheets: upload the file to Drive, open it, then File > Make a copy (or File > Import). "
             "Excel: click Enable Editing if the yellow bar appears.")
PROTECT_NOTE = ("Sheets are protected so formulas are not broken by accident; there is no password. "
                "Excel: Review > Unprotect Sheet. Google Sheets: Data > Protect sheets and ranges.")


def footer_url(campaign: str) -> str:
    return f"https://meshkit.pro/?utm_source=etsy&utm_medium=spreadsheet&utm_campaign={campaign}"


def footer_text(campaign: str) -> str:
    return f"Made by meshkit.pro - free online calculators: {footer_url(campaign)}"


# ---------------------------------------------------------------------------
# Cell helpers
# ---------------------------------------------------------------------------
def protect(ws, *, allow_format=False):
    # OOXML semantics: True = the action is prohibited. Buyers may select any cell
    # (to read formulas), resize, sort and filter; they may not edit locked cells.
    ws.protection = SheetProtection(
        sheet=True,
        formatCells=not allow_format,
        formatColumns=False,
        formatRows=False,
        sort=False,
        autoFilter=False,
        selectLockedCells=False,
        selectUnlockedCells=False,
    )


def header(ws, row, labels, start_col=1, height=None):
    for i, label in enumerate(labels):
        c = ws.cell(row=row, column=start_col + i, value=label)
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    if height:
        ws.row_dimensions[row].height = height


def input_cell(ws, ref, value=None, fmt=None):
    c = ws[ref] if isinstance(ref, str) else ref
    if value is not None:
        c.value = value
    c.fill, c.border, c.protection = INPUT_FILL, BOX, Protection(locked=False)
    if fmt:
        c.number_format = fmt
    return c


def calc_cell(ws, ref, formula, fmt=None, bold=False):
    c = ws[ref] if isinstance(ref, str) else ref
    c.value = formula
    c.fill, c.border = CALC_FILL, BOX
    if fmt:
        c.number_format = fmt
    if bold:
        c.font = BOLD
    return c


def title(ws, text, subtitle=None):
    ws["A1"] = text
    ws["A1"].font = TITLE_FONT
    if subtitle:
        ws["A2"] = subtitle
        ws["A2"].font = MUTED


def widths(ws, mapping):
    for col, w in mapping.items():
        ws.column_dimensions[col].width = w


def list_validation(ws, formula_or_list, ranges, allow_blank=True, error_title="Pick from the list",
                    error="Choose one of the options in the dropdown."):
    """Adds a dropdown. `formula_or_list` is either a range string such as
    "=Settings!$A$5:$A$11" or a Python list of short literals."""
    if isinstance(formula_or_list, (list, tuple)):
        f1 = '"' + ",".join(formula_or_list) + '"'
    else:
        f1 = formula_or_list
    dv = DataValidation(type="list", formula1=f1, allow_blank=allow_blank, showErrorMessage=True,
                        errorTitle=error_title, error=error)
    ws.add_data_validation(dv)
    for r in ranges:
        dv.add(r)
    return dv


# ---------------------------------------------------------------------------
# Start Here and Limitations tabs
# ---------------------------------------------------------------------------
def build_start(wb, *, product, version, steps, campaign, notes=(), index=0):
    ws = wb.create_sheet("Start Here", index)
    ws.column_dimensions["A"].width = 118
    lines = [
        (f"MeshKit {product}", TITLE_FONT),
        (f"Version {version}. Formula-only workbook for Excel 2016 or newer and Google Sheets. "
         f"No macros, no add-ins.", MUTED),
        ("", None),
        ("HOW TO USE", H2_FONT),
    ]
    for i, s in enumerate(steps, start=1):
        lines.append((f"{i}. {s}", None))
    lines += [
        ("", None),
        ("GOOD TO KNOW", H2_FONT),
        ("Yellow cells are inputs. Grey cells are calculated; do not type over them.", None),
        (OPEN_NOTE, None),
        (PROTECT_NOTE, None),
    ]
    for n in notes:
        lines.append((n, None))
    lines += [
        ("", None),
        (LICENCE, MUTED),
        (SUPPORT, MUTED),
        ("", None),
        (footer_text(campaign), BOLD),
    ]
    for i, (t, f) in enumerate(lines, start=1):
        c = ws.cell(row=i, column=1, value=t)
        if f:
            c.font = f
        c.alignment = WRAP_TOP
    last = len(lines)
    ws.cell(row=last, column=1).hyperlink = footer_url(campaign)
    ws.cell(row=last, column=1).font = Font(bold=True, color=ACCENT, underline="single")
    protect(ws)
    return ws


def build_limitations(wb, *, rows, campaign, intro, index=None):
    ws = wb.create_sheet("Limitations") if index is None else wb.create_sheet("Limitations", index)
    widths(ws, {"A": 30, "B": 78, "C": 44})
    title(ws, "What this spreadsheet does not do")
    ws["A2"] = intro
    ws["A2"].font = MUTED
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells("A2:C2")
    ws.row_dimensions[2].height = 34
    header(ws, 4, ["Limitation", "Why it matters", "Workaround / where it is done"])
    r = 5
    for a, b, c in rows:
        ws.cell(row=r, column=1, value=a).font = BOLD
        ws.cell(row=r, column=1).alignment = WRAP_TOP
        ws.cell(row=r, column=2, value=b).alignment = WRAP_TOP
        ws.cell(row=r, column=3, value=c).alignment = WRAP_TOP
        ws.row_dimensions[r].height = 52
        r += 1
    r += 1
    c = ws.cell(row=r, column=1, value=footer_text(campaign))
    c.hyperlink = footer_url(campaign)
    c.font = Font(bold=True, color=ACCENT, underline="single")
    protect(ws)
    return ws


# ---------------------------------------------------------------------------
# Verification helpers (pure-Python recalculation with the `formulas` engine)
# ---------------------------------------------------------------------------
def recalc(xlsx: Path) -> dict:
    """Returns {('SHEET', 'A1'): value} for every cell the engine computed."""
    import formulas  # imported lazily so building does not need it

    model = formulas.ExcelModel().loads(str(xlsx)).finish()
    sol = model.calculate()
    out = {}
    for k, v in sol.items():
        if "]" not in k or "!" not in k:
            continue
        sheet = k.split("]")[1].split("!")[0].strip("'")
        cell = k.split("!")[-1].replace("$", "")
        val = v.value if hasattr(v, "value") else v
        try:
            val = val[0][0]
        except Exception:
            pass
        out[(sheet.upper(), cell)] = val
    return out


ERROR_TOKENS = ("#REF!", "#NAME?", "#VALUE!", "#N/A", "#DIV/0!", "#NUM!", "#NULL!")


def scan_errors(vals: dict, sheets) -> list[str]:
    bad = []
    want = {s.upper() for s in sheets}
    for (sheet, cell), v in vals.items():
        if sheet not in want:
            continue
        s = str(v)
        if any(tok in s for tok in ERROR_TOKENS):
            bad.append(f"{sheet}!{cell} = {s}")
    return sorted(bad)


def num(v) -> float:
    """Coerces an engine value (numpy scalar, str, XlError) to float."""
    try:
        return float(v)
    except Exception:
        raise AssertionError(f"not numeric: {v!r}")


def close(a, b, rel=0.005, abs_tol=0.005) -> bool:
    a, b = float(a), float(b)
    return abs(a - b) <= max(abs_tol, rel * max(abs(a), abs(b)))


def temp_copy(xlsx: Path):
    tmp = Path(tempfile.mkdtemp()) / xlsx.name
    shutil.copy(xlsx, tmp)
    return tmp


def cleanup(tmp: Path):
    shutil.rmtree(tmp.parent, ignore_errors=True)


def excel_date(d: _dt.date) -> int:
    return (d - _dt.date(1899, 12, 30)).days
