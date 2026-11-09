#!/usr/bin/env python3
"""Generates stl-scale-units-fixer.html and stl-simplifier-online.html."""
from pathlib import Path
import json, re, sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
gen = __import__("gen-converter-pages")

PAGES = [
    {
        "slug": "stl-scale-units-fixer",
        "mode": "scale",
        "title": "STL Scale & Units Fixer Online — Inch to mm, Resize",
        "description": "Fix an STL, 3MF or OBJ that imports 25× too small or lying on its side: convert inches/cm/m to mm, scale by factor, fit to an exact size, Y-up to Z-up, mirror, centre and drop to the bed. Browser-side, no upload.",
        "og_description": "Resize and fix units of STL/3MF/OBJ in your browser: inch→mm, fit to size, Y-up→Z-up, mirror, drop to bed. Zero upload.",
        "h1": "STL Scale &amp; Units Fixer — Inch to mm, Fit to Size, Z-Up, No Upload",
        "spec_tag": "KERNEL: AFFINE TRANSFORM · UNIT GUESS FROM EXTENT",
        "app_name": "MeshKit STL Scale & Units Fixer",
        "breadcrumb": "STL Scale & Units Fixer",
        "options_title": "B. Units, Scale &amp; Orientation",
        "options_html": """            <div>
              <label class="field-label" for="txFromUnit"><span>File is in</span><span class="unit-tag">[source unit]</span></label>
              <select id="txFromUnit">
                <option value="mm" selected>Millimeters</option>
                <option value="cm">Centimeters</option>
                <option value="m">Meters</option>
                <option value="inch">Inches</option>
                <option value="foot">Feet</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="txToUnit"><span>Write as</span><span class="unit-tag">[target unit]</span></label>
              <select id="txToUnit">
                <option value="mm" selected>Millimeters (slicers)</option>
                <option value="inch">Inches</option>
                <option value="cm">Centimeters</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="txFactor"><span>Extra factor</span><span class="unit-tag">[×]</span></label>
              <input type="number" id="txFactor" value="1" step="0.01" min="0.0001" />
            </div>
            <div>
              <label class="field-label" for="txFitAxis"><span>Fit to size</span><span class="unit-tag">[axis]</span></label>
              <select id="txFitAxis">
                <option value="none" selected>Off</option>
                <option value="x">X extent</option>
                <option value="y">Y extent</option>
                <option value="z">Z extent (height)</option>
                <option value="max">Largest extent</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="txFitSize"><span>Target size</span><span class="unit-tag">[target unit]</span></label>
              <input type="number" id="txFitSize" value="" placeholder="e.g. 100" step="0.1" min="0" />
            </div>
            <div>
              <label class="field-label" for="txUpAxis"><span>Up axis in file</span><span class="unit-tag">[orientation]</span></label>
              <select id="txUpAxis">
                <option value="z" selected>Z up (keep)</option>
                <option value="y">Y up → rotate to Z up</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="txMirror"><span>Mirror</span><span class="unit-tag">[plane]</span></label>
              <select id="txMirror">
                <option value="none" selected>None</option>
                <option value="x">Across X</option>
                <option value="y">Across Y</option>
                <option value="z">Across Z</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="txAxisX"><span>Per-axis ×X</span><span class="unit-tag">[stretch]</span></label>
              <input type="number" id="txAxisX" value="1" step="0.01" />
            </div>
            <div>
              <label class="field-label" for="txAxisY"><span>Per-axis ×Y</span><span class="unit-tag">[stretch]</span></label>
              <input type="number" id="txAxisY" value="1" step="0.01" />
            </div>
            <div>
              <label class="field-label" for="txAxisZ"><span>Per-axis ×Z</span><span class="unit-tag">[stretch]</span></label>
              <input type="number" id="txAxisZ" value="1" step="0.01" />
            </div>
            <div>
              <label class="field-label" for="txCenter"><span>Centre on origin (XY)</span><span class="unit-tag">[placement]</span></label>
              <input type="checkbox" id="txCenter" />
            </div>
            <div>
              <label class="field-label" for="txDrop"><span>Drop to bed (Z = 0)</span><span class="unit-tag">[placement]</span></label>
              <input type="checkbox" id="txDrop" checked />
            </div>""",
        "guess_html": '<p id="txGuess" class="mono" style="font-size:12px; color:var(--text-muted); margin:10px 0 0;">Guess: load a file to detect its likely unit.</p>',
        "kpi": [("Dimensions", "txKpiASub", "after, in target unit"), ("Triangles", "txKpiBSub", "unchanged"), ("Output Size", "txKpiCSub", "binary STL"), ("Mesh Health", "txKpiDSub", "volume · orientation")],
        "export_btn": "EXPORT SCALED .STL",
        "log_title": "// SCALE & UNITS LOG",
        "related": [("/stl-viewer-online", "09 -&gt; CHECK SIZE &amp; ORIENTATION IN THE VIEWER"), ("/stl-repair-online", "02 -&gt; REPAIR OPEN EDGES &amp; FLIPPED FACES"), ("/stl-volume-weight-calculator", "02B -&gt; WEIGHT &amp; COST FROM THE NEW VOLUME")],
        "reference_title": "Reference // The 25.4 Problem",
        "reference_text": "STL stores bare numbers. Slicers assume millimetres. A model authored in inches imports at 1/25.4 of its size; one authored in metres (Blender's default) at 1/1000. The fixer reads the largest extent and guesses the unit, then rewrites the numbers so the slicer sees what the designer meant.",
        "seo": """      <h2>What the STL Scale &amp; Units Fixer Does</h2>
      <p>
        The most common "broken" STL is not broken at all — it is in the wrong unit. STL, OBJ and some 3MF exports carry no unit information, slicers assume millimetres, and a part designed in inches imports at 1/25.4 of its size (a 4-inch bracket becomes a 4 mm one). Blender exports metres by default, so a 60 mm part arrives as 0.06 units and looks empty. The second most common problem is orientation: Y-up exports from Blender, Maya and glTF pipelines land on their side. This tool fixes both, plus the long tail: exact fit-to-size, uniform or per-axis scaling, mirroring for left/right-hand parts, centring and dropping to the bed.
      </p>
      <p>
        It opens <code>.stl</code> (binary or ASCII), <code>.3mf</code> and <code>.obj</code>, guesses the authoring unit from the largest extent and pre-selects it when confident, applies your choices, audits the result (watertightness, volume, orientation) and exports a binary STL in millimetres or the unit you pick. Everything runs in a Web Worker in your browser; nothing is uploaded.
      </p>

      <h2>How to Fix Units in 3 Steps</h2>
      <ol>
        <li><strong>Drop the file.</strong> The log shows the bounding box and a unit guess with its reasoning (for example "largest extent 2.36 — plausible as inches, 60 mm").</li>
        <li><strong>Confirm or override.</strong> Set <em>File is in</em> to the unit the designer used; leave <em>Write as</em> on millimetres for any slicer. Use <strong>Fit to size</strong> when you know the real-world dimension ("this should be 100 mm tall"), which overrides guessing entirely.</li>
        <li><strong>Orient and place.</strong> Choose <strong>Y up → Z up</strong> for Blender/Maya exports, tick <strong>Drop to bed</strong> so Z starts at 0, optionally <strong>Centre</strong> on the origin, then <strong>Export scaled .STL</strong>.</li>
      </ol>

      <h2>Worked Example: Blender Export</h2>
      <div class="formula-box">
        Blender default export: metres, Y up &nbsp;→&nbsp; a 60 mm vase arrives as 0.06 units, lying on its side<br/>
        File is in: Meters (×1000) &nbsp;·&nbsp; Up axis: Y up → Z up &nbsp;·&nbsp; Drop to bed &nbsp;⇒&nbsp; 48 × 48 × 64 mm, standing, Z min = 0<br/>
        Inch-authored bracket 4.000 × 1.250 × 0.375 &nbsp;→&nbsp; ×25.4 &nbsp;⇒&nbsp; 101.60 × 31.75 × 9.53 mm<br/>
        Fit Z to 100 mm on a 64 mm model &nbsp;⇒&nbsp; uniform ×1.5625; volume scales by 1.5625³ = 3.81×
      </div>
      <p>
        Mirroring and negative per-axis factors invert the mesh; the tool flips triangle winding automatically so normals stay outward and the volume stays positive. Per-axis stretching changes proportions deliberately — use it for calibration compensation (a known 0.4% shrink in X, for instance), not for unit fixing.
      </p>

      <h2>When to Use This Instead of the Slicer</h2>
      <ul>
        <li><strong>Sharing the file:</strong> fixing units in your slicer fixes it only on your machine; the downloaded STL stays wrong for everyone else.</li>
        <li><strong>Print services and quote tools</strong> read the file as-is; an inch-authored part gets quoted at 1/16,387th of its real volume.</li>
        <li><strong>Batch consistency:</strong> set the correct numbers once, then every slicer, viewer and marketplace agrees.</li>
        <li><strong>Exact target sizes:</strong> "make this 120 mm wide" is one field here; slicer scale dialogs often round or lock aspect ratios awkwardly.</li>
      </ul>

      <h2>Technical Limitations</h2>
      <p>
        The unit guess is a heuristic based on the assumption that the model is a printable part between roughly 5 mm and 500 mm; sculptures and miniatures can fool it, which is why it only pre-selects at high confidence and always shows its reasoning. 3MF unit attributes are honoured on load, so a correctly tagged 3MF is already in millimetres before your settings apply. Output is STL only; use <a href="/stl-to-3mf-converter">STL to 3MF</a> afterwards if you need a unit-tagged package.
      </p>

      <h2>Frequently Asked Questions</h2>
      <div class="faq-list">
        <details>
          <summary>How do I know if my STL is in inches?</summary>
          <p>Open it here and read the bounding box. If a part you expect to be ~100 mm shows as ~4, it is in inches; if it shows as ~0.1, it is in metres. The log states the guess and why. When in doubt, use <strong>Fit to size</strong> with a dimension you know.</p>
        </details>
        <details>
          <summary>Does scaling change wall thickness?</summary>
          <p>Yes — uniform scaling scales everything, including walls, holes and clearances. A model scaled ×0.5 has half-thickness walls and half-size screw holes. Check minimum features after large changes.</p>
        </details>
        <details>
          <summary>Will mirroring break my mesh?</summary>
          <p>No. Mirroring reverses triangle winding; the tool flips it back so every face still points outward. The mesh-health cell confirms "normals outward" and a positive volume.</p>
        </details>
        <details>
          <summary>Why is "Drop to bed" on by default?</summary>
          <p>Most slicers place the model on the bed anyway, but viewers, quote tools and marketplace previews do not. A Z-min of 0 is the convention everything agrees on, and it costs nothing.</p>
        </details>
        <details>
          <summary>Is my file uploaded?</summary>
          <p>No. Parsing, transformation and export run in a Web Worker in your browser. The exported STL is generated from memory as a download.</p>
        </details>
      </div>""",
    },
    {
        "slug": "stl-simplifier-online",
        "mode": "simplify",
        "title": "Reduce STL File Size Online — Mesh Simplifier",
        "description": "Simplify STL, 3MF or OBJ meshes in your browser with quadric edge-collapse decimation: cut triangle count and file size 2–20× while keeping shape, volume and watertightness. Nothing is uploaded.",
        "og_description": "Browser-side mesh decimation: reduce STL triangles and file size 2–20× with quadric edge collapse. Watertight, zero upload.",
        "h1": "Reduce STL File Size — Online Mesh Simplifier, No Upload",
        "spec_tag": "KERNEL: QUADRIC EDGE COLLAPSE (GARLAND–HECKBERT) · FLIP GUARD",
        "app_name": "MeshKit Mesh Simplifier",
        "breadcrumb": "STL Simplifier",
        "options_title": "B. Reduction Target",
        "options_html": """            <div>
              <label class="field-label" for="txRatio"><span>Keep</span><span class="unit-tag" id="txRatioOut">50%</span></label>
              <input type="range" id="txRatio" min="2" max="100" value="50" step="1" />
            </div>
            <div>
              <label class="field-label" for="txTarget"><span>…or exact triangle count</span><span class="unit-tag">[overrides %]</span></label>
              <input type="number" id="txTarget" value="" placeholder="e.g. 20000" min="4" step="100" />
            </div>
            <div>
              <label class="field-label" for="txBoundary"><span>Boundary stiffness</span><span class="unit-tag">[open edges]</span></label>
              <input type="number" id="txBoundary" value="100" min="0" max="10000" step="10" />
            </div>
            <div>
              <label class="field-label" for="txPreventFlips"><span>Prevent face flips</span><span class="unit-tag">[recommended]</span></label>
              <input type="checkbox" id="txPreventFlips" checked />
            </div>""",
        "guess_html": "",
        "kpi": [("Dimensions", "txKpiASub", "unchanged"), ("Triangles", "txKpiBSub", "after reduction"), ("Output Size", "txKpiCSub", "binary STL"), ("Mesh Health", "txKpiDSub", "volume · orientation")],
        "export_btn": "EXPORT SIMPLIFIED .STL",
        "log_title": "// SIMPLIFIER LOG",
        "related": [("/stl-viewer-online", "09 -&gt; COMPARE BEFORE / AFTER IN THE VIEWER (WIREFRAME)"), ("/stl-repair-online", "02 -&gt; REPAIR FIRST IF THE INPUT HAS HOLES"), ("/stl-to-3mf-converter", "07 -&gt; PACKAGE AS 3MF FOR A FURTHER 3–5× SAVING")],
        "reference_title": "Reference // Why Scans Are Huge",
        "reference_text": "Photogrammetry and sculpting tools emit uniform triangles everywhere — a flat face gets as many as a curved edge. Decimation collapses the edges that change the surface least first, so flat and gently curved areas lose most of their triangles while edges, holes and fine detail keep theirs.",
        "seo": """      <h2>What the Mesh Simplifier Does</h2>
      <p>
        A 3D scan, a ZBrush sculpt or a CAD export at "very fine" tolerance easily produces a million triangles and a 50 MB STL that chokes slicers, upload forms and email. Most of those triangles describe flat or gently curved regions that a few hundred could represent just as well. This tool runs quadric edge-collapse decimation — the same algorithm as MeshLab's <em>Quadric Edge Collapse Decimation</em> and Blender's <em>Decimate › Collapse</em> — in your browser: it welds the mesh, scores every edge by how much collapsing it would move the surface, and removes the cheapest edges first until your target is reached. Open edges are pinned so holes and rims stay where they are, and a flip guard rejects collapses that would turn a face inside out.
      </p>
      <p>
        Typical results: a 1,000,000-triangle scan to 100,000 (10× smaller file) with no visible change at print resolution; a CAD export halved with zero change to flat faces. The audit shows triangles, file size, volume change and whether the mesh is still watertight, so you can see exactly what you traded. STL, 3MF and OBJ are accepted; the output is binary STL. Nothing is uploaded.
      </p>

      <h2>How to Reduce an STL in 3 Steps</h2>
      <ol>
        <li><strong>Drop the mesh.</strong> It loads at 50% reduction immediately so you can see the effect; the log reports the welded vertex count and any open edges.</li>
        <li><strong>Set the target.</strong> Use the <strong>Keep %</strong> slider or type an <strong>exact triangle count</strong> (most slicers are happy below 500k; marketplace uploads often want under 50 MB; Frame-TV/web previews under 50k). Watch the volume change in the log — under 0.5% is invisible on a print.</li>
        <li><strong>Export.</strong> Check the mesh-health cell says watertight (if the input was), then <strong>Export simplified .STL</strong>. For an even smaller file, package the result as <a href="/stl-to-3mf-converter">3MF</a>.</li>
      </ol>

      <h2>Worked Example: What the Numbers Mean</h2>
      <div class="formula-box">
        Binary STL size = 84 + 50 × N bytes &nbsp;→&nbsp; 1,000,000 facets = 50 MB; 100,000 facets = 5 MB<br/>
        Quadric error = squared distance of the new vertex from the planes of its original faces (model units²)<br/>
        Sample sphere, 6,240 → 1,248 facets (20%): volume −0.4%, still watertight, max error 0.012 mm<br/>
        20 mm cube at 50%: refused with an error cap — every cube collapse removes a corner, so there is nothing cheap to remove
      </div>
      <p>
        Decimation is lossy by design. The log's "max accepted error" is the furthest any surviving vertex moved from the original surface; keep it under your nozzle width (0.4 mm) and the print cannot tell the difference. Sharp edges survive because collapsing across them is expensive; dense, flat regions go first.
      </p>

      <h2>When to Simplify</h2>
      <ul>
        <li><strong>Scans and sculpts</strong> before slicing — slicer performance scales with triangle count, not print quality.</li>
        <li><strong>Marketplace uploads</strong> with size limits (Printables, Thingiverse, MakerWorld, Etsy digital files).</li>
        <li><strong>Web and Frame-TV previews</strong> where a 20k-triangle mesh renders instantly and a 2M one does not.</li>
        <li><strong>Emailing or messaging</strong> a model to a client or a print service.</li>
      </ul>

      <h2>Technical Limitations</h2>
      <p>
        The simplifier preserves topology: it will not fill holes or merge separate shells (use <a href="/stl-repair-online">STL Repair</a> first for that). Very aggressive targets on thin-walled parts can pinch walls; the flip guard prevents inverted faces but not thinning. Textures, colours and per-face attributes are not carried over. Extremely large inputs are limited by browser memory — roughly 2–3 million triangles on a typical laptop.
      </p>

      <h2>Frequently Asked Questions</h2>
      <div class="faq-list">
        <details>
          <summary>Will simplifying change how the print looks?</summary>
          <p>Not if the max accepted error stays below your layer height / nozzle width. The log reports it; typical 5–10× reductions on scans land around 0.01–0.05 mm, far below what an FDM printer can resolve.</p>
        </details>
        <details>
          <summary>Why did it stop above my target?</summary>
          <p>Every remaining collapse would flip a face (the guard refuses them) or the mesh is already at its minimum sensible complexity — a cube cannot go below 12 triangles. Untick "Prevent face flips" only if you accept possible artefacts.</p>
        </details>
        <details>
          <summary>What does "boundary stiffness" do?</summary>
          <p>Open edges (holes, rims, cut faces) get an extra penalty so they keep their shape. Raise it if a rim is drifting; lower it (or 0) if you want open edges simplified as aggressively as the interior.</p>
        </details>
        <details>
          <summary>Is this the same as "Decimate" in Blender?</summary>
          <p>Same family of algorithm (quadric edge collapse with boundary preservation). Results are comparable; this one runs in a browser tab without installing anything, and reports watertightness and volume change directly.</p>
        </details>
        <details>
          <summary>Is my file uploaded?</summary>
          <p>No. Welding, scoring and collapsing run in a Web Worker in your browser; the result is written to a binary STL and offered as a download.</p>
        </details>
      </div>""",
    },
]


