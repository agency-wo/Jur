"""
build.py — Albanian Law Library builder
Downloads PDFs from Google Drive, extracts text, generates HTML pages.

Requirements:
    pip install pdfplumber gdown jinja2
"""

import json
import os
import re
import sys
import pdfplumber
import gdown
from jinja2 import Template

# ── Output directory (same folder as this script) ─────────────────────────────
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Law manifest ──────────────────────────────────────────────────────────────
LAWS = [
    {"file": "kushtetuta.html",                      "title": "Kushtetuta e Republikës së Shqipërisë",          "ref": "Ligj Nr. 8417 · datë 21.10.1998",   "id": "1rJzPkujHa-SUIcum89VBcHm1s1ARICBM"},
    {"file": "kodi-civil.html",                      "title": "Kodi Civil",                                      "ref": "Ligj Nr. 7850 · datë 29.7.1994",    "id": "1hRMwa0g8RxJpuCiUIazo7iBqxurFNGlU"},
    {"file": "kodi-penal.html",                      "title": "Kodi Penal",                                      "ref": "Ligj Nr. 7895 · datë 27.1.1995",    "id": "1phwJWSOboiFQgyzsk2ub1rqlEShprbbm"},
    {"file": "kodi-procedure-civile.html",           "title": "Kodi i Procedurës Civile",                        "ref": "Ligj Nr. 8116 · datë 29.3.1996",    "id": "15UehL_UuRswp95NAbV7qPDn3neED2ThR"},
    {"file": "kodi-procedure-penale.html",           "title": "Kodi i Procedurës Penale",                        "ref": "Ligj Nr. 7905 · datë 21.3.1995",    "id": "1gflSB7c6HyMK6_8iPpS0_WtyWGOHBSrb"},
    {"file": "kodi-familjes.html",                   "title": "Kodi i Familjes",                                 "ref": "Ligj Nr. 9062 · datë 8.5.2003",     "id": "1yn61FXspZzfZtoVr5ybzwTE3S41yh4te"},
    {"file": "kodi-rrugor.html",                     "title": "Kodi Rrugor",                                     "ref": "Ligj Nr. 8378 · datë 22.7.1998",    "id": "100OEMCOQk7c11OJGq2vRCrA92euDr4Nf"},
    {"file": "kodi-ajror.html",                      "title": "Kodi Ajror",                                      "ref": "Ligj Nr. 96/2020",                  "id": "17akt7_Z5nCJG_-yZg6e7aSzVLWNThlUK"},
    {"file": "kodi-doganor.html",                    "title": "Kodi Doganor",                                    "ref": "Ligj Nr. 102/2014",                 "id": "1H4IxpG26kPa8c8omv3QZnJGqIbkaDAb4"},
    {"file": "drejtesia-penale-mitur.html",          "title": "Kodi i Drejtësisë Penale për të Mitur",           "ref": "Ligj Nr. 37/2017",                  "id": "1ul67OATJfbOVPouNDhwFXXXOma0mfYsC"},
    {"file": "dispozita-zbatuese-kodi-doganor.html", "title": "Dispozita Zbatuese të Kodit Doganor",             "ref": "Rregullore zbatuese",               "id": "1atSdG1rl-gMBsjkhvYPjx5cK6IocEtdN"},
    {"file": "shoqerite-tregtare.html",              "title": "Ligj për Tregtarët dhe Shoqëritë Tregtare",       "ref": "Ligj Nr. 9901 · datë 14.4.2008",    "id": "1Mcu6XTY8AmZ_eaKRzQT7Hw5DNSqQnX77"},
    {"file": "falimentimi.html",                     "title": "Ligj për Falimentimin",                           "ref": "Ligj Nr. 110/2016",                 "id": "1S_-_UFndgryh3ipshBiEHWqz1-ay6zUn"},
    {"file": "statusi-gjyqtareve-prokuroreve.html",  "title": "Statusi i Gjyqtarëve dhe Prokurorëve",            "ref": "Ligj Nr. 96/2016",                  "id": "1E8z7fkdHHC9DVtV0dbiglxLd30viM5Fz"},
    {"file": "organizimi-pushtetit-gjyqesor.html",   "title": "Organizimi i Pushtetit Gjyqësor",                 "ref": "Ligj Nr. 98/2016",                  "id": "1FKHqzY4gDSrejvXtlFqJZo_q0q0yM76U"},
    {"file": "organizimi-pushtetit-gjyqesor-v2.html","title": "Organizimi i Pushtetit Gjyqësor (i përditësuar)", "ref": "Ligj Nr. 98/2016 (i përditësuar)", "id": "1IbX4A2pT3WSHuZkmCDLOpOAnkUrstioA"},
    {"file": "noteria.html",                         "title": "Ligj për Noterinë",                               "ref": "Ligj Nr. 110/2018",                 "id": "1vENYbtpmN1BzdQe2xHYQ1thurJCrJV5r"},
    {"file": "sherbimi-permbarimor.html",            "title": "Shërbimi Përmbarimor Gjyqësor Privat",            "ref": "Ligj Nr. 10031 · datë 11.12.2008",  "id": "1PCOFOfKZ9EqiZMl1chJO4IK_75f4tJ-h"},
]

