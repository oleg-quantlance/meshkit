#!/usr/bin/env python3
"""Generates per-brand empty-spool-weight pages from src/data/spools.json and
refreshes the table + submission form on empty-spool-weight-database.html.

Run from the repo root: python3 scripts/gen-spool-pages.py
"""
from pathlib import Path
import json, re, statistics, sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
gen = __import__("gen-converter-pages")

DATA = json.loads((ROOT / "src/data/spools.json").read_text())
MAKERS = {m["slug"]: m for m in DATA["makers"]}
SPOOLS = DATA["spools"]


def median_tare(s):
    vals = [m["tareG"] for m in s.get("measurements", []) if isinstance(m.get("tareG"), (int, float))]
    return round(statistics.median(vals)) if vals else s["tareG"]


def community_count(s):
    return sum(1 for m in s.get("measurements", []) if m.get("source") == "community")


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def submission_form(brand_prefill: str, page_path: str) -> str:
    return f"""
    <section class="wb-section" id="spoolSubmitSection" style="margin-top:18px;">
      <div class="section-head">
        <span>Submit Your Measurement</span>
        <span id="spoolSubmitState" class="mono" style="color:var(--status-ok);">COMMUNITY</span>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin:0 0 12px;">
        Weighed an empty spool? Add it. Submissions are reviewed by a human before they appear; approved rows are credited with the name you give. No account needed. We store only what is in this form.
      </p>
      <form id="spoolSubmitForm" class="field-grid" novalidate data-page="{esc(page_path)}">
        <div>
          <label class="field-label" for="ssBrand"><span>Brand *</span><span class="unit-tag">[maker]</span></label>
          <input type="text" id="ssBrand" name="brand" value="{esc(brand_prefill)}" maxlength="60" required placeholder="e.g. Polymaker" />
        </div>
        <div>
          <label class="field-label" for="ssLine"><span>Product line / spool type</span><span class="unit-tag">[optional]</span></label>
          <input type="text" id="ssLine" name="line" maxlength="80" placeholder="e.g. PolyTerra 1 kg cardboard" />
        </div>
        <div>
          <label class="field-label" for="ssMaterial"><span>Spool material *</span><span class="unit-tag">[core]</span></label>
          <select id="ssMaterial" name="spoolMaterial">
            <option value="cardboard">Cardboard</option>
            <option value="plastic" selected>Plastic</option>
            <option value="other">Other / mixed</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="ssTare"><span>Empty spool weight *</span><span class="unit-tag">[g]</span></label>
          <input type="number" id="ssTare" name="tareG" min="20" max="1500" step="0.1" required placeholder="e.g. 141.5" />
        </div>
        <div>
          <label class="field-label" for="ssNet"><span>Filament net weight *</span><span class="unit-tag">[g]</span></label>
          <input type="number" id="ssNet" name="netG" min="100" max="10000" step="1" value="1000" required />
        </div>
        <div>
          <label class="field-label" for="ssScale"><span>Scale used</span><span class="unit-tag">[optional]</span></label>
          <input type="text" id="ssScale" name="scale" maxlength="60" placeholder="e.g. 0.1 g kitchen scale" />
        </div>
        <div style="grid-column: 1 / -1;">
          <label class="field-label" for="ssNote"><span>Note</span><span class="unit-tag">[optional, 280 chars]</span></label>
          <input type="text" id="ssNote" name="note" maxlength="280" placeholder="Batch date, region, anything odd about the spool" />
        </div>
        <div>
          <label class="field-label" for="ssCredit"><span>Credit name</span><span class="unit-tag">[optional]</span></label>
          <input type="text" id="ssCredit" name="credit" maxlength="40" placeholder="Shown next to your row" />
        </div>
        <div class="hidden" aria-hidden="true">
          <label for="ssWebsite">Website</label>
          <input type="text" id="ssWebsite" name="website" tabindex="-1" autocomplete="off" />
        </div>
        <div style="grid-column: 1 / -1; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button type="submit" id="spoolSubmitBtn" class="btn-primary">SUBMIT MEASUREMENT</button>
          <span id="spoolSubmitMsg" class="mono" style="font-size:12px; color:var(--text-muted);">Reviewed before publishing · no account · no tracking</span>
        </div>
      </form>
    </section>"""


