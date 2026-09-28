#!/usr/bin/env python3
"""
Actualiza los datos de conversión que la app carga al abrir.

  Part_Conversion.xlsx  →  barcodes.json  (código de barras → número de parte)
  fotos3point.xlsx      →  catalog.js     (número de parte → nombre del producto)

Uso:
  python3 tools/build-barcode-map.py ruta/a/Part_Conversion.xlsx   # aplica un Excel nuevo
  python3 tools/build-barcode-map.py                               # solo regenera catalog.js

El Excel se APLICA sobre el barcodes.json que ya está en el repositorio: agrega
códigos y variantes, y no borra ninguno. Así un Excel parcial o más viejo no se
lleva por delante códigos que ya estaban. Para quitar un código, se edita
barcodes.json a mano.

barcodes.json guarda cada código tal como aparece en el Excel (con y sin el
cero de la izquierda, porque el ERP trae los dos) y el número de parte como lo
escribe el ERP (P-P1811, no PP1811).

Un código impreso en dos variantes del mismo producto (16GC10 / 16GC10T) se
guarda como lista y la app se queda con la que tiene lugar en el mapa. La
versión anterior de este archivo descartaba esos 34 códigos: escanear un
bebedero WT214 o una puerta 16GC10 daba "no encontrado".
"""
import datetime, json, re, zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def sheet_rows(path, sheet="xl/worksheets/sheet1.xml"):
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


def norm(code):
    """La misma normalización que normBarcode() en index.html."""
    return re.sub(r"[^A-Z0-9]", "", str(code or "").strip().upper())


def build_barcodes(excel_path=None):
    target = ROOT / "barcodes.json"
    current = json.loads(target.read_text(encoding="utf8")) if target.exists() else {"items": {}}
    by_code = defaultdict(list)
    for code, parts in current.get("items", {}).items():
        for part in (parts if isinstance(parts, list) else [parts]):
            if part not in by_code[code]:
                by_code[code].append(part)
    if excel_path:
        for cells in sheet_rows(excel_path):
            part = (cells.get("A") or "").strip().upper()
            code = norm(cells.get("B"))
            if not part or not code or part == "PARTNUM":
                continue
            if part not in by_code[code]:
                by_code[code].append(part)
    # Una fila de puros ceros es relleno, no una etiqueta: un escaneo en blanco
    # no debe resolver al producto que tenía al lado.
    for code in [c for c in by_code if set(c) == {"0"}]:
        del by_code[code]
    items = {c: (v[0] if len(v) == 1 else sorted(v)) for c, v in sorted(by_code.items())}
    out = {
        "version": 2,
        "source": Path(excel_path).name if excel_path else current.get("source", "Part_Conversion.xlsx"),
        "generatedAt": datetime.date.today().isoformat() if excel_path else current.get("generatedAt"),
        "count": len(items),
        "shared": sum(1 for v in items.values() if isinstance(v, list)),
        "items": items,
    }
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    return out


def build_catalog():
    src = ROOT / "fotos3point.xlsx"
    cat = {}
    for r in list(sheet_rows(src))[1:]:
        sku = (r.get("A") or "").strip()
        if not sku:
            continue
        name = (r.get("C") or "").strip()
        cat[sku] = {"n": "" if name in ("—", "-") else name, "b": (r.get("B") or "").strip()}
    for r in sheet_rows(src, "xl/worksheets/sheet2.xml"):
        m = re.match(r"^(\S+)\s+(.+)$", (r.get("A") or "").strip())
        if m:
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
   TARTER YARD MAP — nombres de producto que vienen con la app
   ------------------------------------------------------------
   Número de parte → nombre, para que al escanear se lea el producto
   y no solo un número. Es la base: el reporte de inventario TGU
   (columna Description) cubre toda la planta y manda sobre esto.

     n = nombre · b = marca

   Generado por tools/build-barcode-map.py — no editar a mano.
   {len(out)} productos con nombre
   ============================================================ */
window.__SEED_CATALOG__ = {{
"""
    (ROOT / "catalog.js").write_text(header + ",\n".join(lines) + "\n};\n", encoding="utf8")
    return len(out)


if __name__ == "__main__":
    import sys
    b = build_barcodes(sys.argv[1] if len(sys.argv) > 1 else None)
    n = build_catalog()
    print(f"barcodes.json: {b['count']} códigos ({b['shared']} compartidos por dos variantes)")
    print(f"catalog.js   : {n} nombres de producto")