# ── Albanian legal structure patterns ─────────────────────────────────────────
# These match the start of a line (case-sensitive where needed)
RE_PJESA   = re.compile(r'^(PJESA\s+[IVXLC\d]+)\s*(.*)?$')
RE_TITULLI = re.compile(r'^(TITULLI\s+[IVXLC\d]+)\s*(.*)?$')
RE_KREU    = re.compile(r'^(KREU\s+[IVXLC\d]+)\s*(.*)?$')
# Article numbers carry Albanian-letter suffixes (Neni 170/ç), two-letter digraphs
# (Neni 319/dh), numeric suffixes (Neni 399/10) and MULTIPLE segments (Neni 143/a/8).
# The old single-ASCII-letter pattern collapsed all of these onto the base number, silently
# overwriting 36 real articles across the corpus and emitting duplicate DOM ids.
RE_NENI    = re.compile(r'^(Neni\s+(\d+(?:/(?:[a-zçë]{1,2}|\d{1,2}))*))\s*(.*)$')


def _is_citation(m):
    """True when a line only *mentions* an article mid-sentence, e.g.
    'Neni 450 i këtij Kodi nuk i heq të drejtën...'. Real headings are either bare
    ('Neni 1'), or continue with a title / amendment note that starts uppercase or '('.
    Conservative on purpose: only a lowercase continuation is treated as a citation."""
    rest = (m.group(3) or '').strip()
    return bool(rest) and rest[0].islower()
RE_PAGE_NUM = re.compile(r'^\s*\d{1,4}\s*$')  # bare page numbers
RE_FOOTNOTE = re.compile(r'^\d+\s+Ligj\s+nr\.')  # common footnote pattern

def download_pdf(drive_id: str, dest_path: str) -> bool:
    """Download a Google Drive file to dest_path using gdown."""
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000:
        print(f"   (cached)")
        return True
    url = f"https://drive.google.com/uc?id={drive_id}"
    try:
        gdown.download(url, dest_path, quiet=False)
        return os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000
    except Exception as e:
        print(f"  ✗ Download failed: {e}", file=sys.stderr)
        return False

def extract_text(pdf_path: str) -> list[str]:
    """Extract text lines from a PDF using pdfplumber."""
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=2, y_tolerance=2)
            if not text:
                continue
            for line in text.splitlines():
                line = line.strip()
                # Skip pure page numbers and very short lines
                if RE_PAGE_NUM.match(line):
                    continue
                if len(line) < 2:
                    continue
                lines.append(line)
    return lines

def parse_structure(lines: list[str]) -> tuple[str, dict]:
    """
    Convert raw text lines into structured HTML and a {article_num: body_text} dict.
    Detects: PJESA (h2), TITULLI/KREU (h3), Neni (h4 with id anchor), paragraphs.
    """
    html_parts = []
    buffer = []
    articles = {}
    state = {'num': None, 'parts': []}

    def flush_buffer():
        if buffer:
            text = ' '.join(buffer).strip()
            if text:
                html_parts.append(f'<p>{escape_html(text)}</p>')
                if state['num']:
                    state['parts'].append(text)
            buffer.clear()

    def finalize_neni():
        if state['num'] and state['parts']:
            articles[state['num']] = ' '.join(state['parts'])
        state['num'] = None
        state['parts'] = []

    for line in lines:
        if RE_FOOTNOTE.match(line):
            continue

        m_pjesa   = RE_PJESA.match(line)
        m_titulli = RE_TITULLI.match(line)
        m_kreu    = RE_KREU.match(line)
        m_neni    = RE_NENI.match(line)

        if m_pjesa:
            flush_buffer(); finalize_neni()
            label = m_pjesa.group(1)
            rest  = m_pjesa.group(2) or ''
            text  = f"{label} {rest}".strip() if rest else label
            html_parts.append(f'<h2>{escape_html(text)}</h2>')

        elif m_titulli:
            flush_buffer(); finalize_neni()
            label = m_titulli.group(1)
            rest  = m_titulli.group(2) or ''
            text  = f"{label} {rest}".strip() if rest else label
            html_parts.append(f'<h3>{escape_html(text)}</h3>')

        elif m_kreu:
            flush_buffer(); finalize_neni()
            label = m_kreu.group(1)
            rest  = m_kreu.group(2) or ''
            text  = f"{label} {rest}".strip() if rest else label
            html_parts.append(f'<h3>{escape_html(text)}</h3>')

        elif m_neni and not _is_citation(m_neni):
            flush_buffer(); finalize_neni()
            neni_label = m_neni.group(1)          # "Neni 698" or "Neni 698/a"
            neni_num   = neni_label[5:].strip()   # "698" or "698/a"
            rest       = m_neni.group(3) or ''
            state['num']   = neni_num
            state['parts'] = [rest] if rest else []
            anchor_id  = 'neni-' + neni_num.replace('/', '-')
            rest_html  = f'<span class="art-body">{escape_html(rest)}</span>' if rest else ''
            html_parts.append(
                f'<h4 id="{anchor_id}"><span class="art-num">{escape_html(neni_label)}</span>{rest_html}</h4>'
            )

        else:
            buffer.append(line)
            if line.endswith(('.', ':', ';', '?', '!')):
                flush_buffer()

    flush_buffer()
    finalize_neni()
    return '\n'.join(html_parts), articles

