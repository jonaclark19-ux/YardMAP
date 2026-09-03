#!/usr/bin/env python3
"""Build the shipped index.html from a single-file Yard Map build.

The build is deliberately self-contained (offline-safe), so the theme ships as
the last <style> in the document rather than a linked file. Re-running this
replaces the previously injected block instead of stacking.

    python3 theme/build.py <source index.html> <output index.html> [--pwa]

--pwa also wires the progressive-web-app files that live next to index.html
(manifest, touch icon, service worker) so the deployed site is installable and
works offline. Every reference is relative and every hook is guarded, so the
same file still opens straight from disk with nothing else around it.
"""
import re, sys, pathlib

MARK_OPEN = '<style id="tarter-brand-theme">'
MARK_CLOSE = '</style>'

PWA_HEAD = """<link rel="manifest" href="manifest.webmanifest" />
<link rel="apple-touch-icon" href="icons/icon-192.png" />"""

PWA_SCRIPT = """<script id="tarter-pwa">
/* Installable + offline when served next to sw.js; a no-op from file://. */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
</script>"""


def add_pwa(html):
    if 'rel="manifest"' not in html:
        html = html.replace("</title>", "</title>\n" + PWA_HEAD, 1)
    # Match the theme's top bar so the phone status bar blends into the header.
    html = re.sub(r'<meta name="theme-color" content="[^"]*" />',
                  '<meta name="theme-color" content="#14181E" />', html, count=1)
    if 'id="tarter-pwa"' not in html:
        cut = html.rfind("</body>")
        html = html[:cut] + PWA_SCRIPT + "\n" + html[cut:]
    return html

def main(src, out, *flags):
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

    if "--pwa" in flags:
        html = add_pwa(html)

    pathlib.Path(out).write_text(html, encoding="utf-8")
    print(f"{out}: {len(html):,} bytes, theme block {len(css):,} bytes"
          + (", pwa wired" if "--pwa" in flags else ""))

if __name__ == "__main__":
    main(*sys.argv[1:])
