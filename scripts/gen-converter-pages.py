#!/usr/bin/env python3
"""Generates the three converter pages for MeshKit from one template.

Run from the repo root:  python3 scripts/gen-converter-pages.py
Pages are committed; this script exists so copy edits stay consistent.
"""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

NAV_TABS = """      <nav class="nav-tabs" aria-label="Main tools">
        <a href="/" class="tab-btn">01 G-CODE COST</a>
        <a href="/stl-repair-online" class="tab-btn">02 STL REPAIR</a>
        <a href="/step-to-stl-converter" class="tab-btn">03 STEP TO STL</a>
        <a href="/resin-3d-print-cost-calculator" class="tab-btn">04 SLA RESIN</a>
        <a href="/filament-spool-weight-calculator" class="tab-btn">05 SPOOL WEIGHT</a>
      </nav>"""

FOOTER_LINKS = """        <a href="/">G-Code Cost</a>
        <a href="/3d-print-cost-calculator">Manual Cost</a>
        <a href="/stl-repair-online">STL Repair</a>
        <a href="/stl-volume-weight-calculator">STL Weight</a>
        <a href="/step-to-stl-converter">STEP to STL</a>
        <a href="/3mf-to-stl-converter">3MF to STL</a>
        <a href="/stl-to-3mf-converter">STL to 3MF</a>
        <a href="/stl-ascii-to-binary-converter">STL ASCII/Binary</a>
        <a href="/obj-to-stl-converter">OBJ to STL</a>
        <a href="/stl-viewer-online">STL Viewer</a>
        <a href="/stl-scale-units-fixer">Scale &amp; Units</a>
        <a href="/stl-simplifier-online">Simplifier</a>
        <a href="/embed">Embed Calculator</a>
        <a href="/resin-3d-print-cost-calculator">SLA Resin</a>
        <a href="/filament-spool-weight-calculator">Spool Weight</a>
        <a href="/empty-spool-weight-database">Spool Tare DB</a>
        <a href="/filament-grams-to-meters">Grams to Meters</a>
        <a href="/about">About</a>
        <a href="/methodology">Methodology</a>
        <a href="/privacy">Privacy</a>"""

