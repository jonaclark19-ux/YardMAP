/* Secondary product locations: extra spots where a product was found
   ("additional stock") beyond its assigned tile. They used to live only in
   the localStorage of whichever device filed or approved them, so an
   approval on one phone was invisible on every other device.

   They are now one shared document (shared_docs, key "secondary_locations").
   The functions here are the pure merge rules the API applies to it. */

export const DOC_KEY = "secondary_locations";
export const MAX_ITEMS = 3000;
export const STATUSES = ["observed", "approved", "dismissed"];
// Two sightings of the same SKU closer than this (map units) are one spot.
const NEAR = 35;

const nowIso = () => new Date().toISOString();
const cleanSku = (v) => String(v || "").trim().toUpperCase().slice(0, 120);
const finite = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

function cleanItem(raw, by, forceObserved) {
  if (!raw || typeof raw !== "object") return null;
  const sku = cleanSku(raw.sku);
  const x = finite(raw.x), y = finite(raw.y);
  if (!sku || x == null || y == null) return null;
  const id = /^[A-Za-z0-9_-]{1,64}$/.test(String(raw.id || "")) ? String(raw.id) : `loc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const status = forceObserved ? "observed" : (STATUSES.includes(raw.status) ? raw.status : "observed");
  const qty = raw.qty == null || raw.qty === "" ? null : (Number.isFinite(Number(raw.qty)) ? Number(raw.qty) : null);
  return {
    id, sku, type: "secondary", status, x, y, qty,
    createdAt: String(raw.createdAt || nowIso()).slice(0, 40),
    createdBy: String(raw.createdBy || by || "").slice(0, 160),
    updatedAt: raw.updatedAt ? String(raw.updatedAt).slice(0, 40) : undefined,
    updatedBy: raw.updatedBy ? String(raw.updatedBy).slice(0, 160) : undefined,
    sourceReportId: raw.sourceReportId ? String(raw.sourceReportId).slice(0, 64) : null,
  };
}

export function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map((i) => cleanItem(i, "", false)).filter(Boolean).slice(-MAX_ITEMS);
}

/** Records a sighting: updates a nearby live spot for the SKU, or adds one. */
export function observe(items, input, by) {
  const list = normalizeItems(items);
  const item = cleanItem({ ...input, status: "observed", createdBy: by }, by, true);
  if (!item) return { items: list, changed: false };
  const near = list.find((l) => l.sku === item.sku && l.status !== "dismissed" && Math.hypot(l.x - item.x, l.y - item.y) < NEAR);
  if (near) {
    near.qty = item.qty ?? near.qty;
    near.updatedAt = nowIso();
    near.updatedBy = by;
    near.sourceReportId = item.sourceReportId || near.sourceReportId;
  } else {
    list.push(item);
  }
  return { items: list.slice(-MAX_ITEMS), changed: true };
}

export function setStatus(items, id, status, by) {
  const list = normalizeItems(items);
  if (!STATUSES.includes(status)) return { items: list, changed: false };
  const loc = list.find((l) => l.id === id);
  if (!loc) return { items: list, changed: false };
  loc.status = status;
  loc.updatedAt = nowIso();
  loc.updatedBy = by;
  return { items: list, changed: true };
}

/* One-time upload of what a device had stored locally before locations were
   shared. Only adds ids the server does not know. A viewer's items always
   arrive as "observed": approving a spot is an editor's call. */
export function importItems(items, incoming, by, isEditor) {
  const list = normalizeItems(items);
  const known = new Set(list.map((l) => l.id));
  let added = 0;
  for (const raw of Array.isArray(incoming) ? incoming.slice(0, 500) : []) {
    const item = cleanItem(raw, by, !isEditor);
    if (!item || known.has(item.id)) continue;
    list.push(item);
    known.add(item.id);
    added++;
  }
  return { items: list.slice(-MAX_ITEMS), changed: added > 0 };
}