def table_rows(spools):
    rows = []
    for s in spools:
        n = community_count(s)
        maker = MAKERS.get(s.get("maker") or "")
        name = f'<a href="/{maker["slug"]}-empty-spool-weight">{esc(s["brand"])}</a>' if maker else esc(s["brand"])
        rows.append(
            f'          <tr><td>{name}</td><td>{esc(s["material"])}</td><td>{median_tare(s)} g</td>'
            f'<td>{len(s.get("measurements", []))}{" (" + str(n) + " community)" if n else ""}</td></tr>'
        )
    return "\n".join(rows)


def refresh_database_page():
    p = ROOT / "empty-spool-weight-database.html"
    html = p.read_text()
    new_table = f"""<table class="tech-table mono" id="spoolDbTable">
        <thead>
          <tr>
            <th>Brand and Spool</th>
            <th>Spool Material</th>
            <th>Typical Empty Tare (g)</th>
            <th>Measurements</th>
          </tr>
        </thead>
        <tbody>
{table_rows(SPOOLS)}
        </tbody>
      </table>"""
    html, n = re.subn(r'<table class="tech-table mono" id="spoolDbTable">[\s\S]*?</table>', new_table, html, count=1)
    assert n == 1, "table not found"
    # Brand index + submission form right after the table's disclaimer paragraph.
    brand_links = " · ".join(f'<a href="/{m["slug"]}-empty-spool-weight">{esc(m["name"])}</a>' for m in DATA["makers"])
    block = f"""
      <p class="field-hint" style="margin-top:10px;"><strong>Per-brand pages:</strong> {brand_links}</p>
{submission_form("", "/empty-spool-weight-database")}
    </section>"""
    if "spoolSubmitForm" in html:
        html = re.sub(r'\n      <p class="field-hint" style="margin-top:10px;"><strong>Per-brand pages:</strong>[\s\S]*?</section>', block, html, count=1)
    else:
        html = html.replace("Weigh an empty spool of the same brand once for highest accuracy.\n      </p>\n    </section>",
                            "Weigh an empty spool of the same brand once for highest accuracy.\n      </p>" + block, 1)
    assert "spoolSubmitForm" in html
    p.write_text(html)
    print("refreshed empty-spool-weight-database.html")


