#!/usr/bin/env python3
"""Inject the Tarter brand theme into the single-file V2.3.2 build.

The V2.3.2 index.html is deliberately self-contained (offline-safe), so the
theme ships as the last <style> in the document rather than a linked file.
Re-running this replaces the previously injected block instead of stacking.

    python3 theme/build.py <source index.html> <output index.html>
"""
import re, sys, pathlib

MARK_OPEN = '<style id="tarter-brand-theme">'
MARK_CLOSE = '</style>'

def main(src, out):
    html = pathlib.Path(src).read_text(encoding="utf-8")
    css = pathlib.Path(__file__).with_name("tarter-brand-theme.css").read_text(encoding="utf-8")

    # Drop an earlier injection so the build stays idempotent.
    html = re.sub(re.escape(MARK_OPEN) + r".*?" + re.escape(MARK_CLOSE), "", html, flags=re.S)

    block = f"\n{MARK_OPEN}\n{css}\n{MARK_CLOSE}\n"
    # Anchor on the LAST </body>: the embedded SheetJS library carries a
    # "</body></html>" string literal, and injecting there would land inside
    # JavaScript and break the parse of the whole script element.
    cut = html.rfind("</body>")
    if cut == -1:
        raise SystemExit("no </body> in source")
    html = html[:cut] + block + html[cut:]

    pathlib.Path(out).write_text(html, encoding="utf-8")
    print(f"{out}: {len(html):,} bytes, theme block {len(css):,} bytes")

if __name__ == "__main__":
    main(*sys.argv[1:3])