PAGES = [
    {
        "slug": "3mf-to-stl-converter",
        "action": "3mf-to-stl",
        "title": "Convert 3MF to STL Online — Free, No Upload",
        "description": "Convert .3mf files to binary or ASCII STL in your browser. Reads Bambu Studio, Orca, PrusaSlicer and Cura 3MF projects, applies plate transforms and units, exports a watertight STL. Nothing is uploaded.",
        "og_description": "Free browser-based 3MF to STL converter. Handles slicer project files, component transforms and units; exports binary or ASCII STL with zero upload.",
        "h1": "Convert 3MF to STL Online — Browser-Side, No Upload",
        "spec_tag": "KERNEL: OPC ZIP + 3MF CORE / PRODUCTION PARSER",
        "app_name": "MeshKit 3MF to STL Converter",
        "breadcrumb": "3MF to STL Converter",
        "input_label": "A. 3MF Package Input (.3MF)",
        "accept": ".3mf",
        "drop_text": "[CLICK TO SELECT .3MF] OR DRAG PACKAGE HERE",
        "drop_sub": "Unzips the OPC package and reads 3D/3dmodel.model locally in browser memory.",
        "browse": "BROWSE .3MF...",
        "sample": "LOAD SAMPLE .3MF",
        "get_sample": "⬇ GET TEST .3MF",
        "aria_upload": "Upload 3MF file",
        "options_title": "B. STL Output Encoding",
        "options_html": """            <div>
              <label class="field-label" for="cvFormatSelect"><span>STL Format</span><span class="unit-tag">[encoding]</span></label>
              <select id="cvFormatSelect">
                <option value="binary" selected>Binary STL (Compact)</option>
                <option value="ascii">ASCII STL (Text)</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="cvUnitsNote"><span>Units</span><span class="unit-tag">[mm]</span></label>
              <input type="text" id="cvUnitsNote" value="Auto: 3MF unit attribute → mm" readonly />
            </div>""",
        "log_title": "// 3MF → STL CONVERTER LOG",
        "log_wait": "Awaiting .3MF package selection...",
        "kpi": [("Bounding Box", "X / Y / Z extents, mm"), ("Output Facets", "Triangles"), ("Output Size", "Binary STL"), ("Objects Merged", "mesh object(s)")],
        "export_status": "Select a .3MF package to convert and export.",
        "export_btn": "EXPORT .STL",
        "related": [
            ("/stl-repair-online", "02 -&gt; AUDIT &amp; REPAIR THE EXPORTED STL"),
            ("/stl-to-3mf-converter", "07 -&gt; GO THE OTHER WAY: STL TO 3MF"),
            ("/stl-volume-weight-calculator", "02B -&gt; CALCULATE STL VOLUME &amp; PART WEIGHT"),
        ],
        "reference_title": "Reference // 3MF Package Anatomy",
        "reference_text": "A .3mf file is a ZIP. <code>_rels/.rels</code> points at the model part (normally <code>3D/3dmodel.model</code>), which lists mesh objects, component assemblies with 3×4 transforms, and the build items actually placed on the plate. Slicer projects add <code>Metadata/</code> and per-object parts under <code>3D/Objects/</code>.",
        "seo": """      <h2>What the Online 3MF to STL Converter Does</h2>
      <p>
        3MF (3D Manufacturing Format, ISO/ASTM 52915) is the project format written by Bambu Studio, OrcaSlicer, PrusaSlicer, Cura and Windows 3D Builder. It is a ZIP package holding an XML model part plus optional thumbnails, print settings and plate layout. Most CAD tools, mesh repair utilities, online print services and older slicers still want a plain <code>.stl</code>. This converter opens the package in your browser, resolves every object placed on the build plate, applies the component and build-item transforms, converts the declared unit (millimeter, inch, micron, centimeter, foot or meter) to millimetres, and writes a single STL.
      </p>
      <p>
        It understands the 3MF Core specification and the Production extension used by slicer project files, where each model lives in its own part under <code>3D/Objects/</code> and is referenced through <code>p:path</code>. Support and surface objects are skipped so only printable geometry reaches the STL. The result is audited for open edges before download, and the file never leaves your machine — there is no upload, no queue and no size cap beyond your browser's memory (100 MB package limit).
      </p>

      <h2>How to Convert 3MF to STL in 3 Steps</h2>
      <ol>
        <li><strong>Drop your <code>.3mf</code> file:</strong> Click the upload area or drag a 3MF package from Bambu Studio, OrcaSlicer, PrusaSlicer, Cura, Fusion or Windows 3D Builder. The ZIP is unpacked in browser memory.</li>
        <li><strong>Pick the STL encoding:</strong> <strong>Binary STL</strong> is the default and what every slicer and print service expects. Choose <strong>ASCII STL</strong> only if a downstream tool specifically requires text.</li>
        <li><strong>Review and export:</strong> Check the bounding box, triangle count, number of merged objects and output size in the log, then click <strong>Export .STL</strong>. Multi-object plates are merged into one mesh with their plate positions preserved.</li>
      </ol>

      <h2>Worked Example: Plate Transforms and Units</h2>
      <p>
        A 3MF component or build item carries a 3×4 affine matrix written row-major as twelve numbers. Each vertex is transformed as a row vector, then scaled by the model unit:
      </p>
      <div class="formula-box">
        transform="m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32"<br/>
        x' = x·m00 + y·m10 + z·m20 + m30 &nbsp;(likewise y', z')<br/>
        Sample package: 20 mm cube at (−10, −10, 0) + Ø12 × 8 mm boss offset (10, 10, 20) → one STL, 204 facets, 8.90 cm³<br/>
        unit="inch" ⇒ every coordinate × 25.4 before writing STL
      </div>
      <p>
        If a transform mirrors the part (negative determinant), triangle winding is flipped so the STL keeps outward normals and a positive signed volume. Open <a href="/stl-volume-weight-calculator">STL Volume &amp; Weight</a> on the result to confirm.
      </p>

      <h2>Why Convert 3MF to STL?</h2>
      <ul>
        <li><strong>Sharing on Printables, Thingiverse or MakerWorld:</strong> STL remains the universal download format and the one most viewers render.</li>
        <li><strong>Mesh editing:</strong> Meshmixer, Blender importers and many CAD "insert mesh" dialogs accept STL but not slicer-specific 3MF projects.</li>
        <li><strong>Print services and older firmware tools:</strong> Quote engines and legacy slicers (Simplify3D 4, older Cura builds) still expect STL.</li>
        <li><strong>Stripping slicer metadata:</strong> A project 3MF carries your printer profile, filament settings and thumbnails; the STL contains geometry only.</li>
      </ul>

      <h2>Technical Limitations</h2>
      <p>
        Colour, material and texture information (the 3MF Materials extension), beam lattices, slice-stack extensions and per-object print settings are not representable in STL and are discarded. Multiple build items become a single merged mesh; if you need one STL per object, open the project in your slicer and export each object separately. Encrypted (Secure Content) 3MF packages are not supported.
      </p>

      <h2>Frequently Asked Questions</h2>
      <div class="faq-list">
        <details>
          <summary>Is my 3MF file uploaded anywhere?</summary>
          <p>No. The ZIP is unpacked and the XML parsed in a Web Worker inside your browser. The only network request the page makes is for the sample file if you click "Load sample".</p>
        </details>
        <details>
          <summary>Does it work with Bambu Studio and OrcaSlicer project files?</summary>
          <p>Yes. Those projects keep the plate in <code>3D/3dmodel.model</code> and each part under <code>3D/Objects/object_N.model</code>, referenced through the Production extension's <code>p:path</code>. The converter follows those references, applies the plate transforms and skips support/modifier objects.</p>
        </details>
        <details>
          <summary>My plate had three parts — why do I get one STL?</summary>
          <p>STL has no concept of separate objects, so everything on the plate is merged into one mesh with positions preserved. The "Objects merged" counter tells you how many meshes went in. For per-part files, export each object from your slicer.</p>
        </details>
        <details>
          <summary>Why does the STL come out at a different size than I expected?</summary>
          <p>3MF files declare a unit; the converter scales to millimetres, which is what slicers assume for STL. A model authored in inches is multiplied by 25.4. If the bounding box in the log looks 25× too big or too small, the source file's unit attribute is wrong — fix it in the source or scale in the slicer.</p>
        </details>
        <details>
          <summary>Binary or ASCII STL?</summary>
          <p>Binary. It is exactly 84 + 50 × N bytes, loads faster, and is what every slicer expects. ASCII STL is 4–6× larger and only useful when a tool requires readable text.</p>
        </details>
      </div>""",
    },
    {
        "slug": "stl-to-3mf-converter",
        "action": "stl-to-3mf",
        "title": "Convert STL to 3MF Online — Free, No Upload",
        "description": "Convert STL to 3MF in your browser: welds vertices, writes a spec-conformant 3D/3dmodel.model package with millimeter or inch units, ready for Bambu Studio, PrusaSlicer, Cura and Windows 3D Builder. No upload.",
        "og_description": "Free browser-based STL to 3MF converter. Welded, compressed, spec-conformant 3MF packages with unit metadata — zero upload.",
        "h1": "Convert STL to 3MF Online — Welded, Compressed, No Upload",
        "spec_tag": "KERNEL: STL PARSER + 3MF CORE WRITER (OPC ZIP)",
        "app_name": "MeshKit STL to 3MF Converter",
        "breadcrumb": "STL to 3MF Converter",
        "input_label": "A. Mesh Input (.STL, binary or ASCII)",
        "accept": ".stl",
        "drop_text": "[CLICK TO SELECT .STL] OR DRAG MESH HERE",
        "drop_sub": "Detects binary vs ASCII STL and welds shared vertices locally in browser memory.",
        "browse": "BROWSE .STL...",
        "sample": "LOAD SAMPLE .STL",
        "get_sample": "⬇ GET TEST .STL",
        "aria_upload": "Upload STL file",
        "options_title": "B. 3MF Unit &amp; Object Name",
        "options_html": """            <div>
              <label class="field-label" for="cvUnitSelect"><span>Model Unit</span><span class="unit-tag">[unit attr]</span></label>
              <select id="cvUnitSelect">
                <option value="millimeter" selected>Millimeter (coordinates as-is)</option>
                <option value="inch">Inch (coordinates as-is, tagged inch)</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="cvObjectName"><span>Object Name</span><span class="unit-tag">[metadata]</span></label>
              <input type="text" id="cvObjectName" value="" placeholder="Defaults to the file name" maxlength="120" />
            </div>""",
        "log_title": "// STL → 3MF PACKAGER LOG",
        "log_wait": "Awaiting .STL file selection...",
        "kpi": [("Bounding Box", "X / Y / Z extents, mm"), ("Triangles", "after dropping degenerates"), ("Output Size", "Deflated 3MF"), ("Unique Vertices", "welded")],
        "export_status": "Select an .STL file to package as 3MF.",
        "export_btn": "EXPORT .3MF",
        "related": [
            ("/stl-repair-online", "02 -&gt; REPAIR OPEN EDGES BEFORE PACKAGING"),
            ("/3mf-to-stl-converter", "06 -&gt; GO THE OTHER WAY: 3MF TO STL"),
            ("/stl-ascii-to-binary-converter", "08 -&gt; STL ASCII ↔ BINARY RE-ENCODER"),
        ],
        "reference_title": "Reference // Why 3MF Is Smaller",
        "reference_text": "STL stores every triangle's three corners independently, so a shared vertex is written up to six times. 3MF stores a vertex list once and indexes it, then the whole package is DEFLATE-compressed. Typical result: 3–5× smaller than binary STL with identical geometry.",
        "seo": """      <h2>What the Online STL to 3MF Converter Does</h2>
      <p>
        STL is a 1987 format: a bag of triangles with no units, no object name and no way to say which way is up. 3MF (ISO/ASTM 52915) fixes all of that and is now the native format of Bambu Studio, OrcaSlicer, PrusaSlicer, Cura, Windows 3D Builder and Microsoft 3D Print. This converter reads a binary or ASCII <code>.stl</code>, welds coincident vertices into an indexed mesh, drops zero-area triangles, and writes a minimal, spec-conformant 3MF package — <code>[Content_Types].xml</code>, <code>_rels/.rels</code> and <code>3D/3dmodel.model</code> — compressed with DEFLATE.
      </p>
      <p>
        You choose the unit attribute (<code>millimeter</code> or <code>inch</code>) and an object name that will show up in your slicer's object list. Coordinates are written exactly as they appear in the STL; the unit tag tells the slicer how to interpret them. The mesh is audited for open edges so you know whether to run <a href="/stl-repair-online">STL Repair</a> first. Everything runs in a Web Worker in your browser; the file is never uploaded.
      </p>

      <h2>How to Convert STL to 3MF in 3 Steps</h2>
      <ol>
        <li><strong>Drop your <code>.stl</code>:</strong> Binary and ASCII STL are detected automatically (never by the <code>solid</code> prefix alone, which many binary exporters also write). Files up to 100 MB.</li>
        <li><strong>Set unit and name:</strong> Leave <strong>Millimeter</strong> unless you know the STL was exported in inches. Type an <strong>object name</strong> if you want something better than the filename in your slicer's object list.</li>
        <li><strong>Export <code>.3mf</code>:</strong> The log reports welded vertex count, triangle count, output size and watertightness. Click <strong>Export .3MF</strong> and open the file directly in Bambu Studio, OrcaSlicer, PrusaSlicer or Cura.</li>
      </ol>

      <h2>Worked Example: Vertex Welding and File Size</h2>
      <div class="formula-box">
        Binary STL bytes = 84 + 50 × N_triangles (each corner stored again for every facet)<br/>
        3MF: V unique vertices + N index triples in XML, then DEFLATE<br/>
        20 mm cube: STL 684 bytes (36 corners) → 3MF 8 vertices + 12 triangles ≈ 1.1 KB zipped (XML overhead dominates tiny meshes)<br/>
        150 k-facet organic part: STL 7.5 MB → 3MF typically 1.5–2.5 MB
      </div>
      <p>
        Welding uses exact coordinate matching after rounding to six decimals, so it merges the duplicate corners STL creates without moving any vertex. It does not close gaps between faces that were never coincident — that is a repair step, not a conversion step.
      </p>

      <h2>Why Convert STL to 3MF?</h2>
      <ul>
        <li><strong>Units travel with the file:</strong> no more 25.4× surprises when a model made in inches lands in a millimetre slicer.</li>
        <li><strong>Smaller files:</strong> indexed vertices plus compression typically cut size by 3–5× versus binary STL and 15–25× versus ASCII STL.</li>
        <li><strong>Named objects:</strong> the name you type here appears in the slicer's object list and in MakerWorld/Printables uploads.</li>
        <li><strong>A starting point for projects:</strong> open the 3MF in your slicer, add settings, and save — the geometry part is already in the right place.</li>
      </ul>

      <h2>Technical Limitations</h2>
      <p>
        The output contains geometry and metadata only: no printer profile, filament settings, colours, textures or thumbnails. Multiple shells inside one STL stay one object (3MF allows that). Per-face colour from binary STL attribute bytes is not carried over. If the input mesh has open edges, the 3MF will have them too — most slicers still load it, but repair first for a clean solid.
      </p>

      <h2>Frequently Asked Questions</h2>
      <div class="faq-list">
        <details>
          <summary>Will Bambu Studio, OrcaSlicer, PrusaSlicer and Cura open the file?</summary>
          <p>Yes. The package follows the 3MF Core specification exactly (content types, root relationship, one model part with a mesh object and a build item), which is the subset every slicer's importer supports. It opens as a plain geometry 3MF, not a project with settings.</p>
        </details>
        <details>
          <summary>Should I choose millimeter or inch?</summary>
          <p>Millimeter, unless the STL was exported from a CAD tool set to inches and looks about 25× too small when opened in a slicer. The converter never rescales coordinates; the unit attribute tells the slicer how to interpret them.</p>
        </details>
        <details>
          <summary>Why is the 3MF sometimes larger than a tiny STL?</summary>
          <p>For very small meshes the XML and ZIP container overhead (about 1 KB) outweighs the savings from vertex indexing. From a few hundred triangles upward the 3MF is smaller, and for typical printable parts it is several times smaller.</p>
        </details>
        <details>
          <summary>Does welding change the geometry?</summary>
          <p>No vertex is moved. Corners that are bit-identical after rounding to six decimal places share one index, and triangles whose three corners collapse to fewer than three unique points are removed. Volume and surface area are unchanged.</p>
        </details>
        <details>
          <summary>Is anything uploaded?</summary>
          <p>No. Parsing, welding and ZIP writing all happen in a Web Worker in your browser. The exported file is created from browser memory with a download link.</p>
        </details>
      </div>""",
    },
    {
        "slug": "stl-ascii-to-binary-converter",
        "action": "stl-encoding",
        "title": "STL ASCII to Binary Converter Online (and Back)",
        "description": "Convert ASCII STL to binary STL (4–6× smaller) or binary to ASCII in your browser. Auto-detects the encoding, keeps geometry bit-exact, reports facet count and size ratio. Nothing is uploaded.",
        "og_description": "Free browser-based STL re-encoder: ASCII ↔ binary with auto-detection, exact geometry and size report. Zero upload.",
        "h1": "STL ASCII to Binary Converter — and Binary to ASCII, No Upload",
        "spec_tag": "KERNEL: STL FORMAT SNIFFER + RE-ENCODER",
        "app_name": "MeshKit STL ASCII/Binary Converter",
        "breadcrumb": "STL ASCII to Binary Converter",
        "input_label": "A. STL Input (either encoding)",
        "accept": ".stl",
        "drop_text": "[CLICK TO SELECT .STL] OR DRAG MESH HERE",
        "drop_sub": "Sniffs the real encoding from byte length and structure, not the 'solid' prefix.",
        "browse": "BROWSE .STL...",
        "sample": "LOAD SAMPLE .STL",
        "get_sample": "⬇ GET TEST .STL",
        "aria_upload": "Upload STL file",
        "options_title": "B. Target Encoding",
        "options_html": """            <div>
              <label class="field-label" for="cvTargetSelect"><span>Convert To</span><span class="unit-tag">[encoding]</span></label>
              <select id="cvTargetSelect">
                <option value="auto" selected>Auto — the other encoding</option>
                <option value="binary">Binary STL (compact)</option>
                <option value="ascii">ASCII STL (text)</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="cvGeometryNote"><span>Geometry</span><span class="unit-tag">[exact]</span></label>
              <input type="text" id="cvGeometryNote" value="Unchanged: same facets, same order" readonly />
            </div>""",
        "log_title": "// STL ASCII ↔ BINARY LOG",
        "log_wait": "Awaiting .STL file selection...",
        "kpi": [("Bounding Box", "X / Y / Z extents, mm"), ("Facets", "Triangles"), ("Output Size", "re-encoded STL"), ("Encoding", "detected → written")],
        "export_status": "Select an .STL file to re-encode.",
        "export_btn": "EXPORT RE-ENCODED .STL",
        "related": [
            ("/stl-repair-online", "02 -&gt; AUDIT &amp; REPAIR STL MESH"),
            ("/stl-to-3mf-converter", "07 -&gt; PACKAGE AS 3MF (SMALLER STILL)"),
            ("/stl-volume-weight-calculator", "02B -&gt; CALCULATE STL VOLUME &amp; PART WEIGHT"),
        ],
        "reference_title": "Reference // How the Encoding Is Detected",
        "reference_text": "A binary STL is exactly 84 + 50 × N bytes, where N is the uint32 at offset 80. The checker verifies that identity first; only when it fails does it try to read the file as text. Many binary exporters start the 80-byte header with the word <code>solid</code>, so the prefix alone proves nothing.",
        "seo": """      <h2>What the STL ASCII ↔ Binary Converter Does</h2>
      <p>
        Every <code>.stl</code> file is one of two encodings. <strong>ASCII STL</strong> is human-readable text — <code>facet normal</code>, <code>outer loop</code>, three <code>vertex</code> lines — and is what many CAD exporters, scanners and scripts write by default. <strong>Binary STL</strong> packs the same facets into fixed 50-byte records after an 80-byte header, loads far faster, and is 4–6× smaller. This tool detects which one you have, re-encodes it to the other (or to the encoding you choose), and reports the facet count, the exact byte sizes and the size ratio.
      </p>
      <p>
        The geometry is not touched: same triangles, same order, same coordinates (ASCII output uses six-digit exponent notation, binary stores IEEE-754 float32, which is what both formats have always used). Facet normals are recomputed from the vertex winding, which fixes files whose stored normals disagree with their triangles. The conversion runs in a Web Worker in your browser; nothing is uploaded.
      </p>

      <h2>How to Convert in 3 Steps</h2>
      <ol>
        <li><strong>Drop the <code>.stl</code>:</strong> The sniffer checks the binary size identity (84 + 50 × N) before falling back to a text parse, so files that start with "solid" but are really binary are handled correctly.</li>
        <li><strong>Choose the target:</strong> <strong>Auto</strong> flips to the other encoding. Force <strong>Binary</strong> to shrink a file for a slicer or upload, or <strong>ASCII</strong> when a script, a course assignment or a diff tool needs readable text.</li>
        <li><strong>Export:</strong> Review facets, bounding box and the size ratio in the log, then click <strong>Export re-encoded .STL</strong>. The download is named <code>name-binary.stl</code> or <code>name-ascii.stl</code> so you keep the original.</li>
      </ol>

      <h2>Worked Example: Size of the Two Encodings</h2>
      <div class="formula-box">
        Binary STL = 80-byte header + 4-byte uint32 count + N × (12 normal + 36 vertices + 2 attribute) bytes = 84 + 50 N<br/>
        ASCII STL ≈ N × 7 lines × ~30–45 characters ≈ 220–300 N bytes<br/>
        N = 100,000 facets: binary 5.0 MB vs ASCII 22–30 MB (×4.4–6)<br/>
        Binary parse: one typed-array read &nbsp;·&nbsp; ASCII parse: ~700,000 tokens to scan
      </div>

      <h2>When You Need Which Encoding</h2>
      <ul>
        <li><strong>Binary</strong> for slicers (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura), print services, Printables/Thingiverse uploads and anything with a size limit. Some upload forms silently reject ASCII STL above a few megabytes.</li>
        <li><strong>ASCII</strong> for inspecting a mesh in a text editor, version control diffs, teaching, generating STL from scripts, and a few legacy CAM and FEA importers that choke on binary.</li>
        <li><strong>Either, but smaller:</strong> if size is the real problem, convert to <a href="/stl-to-3mf-converter">3MF</a>, which indexes shared vertices and compresses the result.</li>
      </ul>

      <h2>Technical Limitations</h2>
      <p>
        The 2-byte per-facet attribute field (used by a few tools for colour) is written as zero in binary output. ASCII solid names are replaced by <code>meshkit_export</code>. Multi-solid ASCII files are read as one mesh. The tool does not repair geometry — open edges, flipped faces and duplicate triangles pass through unchanged; use <a href="/stl-repair-online">STL Repair</a> for that.
      </p>

      <h2>Frequently Asked Questions</h2>
      <div class="faq-list">
        <details>
          <summary>My file starts with "solid" — isn't that ASCII?</summary>
          <p>Not necessarily. Many binary exporters (SolidWorks, some Blender add-ons) write "solid" in the 80-byte header. The converter checks whether the byte length equals 84 + 50 × N first; that identity is the reliable test. The log tells you what was detected.</p>
        </details>
        <details>
          <summary>Does converting change precision?</summary>
          <p>Binary STL stores float32, and ASCII STL written by nearly every tool also carries float32 precision (six to seven significant digits). Round-tripping ASCII → binary → ASCII reproduces the same values; only the text formatting differs.</p>
        </details>
        <details>
          <summary>Why is the binary file exactly 684 bytes for a cube?</summary>
          <p>A cube is 12 triangles: 84 + 50 × 12 = 684. You can verify any binary STL this way — if the size does not match the count in the header, the file is truncated or not binary.</p>
        </details>
        <details>
          <summary>Can I batch-convert many files?</summary>
          <p>One file at a time in this free tool. Drag the next file in as soon as the first download starts; conversion takes well under a second for typical parts.</p>
        </details>
        <details>
          <summary>Is anything uploaded?</summary>
          <p>No. Detection, parsing and re-encoding happen in a Web Worker in your browser. The export is generated from memory as a download.</p>
        </details>
      </div>""",
    },
    {
        "slug": "obj-to-stl-converter",
        "action": "obj-to-stl",
        "title": "Convert OBJ to STL Online — Free, No Upload",
        "description": "Convert Wavefront .obj to binary or ASCII STL in your browser. Triangulates quads and n-gons, picks units (mm, cm, m, inch), fixes Y-up to Z-up, drops materials and UVs. Nothing is uploaded.",
        "og_description": "Free browser-based OBJ to STL converter: polygon triangulation, unit scaling, Y-up fix, watertightness report — zero upload.",
        "h1": "Convert OBJ to STL Online — Triangulated, Scaled, No Upload",
        "spec_tag": "KERNEL: WAVEFRONT OBJ PARSER + FAN TRIANGULATOR",
        "app_name": "MeshKit OBJ to STL Converter",
        "breadcrumb": "OBJ to STL Converter",
        "input_label": "A. Wavefront Mesh Input (.OBJ)",
        "accept": ".obj",
        "drop_text": "[CLICK TO SELECT .OBJ] OR DRAG MESH HERE",
        "drop_sub": "Reads v / f records locally; materials, UVs and normals are ignored (STL has none).",
        "browse": "BROWSE .OBJ...",
        "sample": "LOAD SAMPLE .OBJ",
        "get_sample": "⬇ GET TEST .OBJ",
        "aria_upload": "Upload OBJ file",
        "options_title": "B. Units, Up Axis &amp; STL Encoding",
        "options_html": """            <div>
              <label class="field-label" for="cvUnitSelect"><span>OBJ Units</span><span class="unit-tag">[scale → mm]</span></label>
              <select id="cvUnitSelect">
                <option value="millimeter" selected>Millimeters (×1) — CAD exports</option>
                <option value="centimeter">Centimeters (×10)</option>
                <option value="meter">Meters (×1000) — Blender, game assets</option>
                <option value="inch">Inches (×25.4)</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="cvUpAxisSelect"><span>Up Axis in File</span><span class="unit-tag">[orientation]</span></label>
              <select id="cvUpAxisSelect">
                <option value="z" selected>Z up (keep as-is)</option>
                <option value="y">Y up (Blender / Maya / glTF) → rotate to Z up</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="cvFormatSelect"><span>STL Format</span><span class="unit-tag">[encoding]</span></label>
              <select id="cvFormatSelect">
                <option value="binary" selected>Binary STL (Compact)</option>
                <option value="ascii">ASCII STL (Text)</option>
              </select>
            </div>""",
        "log_title": "// OBJ → STL CONVERTER LOG",
        "log_wait": "Awaiting .OBJ file selection...",
        "kpi": [("Bounding Box", "X / Y / Z extents, mm"), ("Output Facets", "Triangles"), ("Output Size", "Binary STL"), ("OBJ Faces", "before triangulation")],
        "export_status": "Select an .OBJ file to convert and export.",
        "export_btn": "EXPORT .STL",
        "related": [
            ("/stl-repair-online", "02 -&gt; AUDIT &amp; REPAIR THE EXPORTED STL"),
            ("/stl-viewer-online", "09 -&gt; PREVIEW THE RESULT IN THE 3D VIEWER"),
            ("/stl-to-3mf-converter", "07 -&gt; PACKAGE AS 3MF FOR YOUR SLICER"),
        ],
        "reference_title": "Reference // Why Units and Up-Axis Matter",
        "reference_text": "OBJ stores bare numbers. Blender exports in metres with Y up by default; CAD tools export millimetres with Z up. A 50 mm part exported from Blender arrives as 0.05 units lying on its side — pick <code>Meters</code> and <code>Y up</code> and it lands upright at 50 mm.",
        "seo": """      <h2>What the Online OBJ to STL Converter Does</h2>
      <p>
        Wavefront OBJ is the lingua franca of 3D modelling, scanning and game art: Blender, Maya, ZBrush, Meshroom, Polycam and most photogrammetry apps export it. It stores vertices (<code>v</code>), faces (<code>f</code>) that can be triangles, quads or arbitrary polygons, plus normals, texture coordinates and material references that slicers do not use. STL — what every slicer, print service and mesh repair tool expects — stores triangles only. This converter reads the OBJ in your browser, fan-triangulates every polygon, resolves relative (negative) indices, merges all objects and groups into one mesh, applies the unit and up-axis you choose, and writes a binary or ASCII STL with recomputed facet normals.
      </p>
      <p>
        Because OBJ has no units, the two options that matter most are <strong>units</strong> and <strong>up axis</strong>. Blender and most game pipelines write metres with Y up; CAD exporters write millimetres with Z up. Choose correctly here and the part lands in your slicer at the right size, standing on the bed. The mesh is audited for open edges and inverted winding before download, and nothing is uploaded — the file is parsed in a Web Worker on your machine (100 MB limit).
      </p>

      <h2>How to Convert OBJ to STL in 3 Steps</h2>
      <ol>
        <li><strong>Drop the <code>.obj</code>:</strong> Only the <code>.obj</code> file is needed; the companion <code>.mtl</code> and textures are ignored because STL cannot carry colour.</li>
        <li><strong>Set units and up axis:</strong> If the bounding box in the log reads 0.05 × 0.03 × 0.02 mm, your file is in metres — switch to <strong>Meters</strong>. If the model is lying on its side in the viewer or slicer, choose <strong>Y up → Z up</strong>.</li>
        <li><strong>Export <code>.stl</code>:</strong> Binary is the default. The log lists how many faces were polygons, how many triangles came out, and whether the mesh is watertight. Open it in <a href="/stl-viewer-online">the viewer</a> to confirm orientation.</li>
      </ol>

      <h2>Worked Example: Fan Triangulation and Index Resolution</h2>
      <div class="formula-box">
        f 1 2 3 4 &nbsp;→&nbsp; triangles (1,2,3) and (1,3,4) &nbsp;·&nbsp; an n-gon with k corners becomes k − 2 triangles<br/>
        f -3/1/1 -2/2/1 -1/3/1 &nbsp;→&nbsp; negative indices count back from the last vertex written so far<br/>
        Sample vase: 193 vertices, 192 faces (168 quads + 24 cap triangles) → 360 STL facets, open top = 24 boundary edges<br/>
        Blender default export: metres, Y up &nbsp;→&nbsp; choose Meters + Y up to get a 64 mm vase standing upright
      </div>
      <p>
        Fan triangulation is exact for convex, planar polygons — which is what nearly every exporter writes. A non-planar or concave n-gon can produce a self-intersecting fan; if the log reports many open edges on a model that looked closed, re-export with "Triangulate faces" enabled in the source application.
      </p>

      <h2>Why Convert OBJ to STL?</h2>
      <ul>
        <li><strong>3D printing:</strong> slicers import OBJ unevenly (some ignore groups, some choke on UVs); STL is the safe path.</li>
        <li><strong>Scans and sculpts:</strong> photogrammetry and ZBrush exports are OBJ by default; STL is what print services quote on.</li>
        <li><strong>Mesh repair and measurement:</strong> MeshKit's <a href="/stl-repair-online">repair</a> and <a href="/stl-volume-weight-calculator">volume</a> tools work on STL.</li>
        <li><strong>Stripping materials:</strong> a single geometry file with no dangling <code>.mtl</code> or texture references.</li>
      </ul>

      <h2>Technical Limitations</h2>
      <p>
        Materials, per-vertex colours, texture coordinates and smoothing groups are discarded. Multiple objects become one STL; export each object separately if you need them apart. Free-form geometry (<code>curv</code>, <code>surf</code>, NURBS) and point or line elements are skipped. Faces referencing indices that do not exist are skipped and counted in the log.
      </p>

      <h2>Frequently Asked Questions</h2>
      <div class="faq-list">
        <details>
          <summary>Is my OBJ uploaded anywhere?</summary>
          <p>No. Parsing, triangulation and STL writing run in a Web Worker in your browser. The only network requests the page makes are for its own assets and the sample file.</p>
        </details>
        <details>
          <summary>My model comes out tiny / huge — what happened?</summary>
          <p>OBJ has no unit, so the numbers are taken as millimetres by default. A Blender export in metres is 1,000× too small until you pick <strong>Meters</strong>. Check the bounding box in the log: it should match the real-world size you expect.</p>
        </details>
        <details>
          <summary>The part is lying on its side in my slicer.</summary>
          <p>The file is Y-up (Blender, Maya, glTF pipelines). Select <strong>Y up → Z up</strong>; the converter rotates the model so the original Y becomes Z, which is what printers and slicers assume.</p>
        </details>
        <details>
          <summary>Do I need the .mtl file or textures?</summary>
          <p>No. STL cannot store colour or textures, so the converter ignores <code>mtllib</code>/<code>usemtl</code> and <code>vt</code> records. Only the <code>.obj</code> itself is read.</p>
        </details>
        <details>
          <summary>Why does the log report open edges when the model looked closed?</summary>
          <p>Either the source genuinely has an opening (the sample vase does — its top is open), or a concave n-gon fan-triangulated badly, or vertices were duplicated along seams by the exporter. Run the STL through <a href="/stl-repair-online">STL Repair</a>, which welds coincident vertices and fills small holes.</p>
        </details>
      </div>""",
    },
]


