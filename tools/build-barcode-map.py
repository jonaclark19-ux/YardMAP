#!/usr/bin/env python3
"""
Genera barcodes.js y catalog.js a partir de los archivos fuente del proyecto.

  seed/Part_Conversion.xlsx  →  barcodes.js  (código de barras → SKU)
  fotos3point.xlsx           →  catalog.js   (SKU → nombre del producto)

Uso:  python3 tools/build-barcode-map.py
"""
import json, re, sys, zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def sheet_rows(path, sheet="xl/worksheets/sheet1.xml"):
    """Filas de una hoja como dicts {columna: valor}, sin dependencias externas."""
    z = zipfile.ZipFile(path)
    try:
        shared = ["".join(t.text or "" for t in e.iter(NS + "t"))
                  for e in ET.fromstring(z.read("xl/sharedStrings.xml"))]
    except KeyError:
        shared = []
    for row in ET.fromstring(z.read(sheet)).iter(NS + "row"):
        cells = {}
        for c in row.iter(NS + "c"):
            v = c.find(NS + "v")
            if v is None or v.text is None:
                continue
            col = re.match(r"([A-Z]+)", c.get("r")).group(1)
            cells[col] = shared[int(v.text)] if c.get("t") == "s" else v.text
        yield cells


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def part_number(s):
    """Tal como lo escribe el ERP: P-P1811 no es PP1811 en una etiqueta."""
    return str(s or "").strip().upper()


def barcode_key(code):
    """Los ceros a la izquierda distinguen UPC-A de EAN-13 del mismo producto."""
    k = norm(code)
    return k.lstrip("0") or k


def build_barcodes():
    src = ROOT / "seed" / "Part_Conversion.xlsx"
    pairs = []
    for cells in sheet_rows(src):
        part, code = (cells.get("A") or "").strip(), (cells.get("B") or "").strip()
        if not part or not code or part.lower() == "partnum":
            continue
        key = barcode_key(code)
        # Filas de relleno: códigos en ceros o demasiado cortos para ser una etiqueta.
        if len(key) < 6 or set(key) == {"0"}:
            continue
        pairs.append((part_number(part), key))
    by_code = defaultdict(set)
    for part, code in pairs:
        by_code[code].add(part)
    # Un puñado de códigos se comparten entre variantes (p. ej. 16GC10 y 16GC10T):
    # se guardan las dos y la app elige la que esté en el mapa.
    out = {c: (sorted(s)[0] if len(s) == 1 else sorted(s)) for c, s in sorted(by_code.items())}
    body = ",\n".join('  "%s": %s' % (c, json.dumps(v, ensure_ascii=False)) for c, v in out.items())
    header = f"""/* ============================================================
   TARTER YARD MAP — conversión de códigos de barras
   ------------------------------------------------------------
   Código de barras (UPC/EAN) → número de parte (SKU), sacado de
   seed/Part_Conversion.xlsx. Con esta tabla, al escanear una
   etiqueta la app muestra el producto y no el número del código.

   Las llaves van sin los ceros de la izquierda, para que el mismo
   producto se encuentre lo mismo si el lector devuelve el UPC-A de
   12 dígitos o el EAN-13 de 13. Cuando un código está compartido
   por dos variantes, el valor es una lista y la app se queda con
   la que exista en el mapa.

   Generado por tools/build-barcode-map.py — no editar a mano.
   {len(pairs)} filas · {len(out)} códigos · {len(set(p for p, _ in pairs))} SKUs
   ============================================================ */
window.__BARCODE_MAP__ = {{
"""
    (ROOT / "barcodes.js").write_text(header + body + "\n};\n", encoding="utf8")
    return len(out), len({p for p, _ in pairs})


def build_catalog():
    src = ROOT / "fotos3point.xlsx"
    cat = {}
    rows = list(sheet_rows(src))[1:]
    for r in rows:
        sku = (r.get("A") or "").strip()
        if not sku:
            continue
        name = (r.get("C") or "").strip()
        cat[sku] = {"n": "" if name in ("—", "-") else name, "b": (r.get("B") or "").strip()}
    for r in sheet_rows(src, "xl/worksheets/sheet2.xml"):
        m = re.match(r"^(\S+)\s+(.+)$", (r.get("A") or "").strip())
        if not m:
            continue
        e = cat.setdefault(m.group(1).strip(), {"n": "", "b": ""})
        if not e["n"]:
            e["n"] = m.group(2).strip()
    out = {k: v for k, v in sorted(cat.items()) if v["n"]}
    lines = []
    for k, v in out.items():
        ent = {"n": v["n"]}
        if v["b"]:
            ent["b"] = v["b"]
        lines.append("  %s: %s" % (json.dumps(k, ensure_ascii=False), json.dumps(ent, ensure_ascii=False)))
    header = f"""/* ============================================================
   TARTER YARD MAP — catálogo de nombres de producto
   ------------------------------------------------------------
   SKU → nombre del producto, para que al escanear un código de
   barras la app muestre el producto escrito y no un número.

     n = nombre del producto
     b = marca

   Esta es la base que viene con la app (sacada de fotos3point.xlsx).
   El reporte de inventario que carga el administrador aporta el
   resto de los nombres y manda sobre esta lista.

   Generado por tools/build-barcode-map.py — no editar a mano.
   {len(out)} productos con nombre
   ============================================================ */
window.__SEED_CATALOG__ = {{
"""
    (ROOT / "catalog.js").write_text(header + ",\n".join(lines) + "\n};\n", encoding="utf8")
    return len(out)


if __name__ == "__main__":
    codes, skus = build_barcodes()
    names = build_catalog()
    print(f"barcodes.js: {codes} códigos de barras, {skus} SKUs")
    print(f"catalog.js : {names} nombres de producto")