def escape_html(s: str) -> str:
    return (s
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
    )

# ── Jinja2 HTML template ───────────────────────────────────────────────────────
HTML_TEMPLATE = Template("""\
<!DOCTYPE html>
<html lang="sq">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ title }}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#b8923a">
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="icon.svg">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="{{ title }}">
</head>
<body>

  <div id="progress-bar"></div>

  <header class="topbar">
    <div class="topbar-left">
      <a class="back-link" href="ligjet.html">&#8592; Indeksi</a>
      <span class="topbar-title">{{ title }}</span>
    </div>
    <div class="search-wrapper">
      <input id="search-input" type="search" placeholder="Kërko…" autocomplete="off" spellcheck="false">
      <button id="search-prev" class="search-btn" title="I mëparshmi">&#8593;</button>
      <button id="search-next" class="search-btn" title="Tjetri">&#8595;</button>
      <button id="search-clear" title="Pastro">&#215;</button>
      <span id="search-count"></span>
    </div>
  </header>

  <div class="layout">

    <aside class="sidebar">
      <div class="toc-label">Përmbajtja</div>
      <ul class="toc-list"></ul>
    </aside>

    <div class="content-wrap">
      <header class="law-header">
        <h1>{{ title }}</h1>
        <p class="law-ref">{{ ref }}</p>
      </header>
      <div id="content">
{{ body | safe }}
      </div>
    </div>

  </div>

  <script src="config.js" defer></script>
  <script src="ai.js" defer></script>
  <script src="app.js" defer></script>
  <script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});}</script>
</body>
</html>
""")

# ── Main ───────────────────────────────────────────────────────────────────────
def build_law(law: dict, tmp_dir: str):
    title = law["title"]
    ref   = law["ref"]
    out   = os.path.join(OUT_DIR, law["file"])

    print(f"\n▶  {title}")

    pdf_path = os.path.join(tmp_dir, law["file"].replace('.html', '.pdf'))

    # Download
    print(f"   Downloading {law['id']}…")
    ok = download_pdf(law["id"], pdf_path)
    if not ok:
        print(f"   ✗ Skipping — could not download PDF.")
        return

    # Extract text
    print(f"   Extracting text…")
    try:
        lines = extract_text(pdf_path)
    except Exception as e:
        print(f"   ✗ Extraction failed: {e}")
        return

    print(f"   {len(lines)} lines extracted.")

    # Parse into HTML + collect article text
    body_html, articles = parse_structure(lines)

    # Render template
    html = HTML_TEMPLATE.render(title=title, ref=ref, body=body_html)

    # Write HTML
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"   ✓ Written → {law['file']}")

    # Emit article JSON for RAG grounding
    data_dir  = os.path.join(OUT_DIR, 'data')
    os.makedirs(data_dir, exist_ok=True)
    slug      = law["file"].replace('.html', '')
    json_path = os.path.join(data_dir, slug + '.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(articles, f, ensure_ascii=False, separators=(',', ':'))
    print(f"   → data/{slug}.json ({len(articles)} nene)")

def main():
    # Allow building a single law: python build.py kushtetuta.html
    targets = sys.argv[1:] if len(sys.argv) > 1 else None

    laws = LAWS
    if targets:
        laws = [l for l in LAWS if l["file"] in targets]
        if not laws:
            print(f"No matching law found for: {targets}")
            sys.exit(1)

    cache_dir = os.environ.get('PDF_CACHE_DIR', os.path.join(OUT_DIR, '.pdf_cache'))
    os.makedirs(cache_dir, exist_ok=True)
    for law in laws:
        build_law(law, cache_dir)

    # Emit the law manifest — single source of truth for client-side full-text search + the SW.
    # Always lists the full corpus (not just a single rebuilt target) so search stays complete.
    data_dir = os.path.join(OUT_DIR, 'data')
    os.makedirs(data_dir, exist_ok=True)
    manifest = [{"file": l["file"], "title": l["title"], "ref": l["ref"]} for l in LAWS]
    with open(os.path.join(data_dir, 'laws.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'))
    print(f"   → data/laws.json ({len(manifest)} ligje)")

    print(f"\n✅  Done — {len(laws)} file(s) generated in {OUT_DIR}")

if __name__ == '__main__':
    main()