def kpi_cell(idx, label, sub):
    ids = ["cvKpiA", "cvKpiB", "cvKpiC", "cvKpiD"]
    sub_id = {2: ' id="cvKpiCSub"', 3: ' id="cvKpiDSub"'}.get(idx, "")
    style = ' style="font-size:17px;"' if idx == 0 else ""
    return f"""          <div class="kpi-cell">
            <div class="kpi-label">{label}</div>
            <div class="kpi-val" id="{ids[idx]}"{style}>—</div>
            <div class="kpi-sub"{sub_id}>{sub}</div>
          </div>"""


def render(p):
    url = f"https://meshkit.pro/{p['slug']}"
    jsonld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebApplication",
                "name": p["app_name"],
                "url": url,
                "applicationCategory": "UtilitiesApplication",
                "operatingSystem": "Any",
                "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "MeshKit", "item": "https://meshkit.pro/"},
                    {"@type": "ListItem", "position": 2, "name": p["breadcrumb"], "item": url},
                ],
            },
        ],
    }
    kpis = "\n".join(kpi_cell(i, l, s) for i, (l, s) in enumerate(p["kpi"]))
    related = "\n".join(
        f'          <a href="{href}" class="btn-secondary route-link">{text}</a>' for href, text in p["related"]
    )
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
<body data-page="converter" data-converter="{p['action']}">

  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/">
        <div class="brand-mark">MK</div>
        <div>
          <span class="mono" style="font-weight:700; font-size:14px;">MESHKIT</span>
          <span class="mono" style="font-size:11px; color:var(--text-faint); margin-left:6px;">CAD &amp; PRINT LEDGER</span>
        </div>
      </a>