def brand_page(m):
    slug = f'{m["slug"]}-empty-spool-weight'
    url = f"https://meshkit.pro/{slug}"
    spools = [s for s in SPOOLS if s.get("maker") == m["slug"]]
    if not spools:
        return None
    name = m["name"]
    tares = [median_tare(s) for s in spools]
    lo, hi = min(tares), max(tares)
    total_meas = sum(len(s.get("measurements", [])) for s in spools)
    comm = sum(community_count(s) for s in spools)
    title = f"{name} Empty Spool Weight — Tare in Grams"
    if len(title) > 60:
        title = f"{name} Empty Spool Weight (g)"
    description = f"How much does an empty {name} filament spool weigh? Measured tare weights ({lo}–{hi} g) for {name} spools, with a remaining-filament calculator and a form to add your own measurement."
    rows = "\n".join(
        f'            <tr><td>{esc(s["line"])}</td><td>{esc(s["material"])}</td><td>{median_tare(s)} g</td><td>{s.get("netG", 1000)} g</td><td>{len(s.get("measurements", []))}{" (" + str(community_count(s)) + " community)" if community_count(s) else ""}</td></tr>'
        for s in spools
    )
    options = "\n".join(f'                <option value="{median_tare(s)}"{" selected" if i == 0 else ""}>{esc(s["line"])} — {median_tare(s)} g</option>' for i, s in enumerate(spools))
    jsonld = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "Dataset", "name": f"{name} empty spool weights", "description": description, "url": url, "license": "https://creativecommons.org/licenses/by/4.0/", "creator": {"@type": "Organization", "name": "MeshKit", "url": "https://meshkit.pro/"}, "variableMeasured": "Empty spool tare weight (g)"},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "MeshKit", "item": "https://meshkit.pro/"},
                {"@type": "ListItem", "position": 2, "name": "Empty Spool Weight Database", "item": "https://meshkit.pro/empty-spool-weight-database"},
                {"@type": "ListItem", "position": 3, "name": f"{name}", "item": url}]},
        ],
    }
    others = " · ".join(f'<a href="/{o["slug"]}-empty-spool-weight">{esc(o["name"])}</a>' for o in DATA["makers"] if o["slug"] != m["slug"])
    return slug, f"""<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-5HR12TP216"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){{dataLayer.push(arguments);}}
    gtag('js', new Date());
    gtag('config', 'G-5HR12TP216');
  </script>
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(description)}" />
  <link rel="canonical" href="{url}" />
  <link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/fonts/ibm-plex-mono-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta property="og:title" content="{esc(title)}" />
  <meta property="og:description" content="{esc(description)}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://meshkit.pro/og-images/empty-spool-weight-database.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{esc(title)}" />
  <meta name="twitter:description" content="{esc(description)}" />
  <meta name="twitter:image" content="https://meshkit.pro/og-images/empty-spool-weight-database.png" />
  <script type="application/ld+json">
  {json.dumps(jsonld, indent=2, ensure_ascii=False)}
  </script>
</head>
<body data-page="spool-brand" data-maker="{m["slug"]}">

  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/">
        <div class="brand-mark">MK</div>
        <div>
          <span class="mono" style="font-weight:700; font-size:14px;">MESHKIT</span>
          <span class="mono" style="font-size:11px; color:var(--text-faint); margin-left:6px;">CAD &amp; PRINT LEDGER</span>
        </div>
      </a>

{gen.NAV_TABS}

      <button type="button" class="theme-btn" id="themeToggle">
        THEME: PAPER [LIGHT]
      </button>
    </div>
  </header>

  <main class="shell">

    <nav class="sub-nav" aria-label="Spool tools">
      <a href="/empty-spool-weight-database">All brands</a>
      <a href="/{slug}" class="active">{esc(name)}</a>
      <a href="/filament-spool-weight-calculator">Spool Weight Calculator</a>
      <a href="/filament-grams-to-meters">Grams to Meters</a>
    </nav>

    <div class="spec-strip">
      <div>
        <h1 class="spec-title" id="toolTitle">{esc(name)} Empty Spool Weight — Tare in Grams</h1>
      </div>
      <div class="spec-meta mono">
        <span id="toolSpecTag">DATASET: {total_meas} MEASUREMENT(S) · {comm} COMMUNITY</span>
        <span>LAST VERIFIED: {DATA["lastVerified"]}</span>
      </div>
    </div>

    <section class="workbench tool-panel">
      <div class="wb-left">
        <div class="wb-section">
          <div class="section-head">
            <span>A. {esc(name)} Spools on File</span>
            <span class="mono" style="color:var(--status-ok);">{len(spools)} TYPE(S)</span>
          </div>
          <table class="tech-table mono" id="brandSpoolTable">
            <thead>
              <tr><th>Spool / line</th><th>Core</th><th>Empty weight</th><th>Net filament</th><th>Measurements</th></tr>
            </thead>
            <tbody>
{rows}
            </tbody>
          </table>
          <p class="field-hint" style="margin-top:10px;">{esc(m["note"])} Values are medians of the measurements on file; individual spools vary by a few grams, cardboard more with humidity.</p>
        </div>
      </div>

      <div class="wb-right">
        <div class="wb-section">
          <div class="section-head">
            <span>B. How Much Filament Is Left?</span>
            <span class="mono" style="color:var(--accent);">LOCAL</span>
          </div>
          <div class="field-grid">
            <div>
              <label class="field-label" for="bsSpool"><span>Spool type</span><span class="unit-tag">[tare]</span></label>
              <select id="bsSpool">
{options}
              </select>
            </div>
            <div>
              <label class="field-label" for="bsGross"><span>Spool on the scale</span><span class="unit-tag">[g]</span></label>
              <input type="number" id="bsGross" value="650" min="0" step="1" />
            </div>
          </div>
          <div class="kpi-strip" style="margin-top:12px;">
            <div class="kpi-cell"><div class="kpi-label">Filament left</div><div class="kpi-val" id="bsLeft">—</div><div class="kpi-sub">grams</div></div>
            <div class="kpi-cell"><div class="kpi-label">Of a full spool</div><div class="kpi-val" id="bsPct">—</div><div class="kpi-sub" id="bsPctSub">% of net weight</div></div>
            <div class="kpi-cell"><div class="kpi-label">≈ Length (PLA 1.75)</div><div class="kpi-val" id="bsMeters">—</div><div class="kpi-sub">metres</div></div>
          </div>
          <p class="field-hint" style="margin-top:10px;">Length assumes PLA at 1.24 g/cm³ and 1.75 mm. Other materials: <a href="/filament-grams-to-meters">grams to meters</a>.</p>
        </div>
      </div>
    </section>

{submission_form(name, "/" + slug)}

    <article class="seo-content">
      <h2>How Much Does an Empty {esc(name)} Spool Weigh?</h2>
      <p>
        On file: <strong>{lo}–{hi} g</strong> depending on the spool type. {esc(m["note"])} The number you need is the <em>tare</em> — the weight of the bare spool with no filament — because the only practical way to know how much filament is left on a partly used spool is to put it on a kitchen scale and subtract the tare. Manufacturers rarely print it on the label, and it changes when a brand switches from plastic to cardboard cores, so the table above is built from real measurements rather than spec sheets.
      </p>
      <p>
        Every row shows how many measurements it rests on and how many came from the community. A single measurement is a reasonable estimate; three or more from different batches is a reliable one. If your own empty spool reads a few grams off, that is normal production variance — cardboard spools also absorb moisture and can drift by 3–6 g between a dry workshop and a humid garage.
      </p>

      <h2>How to Use the {esc(name)} Tare Weight</h2>
      <ol>
        <li><strong>Weigh the spool as it is</strong>, filament and all, on a scale that reads to 1 g (0.1 g is better but not required).</li>
        <li><strong>Pick the matching spool type</strong> in the calculator above and type the gross weight. Remaining grams and the fraction of a full spool update instantly.</li>
        <li><strong>Compare with your slicer's estimate</strong> for the next print. If the slicer says 180 g and you have 150 g, change spools now rather than at 3 a.m.</li>
      </ol>

      <h2>Worked Example</h2>
      <div class="formula-box">
        Scale reads 612 g &nbsp;·&nbsp; {esc(spools[0]["line"])} tare {median_tare(spools[0])} g &nbsp;⇒&nbsp; {612 - median_tare(spools[0])} g of filament left<br/>
        {612 - median_tare(spools[0])} g ÷ 1000 g = {round((612 - median_tare(spools[0])) / 10)}% of a 1 kg spool<br/>
        PLA 1.75 mm: {612 - median_tare(spools[0])} g ÷ (1.24 g/cm³ × 0.02405 cm³/cm) ≈ {round((612 - median_tare(spools[0])) / (1.24 * 0.02405) / 100)} m
      </div>

      <h2>Why Tare Weights Differ Within One Brand</h2>
      <ul>
        <li><strong>Core material:</strong> cardboard cores run 120–170 g, plastic 180–260 g; many brands ship both depending on line and region.</li>
        <li><strong>Spool size:</strong> 750 g, 1 kg, 2 kg and 3 kg spools use different cores. The net weight column tells you which one a row refers to.</li>
        <li><strong>Revisions:</strong> brands change suppliers without announcing it. When two measurements disagree by more than 10 g, they usually come from different years.</li>
        <li><strong>Hubs and labels:</strong> plastic hubs pressed into cardboard spools, and heavy labels, add 5–15 g.</li>
      </ul>

      <h2>Add Your Measurement</h2>
      <p>
        If you have an empty {esc(name)} spool, weigh it and use the form above. Say which product line it came from and, if you know it, roughly when it was bought. Submissions are reviewed by hand before publishing and credited with the name you give; a row with several independent measurements is worth far more to the next person than any spec sheet. Other brands on file: {others}.
      </p>

      <h2>Frequently Asked Questions</h2>
      <div class="faq-list">
        <details>
          <summary>Which {esc(name)} spool do I have?</summary>
          <p>Look at the core: cardboard is matte brown or printed, plastic is glossy. Then match the net weight on the label (1 kg is most common). If the brand has more than one row for that combination, the product line on the label decides.</p>
        </details>
        <details>
          <summary>My empty spool is heavier than the table says. Is the table wrong?</summary>
          <p>Probably a different batch or a bit of residual filament wound around the core. If you are confident the spool is bare and dry, submit the measurement — the median will move once enough people report the same thing.</p>
        </details>
        <details>
          <summary>Does humidity really change the weight?</summary>
          <p>For cardboard, yes: a few grams between seasons is common. For plastic, no. That is one reason plastic-core tares cluster more tightly in the data.</p>
        </details>
        <details>
          <summary>Where does this data come from?</summary>
          <p>Rows marked "meshkit" were weighed by us; "community" rows are reader submissions reviewed before publishing. Each row shows its count so you can judge how much to trust it. The dataset is CC BY 4.0 — reuse it with a link back.</p>
        </details>
        <details>
          <summary>Is anything tracked when I use the calculator or the form?</summary>
          <p>The calculator runs in your browser. The form sends only the fields you fill in, to a write-only queue that nobody can read from the web; there is no account and no cookie.</p>
        </details>
      </div>
    </article>

    <section class="doc-grid">
      <div>
        <h2 style="font-size:15px; font-weight:700; text-transform:uppercase; letter-spacing:0.02em; margin:0 0 10px;" class="mono">
          Reference // Measuring Properly
        </h2>
        <p style="font-size:13px; color:var(--text-muted); margin:0 0 12px;">
          Unwind the last metre of filament, remove tape and clips, let a cardboard spool sit indoors for a day, then weigh on a scale zeroed with nothing on it. Report the reading to the nearest gram.
        </p>
      </div>
      <div>
        <h2 style="font-size:15px; font-weight:700; text-transform:uppercase; letter-spacing:0.02em; margin:0 0 10px;" class="mono">
          Pipeline // Direct Tool Routing
        </h2>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <a href="/filament-spool-weight-calculator" class="btn-secondary route-link">05 -&gt; FULL SPOOL CALCULATOR (ANY MATERIAL, WILL IT FINISH?)</a>
          <a href="/filament-grams-to-meters" class="btn-secondary route-link">05B -&gt; GRAMS ↔ METERS FOR ANY FILAMENT</a>
          <a href="/empty-spool-weight-database" class="btn-secondary route-link">05C -&gt; ALL BRANDS IN THE DATABASE</a>
        </div>
      </div>
    </section>

    <footer class="site-footer mono">
      <div>MESHKIT // LOCAL BROWSER 3D PRINTING UTILITY SUITE</div>
      <div class="footer-links">
{gen.FOOTER_LINKS}
      </div>
    </footer>

  </main>

  <script type="module" src="/src/main.ts"></script>
</body>
</html>
"""


if __name__ == "__main__":
    refresh_database_page()
    slugs = []
    for m in DATA["makers"]:
        r = brand_page(m)
        if not r:
            continue
        slug, html = r
        (ROOT / f"{slug}.html").write_text(html, encoding="utf-8")
        words = len(re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>", " ", html).split())
        slugs.append(slug)
        print(f"wrote {slug}.html ({words} words)")
    (ROOT / "src/data/spool-pages.json").write_text(json.dumps(slugs, indent=2) + "\n")