def render(p):
    url = f"https://meshkit.pro/{p['slug']}"
    jsonld = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "WebApplication", "name": p["app_name"], "url": url, "applicationCategory": "UtilitiesApplication", "operatingSystem": "Any", "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "MeshKit", "item": "https://meshkit.pro/"},
                {"@type": "ListItem", "position": 2, "name": p["breadcrumb"], "item": url}]},
        ],
    }
    kpis = "\n".join(
        f"""          <div class="kpi-cell">
            <div class="kpi-label">{label}</div>
            <div class="kpi-val" id="{['txKpiA','txKpiB','txKpiC','txKpiD'][i]}"{' style="font-size:17px;"' if i in (0,3) else ''}>—</div>
            <div class="kpi-sub" id="{sub_id}">{sub}</div>
          </div>"""
        for i, (label, sub_id, sub) in enumerate(p["kpi"])
    )
    related = "\n".join(f'          <a href="{h}" class="btn-secondary route-link">{t}</a>' for h, t in p["related"])
    sample_label = "LOAD SAMPLE .OBJ" if p["mode"] == "scale" else "LOAD SAMPLE .3MF"
    return f"""<!DOCTYPE html>
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
  <title>{p['title']}</title>
  <meta name="description" content="{p['description']}" />
  <link rel="canonical" href="{url}" />
  <link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/fonts/ibm-plex-mono-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta property="og:title" content="{p['title']}" />
  <meta property="og:description" content="{p['og_description']}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://meshkit.pro/og-images/{p['slug']}.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{p['title']}" />
  <meta name="twitter:description" content="{p['og_description']}" />
  <meta name="twitter:image" content="https://meshkit.pro/og-images/{p['slug']}.png" />
  <script type="application/ld+json">
  {json.dumps(jsonld, indent=2, ensure_ascii=False)}
  </script>
</head>
<body data-page="transform" data-transform="{p['mode']}">

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

    <nav class="sub-nav" aria-label="Mesh tools">
      <a href="/stl-scale-units-fixer"{' class="active"' if p['mode']=='scale' else ''}>Scale &amp; Units</a>
      <a href="/stl-simplifier-online"{' class="active"' if p['mode']=='simplify' else ''}>Simplifier</a>
      <a href="/stl-viewer-online">STL Viewer</a>
      <a href="/stl-repair-online">STL Repair</a>
      <a href="/3mf-to-stl-converter">3MF to STL</a>
    </nav>

    <div class="spec-strip">
      <div>
        <h1 class="spec-title" id="toolTitle">{p['h1']}</h1>
      </div>
      <div class="spec-meta mono">
        <span id="toolSpecTag">{p['spec_tag']}</span>
        <span>EXECUTION: LOCAL BROWSER BUFFER (0 BYTES UPLOADED)</span>
      </div>
    </div>

    <section id="panel-transform" class="workbench tool-panel">
      <div class="wb-left">
        <div class="wb-section">
          <div class="section-head">
            <span>A. Mesh Input (.STL / .3MF / .OBJ)</span>
            <span id="txParseState" style="color:var(--status-ok);">READY</span>
          </div>
          <div class="drop-area" id="txDropzone" aria-label="Upload mesh file">
            <label for="txFileInput" class="hidden">Upload mesh file</label>
            <input type="file" id="txFileInput" accept=".stl,.3mf,.obj" class="hidden" />
            <div class="mono" style="font-weight:600; font-size:12px;" id="txFileName">[CLICK TO SELECT A MESH] OR DRAG .STL / .3MF / .OBJ HERE</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">Parsed and transformed in a Web Worker; exported as binary STL.</div>
            <div class="btn-row">
              <button type="button" id="txBrowseBtn" class="btn-primary">BROWSE MESH...</button>
              <button type="button" id="txSampleBtn" class="btn-secondary">{sample_label}</button>
            </div>
            <div id="txProgressBarWrap" class="progress-bar-wrap hidden" aria-label="Progress">
              <div id="txProgressBarFill" class="progress-bar-fill"></div>
            </div>
          </div>
          {p['guess_html']}
        </div>

        <div class="wb-section">
          <div class="section-head">
            <span>{p['options_title']}</span>
            <span style="color:var(--accent);">LIVE</span>
          </div>
          <div class="field-grid">
{p['options_html']}
          </div>
        </div>
      </div>

      <div class="wb-right">
        <div class="wb-section mono" id="txLogBox" style="background:var(--bg-canvas); color:#D4D3CD; font-size:12px; min-height:180px;">
          <div style="color:#FF5C1A; margin-bottom:8px;">{p['log_title']}</div>
          <div>Awaiting mesh selection...</div>
        </div>

        <div class="kpi-strip">
{kpis}
        </div>

        <div class="quote-bar">
          <span class="mono" style="font-size:12px; color:var(--text-muted);" id="txExportStatus">Load a mesh to begin.</span>
          <button type="button" id="txDownloadBtn" class="btn-primary">{p['export_btn']}</button>
        </div>
      </div>
    </section>

    <article class="seo-content">
{p['seo']}
    </article>

    <section class="doc-grid">
      <div>
        <h2 style="font-size:15px; font-weight:700; text-transform:uppercase; letter-spacing:0.02em; margin:0 0 10px;" class="mono">
          {p['reference_title']}
        </h2>
        <p style="font-size:13px; color:var(--text-muted); margin:0 0 12px;">
          {p['reference_text']}
        </p>
      </div>
      <div>
        <h2 style="font-size:15px; font-weight:700; text-transform:uppercase; letter-spacing:0.02em; margin:0 0 10px;" class="mono">
          Pipeline // Direct Tool Routing
        </h2>
        <div style="display:flex; flex-direction:column; gap:6px;">
{related}
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
    for p in PAGES:
        html = render(p)
        (ROOT / f"{p['slug']}.html").write_text(html, encoding="utf-8")
        words = len(re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>", " ", html).split())
        print(f"wrote {p['slug']}.html (title {len(p['title'])} chars, {words} words)")
