#!/usr/bin/env python3
# Copied from ledger-retirement-planner/tools/etsy-sheet/images/xlsx2html.py (self-contained copy for MeshKit).
"""Faithful HTML rendering of an .xlsx workbook, for product images.

Two subcommands:

  recalc  <xlsx> <values.json> [--set Sheet!A1=val ...]
      Recalculates the workbook once with the pure-Python `formulas` engine
      (slow: ~10 min for the planner) and caches every computed value to JSON
      as {"SHEET": {"A1": value}}.  `--set` writes literal inputs into a copy
      of the workbook before recalculating (used for scenario variants).

  render  <xlsx> <values.json> <shotlist.json> <outdir>
      For every shot in the shot list writes <outdir>/<id>.html: a
      Google-Sheets-like rendering (column letters, row numbers, formula bar,
      tab strip) of one sheet range, honouring fills, fonts, number formats,
      column widths, row heights, merged cells, borders and alignment.

Shot entry fields (also accepted inside a `views: {name: {...}}` map, which
writes <id>.<name>.html per view):
  sheet, range ("A1:D20"), active (cell in the name box / formula bar),
  cols (["A","B","E:G"]: other columns in the range are drawn as hidden-column
  markers), rows (["1:3","22:44"]: a gap is drawn as a frozen-pane divider),
  hide_tabs, col_px (px per Excel width unit, default 7), show_formula,
  thead_rows ([4]: rows wrapped in <thead>, repeated per printed page),
  zero_blank (numeric zeros render empty, for blank printable forms).
The shot list may be a plain list or {"brand": ..., "shots": [...]} (the
brand block is used by render.mjs).
`render --set Inputs!B6=62` shows a literal override (pair it with a values
JSON recalculated with the same --set).
Date number formats (yyyy-mm-dd, mmm yyyy, ...) are applied to literal dates
and to formula results (Excel serials).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import math
import re
import shutil
import sys
import tempfile
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter, range_boundaries

# ---------------------------------------------------------------------------
# Recalculation
# ---------------------------------------------------------------------------


def recalc(xlsx: Path, sets: list[str]) -> dict:
    import formulas  # slow import; only needed here

    src = xlsx
    tmp = None
    if sets:
        wb = load_workbook(xlsx)
        apply_sets(wb, sets)
        tmp = Path(tempfile.mkdtemp()) / xlsx.name
        wb.save(tmp)
        src = tmp
    model = formulas.ExcelModel().loads(str(src)).finish()
    sol = model.calculate()
    out: dict[str, dict[str, object]] = {}
    for k, v in sol.items():
        if "]" not in k or "!" not in k:
            continue
        sheet = k.split("]")[1].split("'!")[0].split("!")[0].strip("'")
        cell = k.split("!")[-1].replace("$", "")
        if ":" in cell:
            continue
        val = v.value if hasattr(v, "value") else v
        try:
            val = val[0][0]
        except Exception:
            pass
        out.setdefault(sheet.upper(), {})[cell] = _jsonable(val)
    if tmp is not None:
        shutil.rmtree(tmp.parent, ignore_errors=True)
    return out


def _jsonable(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if hasattr(v, "item"):
        try:
            return _jsonable(v.item())
        except Exception:
            pass
    return str(v)


# ---------------------------------------------------------------------------
# Number formatting (subset of Excel number formats sufficient for the sheet)
# ---------------------------------------------------------------------------

_COLOR_TOKEN = re.compile(r"\[(Red|Blue|Green|Black|White|Yellow|Magenta|Cyan)\]", re.I)
_COLOR_MAP = {"red": "#c0392b", "blue": "#1d4ed8", "green": "#15803d", "black": "#000", "white": "#fff",
              "yellow": "#ca8a04", "magenta": "#be185d", "cyan": "#0e7490"}


def _is_date_fmt(fmt: str | None) -> bool:
    """True for date formats such as yyyy-mm-dd or mmm yyyy (no digit placeholders)."""
    core = re.sub(r'"[^"]*"|\[[^\]]*\]', "", (fmt or "").split(";")[0])
    return bool(re.search(r"[ymd]", core, re.I)) and not re.search(r"[#0?]", core)


def format_date(value, fmt: str) -> str:
    """Formats an Excel serial or date/datetime with a subset of Excel date codes
    (yyyy, yy, mmmm, mmm, mm, m, dddd, ddd, dd, d)."""
    if isinstance(value, (int, float)):
        d = _dt.date(1899, 12, 30) + _dt.timedelta(days=int(value))
    else:
        d = value
    core = re.sub(r"\[[^\]]*\]", "", fmt.split(";")[0])

    def rep(m):
        t = m.group(0)
        if t.startswith('"'):
            return t[1:-1]
        k, n = t[0].lower(), min(len(t), 4)
        if k == "y":
            return f"{d.year:04d}" if n >= 3 else f"{d.year % 100:02d}"
        if k == "m":
            return [str(d.month), f"{d.month:02d}", d.strftime("%b"), d.strftime("%B")][n - 1]
        return [str(d.day), f"{d.day:02d}", d.strftime("%a"), d.strftime("%A")][n - 1]

    return re.sub(r'"[^"]*"|y+|m+|d+', rep, core, flags=re.I).replace("\\", "")


def format_number(value, fmt: str | None) -> tuple[str, str | None]:
    """Returns (text, css_color_or_None) for a numeric value."""
    if value is None:
        return "", None
    if isinstance(value, bool):
        return ("TRUE" if value else "FALSE"), None
    if isinstance(value, str):
        return value, None
    if _is_date_fmt(fmt):
        return format_date(value, fmt), None
    if not fmt or fmt == "General":
        if isinstance(value, float):
            if value.is_integer():
                return str(int(value)), None
            return f"{value:.10g}", None
        return str(value), None
    sections = fmt.split(";")
    sec = sections[0]
    if value < 0 and len(sections) > 1:
        sec = sections[1]
        value = -value
    elif value == 0 and len(sections) > 2:
        sec = sections[2]
    color = None
    m = _COLOR_TOKEN.search(sec)
    if m:
        color = _COLOR_MAP[m.group(1).lower()]
        sec = _COLOR_TOKEN.sub("", sec)
    # literal text in quotes
    literals = re.findall(r'"([^"]*)"', sec)
    core = re.sub(r'"[^"]*"', "\0", sec)
    pct = "%" in core
    if pct:
        value *= 100
        core = core.replace("%", "")
    core_clean = core.replace("\0", "").replace("-", "").replace("\\", "").strip()
    if "." in core_clean:
        decimals = len(core_clean.split(".")[1].rstrip("%"))
    else:
        decimals = 0
    grouping = "," in core_clean
    num = f"{value:,.{decimals}f}" if grouping else f"{value:.{decimals}f}"
    text = core
    for lit in literals:
        text = text.replace("\0", lit, 1)
    # replace the numeric placeholder with the formatted number
    text = re.sub(r"[#0,]+(\.[#0]+)?", num, text, count=1)
    if pct:
        text += "%"
    text = text.replace("\\", "")
    return text, color


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------

# Base metrics: Excel's default is Calibri 11 pt (≈14.7 px); default row 15 pt
# (20 px); one column-width unit ≈ 7 px + 5 px padding.  Google Sheets chrome
# colours are used for headers, gridlines and the tab strip.
BASE_FONT_PX = 14.7
DEFAULT_ROW_PT = 15.0
DEFAULT_COL_W = 8.43

CSS = """
*{box-sizing:border-box}
.sheet{display:flex;flex-direction:column;background:#fff;font-family:Carlito,Calibri,Arial,Helvetica,sans-serif;font-size:%(fs).1fpx;color:#000;overflow:hidden}
.sheet .bar{flex:none;display:flex;align-items:center;height:32px;border-bottom:1px solid #c7c7c7;background:#fff;font-size:13.5px;color:#202124;font-family:Arial,Helvetica,sans-serif}
.sheet .bar .name{width:112px;padding:0 12px;border-right:1px solid #c7c7c7;height:100%%;display:flex;align-items:center}
.sheet .bar .fx{padding:0 10px 0 12px;color:#5f6368;font-style:italic;font-family:Georgia,serif;font-size:15px}
.sheet .bar .formula{flex:1;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sheet .grid{flex:1;overflow:hidden;position:relative}
.sheet table{border-collapse:collapse;table-layout:fixed}
.sheet td,.sheet th{border:1px solid #e1e1e1;padding:0 4px;overflow:hidden;white-space:nowrap;vertical-align:bottom;font-weight:normal;text-align:left;line-height:1.2}
.sheet th{background:#f8f9fa;color:#5f6368;text-align:center;vertical-align:middle;font-size:12px;border-color:#c7c7c7;font-family:Arial,Helvetica,sans-serif;padding:0}
.sheet th.hid{width:4px;padding:0;background:#dadce0;border-color:#dadce0}
.sheet td.hid{width:4px;padding:0;background:#f1f3f4;border-left:1px solid #c7c7c7;border-right:1px solid #c7c7c7}
.sheet td.active{outline:2px solid #1a73e8;outline-offset:-2px}
.sheet td.wrap{white-space:normal;overflow-wrap:break-word;vertical-align:top}
.sheet td.spill{overflow:visible;position:relative;z-index:1;text-overflow:clip}
.sheet td.spill span{position:absolute;left:4px;bottom:1px;white-space:nowrap;padding-right:4px}
.sheet tr.frozen td,.sheet tr.frozen th{border-top:2px solid #9aa0a6}
.sheet .tabs{flex:none;display:flex;align-items:center;height:36px;background:#f8f9fa;border-top:1px solid #c7c7c7;padding-left:10px;font-size:13.5px;color:#3c4043;font-family:Arial,Helvetica,sans-serif}
.sheet .tabs .ico{width:36px;text-align:center;color:#5f6368;font-size:20px;margin-right:4px}
.sheet .tabs .tab{padding:0 16px;height:36px;display:flex;align-items:center;border-right:1px solid #dadce0;white-space:nowrap}
.sheet .tabs .tab.on{background:#fff;color:#0b57d0;font-weight:bold;box-shadow:inset 0 -3px 0 #0b57d0;border-right:1px solid #dadce0}
"""


def _hex_color(color) -> str | None:
    """openpyxl Color → #rrggbb, or None if it is the automatic/theme colour."""
    if color is None:
        return None
    try:
        if color.type == "rgb" and isinstance(color.rgb, str):
            rgb = color.rgb[-6:]
            if rgb.upper() == "000000":
                return None  # automatic black: let the stylesheet decide
            return "#" + rgb
        if color.type == "indexed":
            from openpyxl.styles.colors import COLOR_INDEX
            idx = color.indexed
            if idx is not None and idx < len(COLOR_INDEX):
                return "#" + COLOR_INDEX[idx][2:]
    except Exception:
        return None
    return None


def _resolved(cell, computed: dict, sheet_name: str):
    """The value a spreadsheet app would display: cached computed value for formulas."""
    v = cell.value
    if isinstance(v, str) and v.startswith("="):
        return computed.get(sheet_name.upper(), {}).get(cell.coordinate)
    return v


def _cell_text(cell, computed: dict, sheet_name: str) -> tuple[str, str | None, bool]:
    """Returns (display text, colour override, is_numeric)."""
    v = _resolved(cell, computed, sheet_name)
    if v is None:
        return "", None, False
    if isinstance(v, bool):
        return ("TRUE" if v else "FALSE"), None, False
    if isinstance(v, (int, float)):
        text, color = format_number(v, cell.number_format)
        return text, color, True
    if isinstance(v, (_dt.datetime, _dt.date)):
        if _is_date_fmt(cell.number_format):
            return format_date(v, cell.number_format), None, True
        return v.isoformat()[:10], None, True
    s = str(v)
    if s.startswith("#") and s.endswith(("!", "?", "A")):  # #VALUE!, #NAME?, #N/A
        return s, "#c0392b", False
    return s, None, False


def _formula_display(cell) -> str:
    """What the formula bar shows for a cell: the formula itself or the literal."""
    v = cell.value
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.isoformat()[:10]
    if isinstance(v, float):
        if "%" in (cell.number_format or ""):
            return f"{v * 100:g}%"
        return f"{v:g}"
    return str(v)


def _parse_cols(spec, min_col: int, max_col: int) -> list[int]:
    """`cols` may be a list like ["A","B","E:G"]; returns 1-based column indices."""
    if not spec:
        return list(range(min_col, max_col + 1))
    from openpyxl.utils import column_index_from_string as ci
    out: list[int] = []
    for part in spec:
        if ":" in part:
            a, b = part.split(":")
            out.extend(range(ci(a), ci(b) + 1))
        else:
            out.append(ci(part))
    return out


def _parse_rows(spec, min_row: int, max_row: int) -> list[int]:
    """`rows` may be a list like ["1:3", "22:44"]; returns row numbers in order."""
    if not spec:
        return list(range(min_row, max_row + 1))
    out: list[int] = []
    for part in spec:
        a, _, b = str(part).partition(":")
        out.extend(range(int(a), int(b or a) + 1))
    return out


def render_range(wb, computed: dict, sheet_name: str, rng: str, *, active: str | None = None,
                 cols: list[str] | None = None, rows: list[str] | None = None,
                 hide_tabs: list[str] | None = None, col_px: float = 7.0,
                 show_formula: bool = True, head_w: int = 46,
                 thead_rows: list[int] | None = None, zero_blank: bool = False) -> str:
    """Renders `rng` of `sheet_name` as a self-contained HTML fragment.

    `cols` restricts the rendered columns; omitted columns inside the range are
    drawn as Sheets-style hidden-column markers so the column letters stay
    honest.  The outer `.sheet` div is sized to the content; a host page may
    give it a fixed height (the grid clips, the tab strip stays at the bottom).
    """
    ws = wb[sheet_name]
    min_col, min_row, max_col, max_row = range_boundaries(rng)
    hide = set(hide_tabs or [])
    shown = _parse_cols(cols, min_col, max_col)
    shown_set = set(shown)

    merged_root: dict[tuple[int, int], tuple[int, int]] = {}
    covered: set[tuple[int, int]] = set()
    for mr in ws.merged_cells.ranges:
        c0, r0, c1, r1 = mr.bounds
        merged_root[(r0, c0)] = (r1, c1)
        for rr in range(r0, r1 + 1):
            for cc in range(c0, c1 + 1):
                if (rr, cc) != (r0, c0):
                    covered.add((rr, cc))

    def col_width_px(ci: int) -> int:
        dim = ws.column_dimensions.get(get_column_letter(ci))
        w = dim.width if dim is not None and dim.width else DEFAULT_COL_W
        return int(round(w * col_px + 5))

    def row_height_px(ri: int) -> int:
        dim = ws.row_dimensions.get(ri)
        if dim is not None and dim.height:
            return int(round(dim.height * 4 / 3))
        # Auto-fit, as Excel/Sheets do: the tallest font (or the tallest wrapped
        # text block) in the row sets the height.
        best_pt = DEFAULT_ROW_PT
        for c in shown:
            cell = ws.cell(row=ri, column=c)
            if cell.value in (None, "") or (ri, c) in covered:
                continue
            if (ri, c) in merged_root and merged_root[(ri, c)][0] > ri:
                continue  # Excel does not auto-fit rows for vertically merged cells
            f = cell.font
            sz = float(f.sz) if f is not None and f.sz else 11.0
            lines = 1
            if cell.alignment is not None and cell.alignment.wrap_text:
                text, _, _ = _cell_text(cell, computed, sheet_name)
                width = col_width_px(c) - 8
                if (ri, c) in merged_root:
                    width = sum(col_width_px(x) for x in range(c, min(merged_root[(ri, c)][1], max_col) + 1)) - 8
                per_char = sz * 4 / 3 * (0.56 if f is not None and f.b else 0.5)
                lines = max(1, math.ceil(len(text) * per_char / max(width, 1)))
            best_pt = max(best_pt, lines * sz * 1.3 + 0.75)
        return int(round(best_pt * 4 / 3))

    # Column sequence with hidden markers between non-adjacent shown columns.
    col_seq: list[tuple[str, int]] = []  # ("col", idx) or ("hid", 0)
    prev = None
    for c in shown:
        if prev is not None and c != prev + 1:
            col_seq.append(("hid", 0))
        col_seq.append(("col", c))
        prev = c
    widths = [col_width_px(c) if kind == "col" else 4 for kind, c in col_seq]
    total_w = head_w + sum(widths)

    out = [f"<style>{CSS % {'fs': BASE_FONT_PX}}</style>",
           f'<div class="sheet" style="width:{total_w}px">']
    act = active or f"{get_column_letter(min_col)}{min_row}"
    fdisp = _formula_display(ws[act]) if show_formula else ""
    out.append(f'<div class="bar"><div class="name">{html.escape(act)}</div><div class="fx">fx</div>'
               f'<div class="formula">{html.escape(fdisp)}</div></div>')
    out.append(f'<div class="grid"><table style="width:{total_w}px">')
    out.append("<colgroup>" + f'<col style="width:{head_w}px">' + "".join(f'<col style="width:{w}px">' for w in widths) + "</colgroup>")
    out.append('<tr style="height:22px"><th></th>' + "".join(
        f'<th>{get_column_letter(c)}</th>' if kind == "col" else '<th class="hid"></th>' for kind, c in col_seq) + "</tr>")

    row_list = _parse_rows(rows, min_row, max_row)
    thead = set(thead_rows or [])
    prev_r = None
    in_thead = False
    for r in row_list:
        h = row_height_px(r)
        if r in thead and not in_thead:
            out.append("<thead>"); in_thead = True
        elif r not in thead and in_thead:
            out.append("</thead><tbody>"); in_thead = False
        frozen = ' class="frozen"' if prev_r is not None and r != prev_r + 1 else ""
        prev_r = r
        out.append(f'<tr{frozen} style="height:{h}px"><th>{r}</th>')
        for kind, c in col_seq:
            if kind == "hid":
                out.append('<td class="hid"></td>')
                continue
            if (r, c) in covered:
                continue
            cell = ws.cell(row=r, column=c)
            text, fmt_color, is_num = _cell_text(cell, computed, sheet_name)
            if zero_blank and is_num and _resolved(cell, computed, sheet_name) == 0:
                text = ""
            styles: list[str] = []
            attrs: list[str] = []
            classes: list[str] = []
            if (r, c) in merged_root:
                r1, c1 = merged_root[(r, c)]
                rs = len([x for x in row_list if r <= x <= min(r1, max_row)])
                span_cols = [x for x in shown if c <= x <= min(c1, max_col)]
                cs = len(span_cols)
                if rs > 1:
                    attrs.append(f'rowspan="{rs}"')
                if cs > 1:
                    attrs.append(f'colspan="{cs}"')
            fill = cell.fill
            if fill is not None and fill.fill_type == "solid":
                fc = _hex_color(fill.fgColor)
                if fc:
                    styles.append(f"background:{fc}")
            f = cell.font
            font_color = _hex_color(f.color) if f is not None else None
            if f is not None:
                if f.b:
                    styles.append("font-weight:bold")
                if f.i:
                    styles.append("font-style:italic")
                if f.u:
                    styles.append("text-decoration:underline")
                if f.sz and float(f.sz) != 11:
                    styles.append(f"font-size:{float(f.sz) * 4 / 3:.1f}px")
                if font_color:
                    styles.append(f"color:{font_color}")
            if fmt_color and not font_color:
                styles.append(f"color:{fmt_color}")
            al = cell.alignment
            ha = al.horizontal if al is not None else None
            if ha in ("center", "right", "left"):
                styles.append(f"text-align:{ha}")
            elif is_num:
                styles.append("text-align:right")
            wrap = bool(al is not None and al.wrap_text)
            if al is not None and al.vertical in ("top", "center"):
                styles.append("vertical-align:" + ("middle" if al.vertical == "center" else "top"))
            if wrap:
                classes.append("wrap")
            b = cell.border
            if b is not None:
                for side_name in ("left", "right", "top", "bottom"):
                    side = getattr(b, side_name)
                    if side is not None and side.style:
                        styles.append(f"border-{side_name}:1px solid {_hex_color(side.color) or '#000'}")
            if cell.coordinate == act:
                classes.append("active")
            # Text spills into empty neighbours, as in Sheets/Excel.
            inner = html.escape(text)
            if text and not is_num and not wrap and (r, c) not in merged_root and ha in (None, "general", "left"):
                nxt = ws.cell(row=r, column=c + 1).value if c < max_col else "x"
                if nxt in (None, ""):
                    classes.append("spill")
                    inner = f"<span>{inner}</span>"
            cls = f' class="{" ".join(classes)}"' if classes else ""
            st = f' style="{";".join(styles)}"' if styles else ""
            out.append(f"<td{cls}{st} {' '.join(attrs)}>{inner}</td>")
        out.append("</tr>")
    if in_thead:
        out.append("</thead>")
    out.append("</table></div>")

    tabs = []
    for s in wb.worksheets:
        if s.sheet_state != "visible" or s.title in hide:
            continue
        on = " on" if s.title == sheet_name else ""
        tabs.append(f'<div class="tab{on}">{html.escape(s.title)}</div>')
    out.append('<div class="tabs"><div class="ico">+</div><div class="ico">&#8801;</div>' + "".join(tabs) + "</div>")
    out.append("</div>")
    return "".join(out)


def load_values(path: Path) -> dict:
    return json.loads(Path(path).read_text()) if Path(path).exists() else {}


def apply_sets(wb, sets):
    """Writes literal `Sheet!A1=value` overrides into the in-memory workbook."""
    for s in sets or []:
        ref, val = s.split("=", 1)
        sheet, cell = ref.split("!")
        try:
            v = float(val)
            v = int(v) if v.is_integer() else v
        except ValueError:
            v = val
        wb[sheet][cell] = v


def cmd_render(args):
    wb = load_workbook(args.xlsx)
    apply_sets(wb, args.set)
    computed = load_values(args.values)
    shots = json.loads(Path(args.shotlist).read_text())
    if isinstance(shots, dict):
        shots = shots.get("shots") or shots.get("sections") or []
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for shot in shots:
        for key, spec in _sheet_specs(shot):
            frag = render_range(wb, computed, spec["sheet"], spec["range"], active=spec.get("active"),
                                cols=spec.get("cols"), rows=spec.get("rows"), hide_tabs=spec.get("hide_tabs"),
                                col_px=spec.get("col_px", 7.0), show_formula=spec.get("show_formula", True),
                                thead_rows=spec.get("thead_rows"), zero_blank=spec.get("zero_blank", False))
            path = outdir / f"{shot['id']}{key}.html"
            path.write_text(frag)
            print("wrote", path)


def _sheet_specs(shot):
    """A shot may carry one sheet view (`sheet`+`range`) or several under `views`."""
    if shot.get("sheet") and shot.get("range"):
        yield "", shot
    for name, spec in (shot.get("views") or {}).items():
        yield f".{name}", spec


def cmd_recalc(args):
    import time
    t0 = time.time()
    out = recalc(Path(args.xlsx), args.set or [])
    Path(args.values).parent.mkdir(parents=True, exist_ok=True)
    Path(args.values).write_text(json.dumps(out))
    print(f"recalc done in {time.time() - t0:.0f}s → {args.values} ({sum(len(v) for v in out.values())} cells)")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("recalc")
    r.add_argument("xlsx"); r.add_argument("values"); r.add_argument("--set", action="append")
    r.set_defaults(fn=cmd_recalc)
    h = sub.add_parser("render")
    h.add_argument("xlsx"); h.add_argument("values"); h.add_argument("shotlist"); h.add_argument("outdir")
    h.add_argument("--set", action="append", help="Sheet!A1=value literal override shown in the rendering")
    h.set_defaults(fn=cmd_render)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