{NAV_TABS}

      <button type="button" class="theme-btn" id="themeToggle">
        THEME: PAPER [LIGHT]
      </button>
    </div>
  </header>

  <main class="shell">

    <nav class="sub-nav" aria-label="Mesh converters">
      <a href="/step-to-stl-converter">STEP to STL</a>
      <a href="/3mf-to-stl-converter"{' class="active"' if p['slug']=='3mf-to-stl-converter' else ''}>3MF to STL</a>
      <a href="/stl-to-3mf-converter"{' class="active"' if p['slug']=='stl-to-3mf-converter' else ''}>STL to 3MF</a>
      <a href="/stl-ascii-to-binary-converter"{' class="active"' if p['slug']=='stl-ascii-to-binary-converter' else ''}>STL ASCII ↔ Binary</a>
      <a href="/obj-to-stl-converter"{' class="active"' if p['slug']=='obj-to-stl-converter' else ''}>OBJ to STL</a>
      <a href="/stl-viewer-online">STL Viewer</a>
      <a href="/stl-repair-online">STL Repair</a>
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

    <section id="panel-converter" class="workbench tool-panel">
      <div class="wb-left">
        <div class="wb-section">
          <div class="section-head">
            <span>{p['input_label']}</span>
            <span id="cvParseState" style="color:var(--status-ok);">READY</span>
          </div>
          <div class="drop-area" id="cvDropzone" aria-label="{p['aria_upload']}">
            <label for="cvFileInput" class="hidden">{p['aria_upload']}</label>
            <input type="file" id="cvFileInput" accept="{p['accept']}" class="hidden" />
            <div class="mono" style="font-weight:600; font-size:12px;" id="cvFileName">{p['drop_text']}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;" id="cvFileSub">{p['drop_sub']}</div>
            <div class="btn-row">
              <button type="button" id="cvBrowseBtn" class="btn-primary">{p['browse']}</button>
              <button type="button" id="cvSampleBtn" class="btn-secondary">{p['sample']}</button>
              <button type="button" id="cvGetSampleBtn" class="btn-ghost" title="Download the sample file to test uploading">{p['get_sample']}</button>
              <button type="button" id="cvRetryBtn" class="btn-secondary hidden">RETRY CONVERSION</button>
            </div>
            <div id="cvProgressBarWrap" class="progress-bar-wrap hidden" aria-label="Conversion progress">
              <div id="cvProgressBarFill" class="progress-bar-fill"></div>
            </div>
          </div>
        </div>

        <div class="wb-section">
          <div class="section-head">
            <span>{p['options_title']}</span>
            <span style="color:var(--accent);">LOCAL</span>
          </div>
          <div class="field-grid">
{p['options_html']}
          </div>
        </div>
      </div>

      <div class="wb-right">
        <div class="wb-section mono" id="cvLogBox" style="background:var(--bg-canvas); color:#D4D3CD; font-size:12px; min-height:180px;">
          <div style="color:#FF5C1A; margin-bottom:8px;">{p['log_title']}</div>
          <div>{p['log_wait']}</div>
        </div>

        <div class="kpi-strip">
{kpis}
        </div>

        <div class="quote-bar">
          <span class="mono" style="font-size:12px; color:var(--text-muted);" id="cvExportStatus">{p['export_status']}</span>
          <button type="button" id="cvDownloadBtn" class="btn-primary">{p['export_btn']}</button>
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
{FOOTER_LINKS}
      </div>
    </footer>

  </main>

  <script type="module" src="/src/main.ts"></script>
</body>
</html>
"""


if __name__ == "__main__":
    for p in PAGES:
        out = ROOT / f"{p['slug']}.html"
        out.write_text(render(p), encoding="utf-8")
        words = len(render(p).split())
        print(f"wrote {out.name} (title {len(p['title'])} chars)")
