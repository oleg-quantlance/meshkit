# Etsy listing images (xlsx → HTML → PNG / MP4)

Self-contained copy of `ledger-retirement-planner/tools/etsy-sheet/images/`
with MeshKit branding. Produces the 2000×2000 listing images and the 10 s
1080×1080 listing videos for the four Etsy products from the real workbooks
(recalculated with the pure-Python `formulas` engine, rendered as a
Sheets-like HTML table, composed by Playwright).

```
images/
  xlsx2html.py            recalc (cache computed values) + render sheet ranges to HTML
  render.mjs              compose PNG stills / record the MP4 from a JSON shot list
  brand-meshkit.json      MeshKit palette, IBM Plex fonts, MK mark
  shots-pricing.json      8 images, 3D Print Pricing Calculator
  shots-filament.json     6 images, Filament Inventory Tracker
  shots-joblog.json       6 images, Print Job Log
  shots-cheatsheets.json  7 images, Cheat Sheets (PDF pages; see below)
  video-*.json            video specs (3 pre-computed scenarios each)
```

## Run

```bash
cd <meshkit repo>
PY=<venv python with openpyxl + formulas>
W=<scratch dir outside the repo>
X=tools/etsy/dist/MeshKit-3D-Print-Pricing-Calculator-v1.0.xlsx

# 1. Recalculate once (5–20 s per workbook).
$PY tools/etsy/images/xlsx2html.py recalc $X $W/pricing-base.json

# 2. Sheet ranges → HTML fragments, then 3. compose the PNGs.
$PY tools/etsy/images/xlsx2html.py render $X $W/pricing-base.json tools/etsy/images/shots-pricing.json $W/html-pricing
node tools/etsy/images/render.mjs --shots tools/etsy/images/shots-pricing.json \
     --html $W/html-pricing --values $W/pricing-base.json --out tools/etsy/dist/images/pricing

# The pricing compare shot (06) is rendered with PLA at $22/kg so the numbers
# match the public calculator's defaults:
$PY tools/etsy/images/xlsx2html.py recalc $X $W/pricing-ppk22.json --set 'Quote!B6=22'
#   (then render a one-shot list containing only 06-compare with --set 'Quote!B6=22'
#    and the ppk22 values into the same html dir before step 3)

# 4. Video: recalc each scenario, render its inputs/results views, record.
for v in 50 120 200; do
  $PY tools/etsy/images/xlsx2html.py recalc $X $W/pricing-video-$v.json --set "Quote!B7=$v" &
done; wait
#   one-shot list per scenario: [{"id":"video-50","views":{"inputs":…,"results":…}}]
node tools/etsy/images/render.mjs --video tools/etsy/images/video-pricing.json --html $W/html-pricing-video --out tools/etsy/dist/images/pricing
```

Filament and Job Log run the same way (`Spools!J5` = 820/500/380 and
`Jobs!M9` = 45/58/72 are the video variables).

Cheat sheets: `pdftoppm -r 110 -png tools/etsy/dist/MeshKit-3D-Printing-Cheat-Sheets-v1.0-Letter.pdf $W/cheat/page`
then replace the `__SCRATCH__` placeholder in `shots-cheatsheets.json` with `$W`
(`sed "s#__SCRATCH__#$W#g" … > $W/shots.json`) and run `render.mjs --shots` on
the resolved copy (`--html` can point at any directory; no fragments are needed).

## Additions over the original pipeline

* `xlsx2html.py`: date number formats (`yyyy-mm-dd`, `mmm yyyy`, …) are applied to
  literal dates and to formula results (Excel serials).
* `render.mjs`:
  * `chart.bar` = `true` (columns) or `"horizontal"` (bars) draws a bar chart from the
    cached values: `categories: [col, row0, row1]`, `series`, `colors`,
    `category_format` ("mmm yyyy" for date serials), `y_format` ("money" | "number").
  * a `chart` shot that also names `sheet` + `range` stacks that sheet window above the chart.
  * a `sheet` shot with `views: {name: {sheet, range, …, caption, note}}` stacks one
    window per view.
  * `fonts.heading_line_height` in the brand file (IBM Plex needs 1.1 at 124 px).
  * Playwright is imported from this repo's `node_modules`.
