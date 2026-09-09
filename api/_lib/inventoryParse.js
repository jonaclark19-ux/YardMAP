import * as XLSX from "xlsx";

function normalizeSku(v) { return String(v == null ? "" : v).trim().toUpperCase(); }

function normalizeHeader(v) {
  return String(v == null ? "" : v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function finiteNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim().replace(/,/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/* The report renames some columns every single day -- "Total on Order
   8/10/2026" carries the run date -- so columns are matched by prefix
   rather than by an exact string. Mirrors index.html's client-side importer. */
const COLUMN_MAP = [
  ["onOrder",      x => x.startsWith("totalonorder")],
  ["pastDue",      x => x.startsWith("orderspastdue")],
  ["openTransfer", x => x.startsWith("opentransfer") || x.startsWith("openpurchased")],
  ["dueThisWeek",  x => x.startsWith("ordersduethisweek") || x === "thisweekorders"],
  ["dueNextWeek",  x => x.startsWith("ordersduenextweek") || x === "nextweekorders"],
  ["due2Weeks",    x => x.startsWith("ordersdue2weeks")  || x === "2weeksoutorders"],
  ["due3Weeks",    x => x.startsWith("ordersdue3weeks")  || x === "3weeksoutorders"],
  ["shipMonth",    x => x.startsWith("monthlyshipments") || x === "shipmonthqty"],
  ["shipYear",     x => x.startsWith("totalshipments")   || x === "shipyearqty"],
  ["barcode",      x => x === "barcode" || x === "upc" || x === "itemnumber" || x === "itemcode"],
];

function findHeader(rows) {
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const norm = row.map(normalizeHeader);
    const at = pred => norm.findIndex(typeof pred === "function" ? pred : (x => x === pred));

    let kind = null, sku = -1, inv = -1;
    if ((sku = at("fg")) >= 0 && (inv = at("totalinventoryonhand")) >= 0) kind = "fg";
    else if ((sku = at("part")) >= 0 && (inv = at("onhand")) >= 0) kind = "worksheet";
    else continue;

    const h = {
      row: r, kind, fg: sku, inv,
      description: at("description"),
      productGroup: at("productgroup"),
      branding: at("branding"),
      fgType: at("fgtype"),
      abc: at(x => x === "abcn" || x === "abc"),
    };
    COLUMN_MAP.forEach(([field, pred]) => { h[field] = at(pred); });
    return h;
  }
  return null;
}

function cell(row, index) { return index >= 0 ? finiteNumber(row[index]) : null; }
function text(row, index) { return index >= 0 ? String(row[index] == null ? "" : row[index]).trim() : ""; }

function parseReportDate(fileName) {
  const name = String(fileName || "");
  const build = (mm, dd, yy) => {
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0)).toISOString();
  };
  const sep = name.match(/(?:^|[^\d])(\d{1,2})[-_./](\d{1,2})[-_./](\d{4})(?:\D|$)/);
  if (sep) return build(+sep[1], +sep[2], +sep[3]);
  const run = name.match(/(?:^|[^\d])(\d{7,8})(?:\D|$)/);
  if (run) {
    const digits = run[1].padStart(8, "0");
    return build(+digits.slice(0, 2), +digits.slice(2, 4), +digits.slice(4));
  }
  return null;
}

/** Parses a TGU FG Report workbook (same format the in-app importer accepts)
    from a raw Buffer and returns the same shaped state the client stores. */
export function parseInventoryWorkbook(buffer, fileName) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const items = Object.create(null);
  const sourceSheets = [];
  const conflicts = [];
  let invalidInventory = 0;

  const sheets = wb.SheetNames
    .map(name => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      return { name, rows, h: findHeader(rows) };
    })
    .filter(s => s.h)
    .sort((a, b) => (a.h.kind === "fg" ? 0 : 1) - (b.h.kind === "fg" ? 0 : 1));

  sheets.forEach(({ name: sheetName, rows, h }) => {
    sourceSheets.push(sheetName);
    for (let r = h.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const sku = normalizeSku(row[h.fg]);
      if (!sku) continue;
      const qty = finiteNumber(row[h.inv]);
      if (qty == null) invalidInventory++;
      const entry = {
        onHand: qty,
        description: text(row, h.description),
        productGroup: text(row, h.productGroup),
        branding: text(row, h.branding),
        fgType: text(row, h.fgType),
        abc: text(row, h.abc).toUpperCase(),
        barcode: text(row, h.barcode),
        onOrder: cell(row, h.onOrder),
        pastDue: cell(row, h.pastDue),
        openTransfer: cell(row, h.openTransfer),
        dueThisWeek: cell(row, h.dueThisWeek),
        dueNextWeek: cell(row, h.dueNextWeek),
        due2Weeks: cell(row, h.due2Weeks),
        due3Weeks: cell(row, h.due3Weeks),
        shipMonth: cell(row, h.shipMonth),
        shipYear: cell(row, h.shipYear),
        sourceSheet: sheetName,
        sourceKind: h.kind,
      };
      const seen = items[sku];
      if (seen) {
        const bothKnown = seen.onHand != null && entry.onHand != null;
        if (seen.sourceKind === entry.sourceKind && bothKnown && seen.onHand !== entry.onHand) {
          conflicts.push({ sku, first: seen.onHand, second: entry.onHand, sheet: sheetName });
        }
        if (seen.onHand == null && entry.onHand != null) seen.onHand = entry.onHand;
        continue;
      }
      items[sku] = entry;
    }
  });

  if (!sourceSheets.length) throw Object.assign(new Error("missing_headers"), { status: 422 });

  return {
    version: 2,
    fileName: fileName || "inventory.xlsx",
    importedAt: new Date().toISOString(),
    reportDate: parseReportDate(fileName),
    sourceSheets,
    rowCount: Object.keys(items).length,
    invalidInventory,
    conflicts: conflicts.length,
    items,
  };
}
