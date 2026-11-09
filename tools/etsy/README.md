# Etsy spreadsheets — MeshKit

Three formula-only `.xlsx` products (Excel 2016+ / Google Sheets; no macros,
no LET/LAMBDA/XLOOKUP/dynamic arrays) sold on Etsy as a lead channel for
meshkit.pro. Each builder writes `dist/<Product>-v<VERSION>.xlsx` and has a
`--verify` flag that recalculates the workbook with the pure-Python
`formulas` engine, scans every visible sheet for `#REF!/#NAME?/#VALUE!/#N/A`,
and checks hand-computed values.

| Script | Output | Tabs |
| --- | --- | --- |
| `build_pricing.py` | `MeshKit-3D-Print-Pricing-Calculator-v1.0.xlsx` | Start Here · Settings · Quote · Batch · Limitations (+ hidden Calc) |
| `build_filament_tracker.py` | `MeshKit-Filament-Inventory-Tracker-v1.0.xlsx` | Start Here · Spools · Tare DB · Dry Box Log · Summary · Settings · Limitations |
| `build_job_log.py` | `MeshKit-Print-Job-Log-v1.0.xlsx` | Start Here · Jobs · Monthly P&L · Settings · Limitations |

- `common.py` — shared palette (accent `#C43E0B`, header `#1F2937`, calc fill
  `#F3F1EA`, yellow unlocked inputs), Start Here / Limitations builders,
  sheet protection (no password), and the `formulas` recalculation helpers.
- `export-fixtures.ts` — runs `calculatePrintCost` from `src/core/cost.ts` on
  four input sets (both pricing modes, with/without channel fee, one with
  `timeCorrectionPct`) and writes `fixtures/*.json`.
  `build_pricing.py --verify` types each fixture into Quote and asserts
  `unitCost`, `sellingPrice`, `channelFees` and `profit` match within 0.5%
  (they match to floating-point precision).
- The pricing Quote/Batch maths is a port of `src/core/cost.ts`; the Tare DB
  is generated from `src/data/spools.json` (re-run the builder when it changes).

```bash
# from the repo root
npx vite-node tools/etsy/export-fixtures.ts          # refresh fixtures/*.json
python3 -m venv .venv && .venv/bin/pip install openpyxl formulas
.venv/bin/python tools/etsy/build_pricing.py --verify
.venv/bin/python tools/etsy/build_filament_tracker.py --verify
.venv/bin/python tools/etsy/build_job_log.py --verify
```

Bump `VERSION` in a builder when its sheet changes; Etsy buyers can
re-download updated files. `dist/` is git-ignored.
