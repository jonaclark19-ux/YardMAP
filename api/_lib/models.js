import { cleanPhotoUrls } from "./photos.js";

export function alertToClient(a, recurringCount = undefined) {
  // The client payload rides first so every V2 field (opsVersion, quantity,
  // reason, disposition, the inventory comparison, the timeline, the owner)
  // survives the round trip. The dedicated columns are written over it, because
  // status, timestamps and priority are the server's to decide -- a stale copy
  // inside the payload must never win.
  const out = {
    ...(a.payload && typeof a.payload === "object" ? a.payload : {}),
    id: a.id,
    type: a.type,
    sku: a.sku,
    rawCode: a.raw_code,
    note: a.note,
    status: a.status,
    priority: a.priority || "normal",
    assignedTo: a.assigned_to,
    by: a.by_name,
    role: a.by_role,
    createdAt: a.created_at,
    acknowledgedAt: a.acknowledged_at,
    inProgressAt: a.in_progress_at,
    resolvedAt: a.resolved_at,
    resolvedBy: a.resolved_by,
    foundAt: a.found_at,
    homeAt: a.home_at,
    homeGroup: a.home_group,
    photoUrl: a.photo_url,
  };
  // photoUrls is the list (up to five); photoUrl stays as the first one for
  // older clients and for the columns that index it. Reports filed before
  // multi-photo only have the column, so it seeds the list.
  const list = cleanPhotoUrls(a.payload && Array.isArray(a.payload.photoUrls) ? a.payload.photoUrls : []);
  if (!list.length && a.photo_url) list.push(a.photo_url);
  out.photoUrls = list;
  out.photoUrl = list[0] || a.photo_url || null;
  if (list.length) out.hasPhoto = true;
  if (recurringCount !== undefined) out.recurringCount = recurringCount;
  return out;
}

const PAYLOAD_MAX_BYTES = 120_000;

/* Keep the whole client report, minus anything the server decides for itself,
   so a future field on the form needs no migration. Oversized payloads are
   dropped rather than rejected: losing the extra detail beats losing the
   report. */
function payloadFor(input) {
  if (!input || typeof input !== "object") return null;
  // Photo URLs are never taken from the payload as-is: they are validated and
  // set explicitly by mapAlertInput / the PATCH handler.
  const { status, createdAt, acknowledgedAt, inProgressAt, resolvedAt, resolvedBy,
          by, role, id, photoUrl, photoUrls, ...rest } = input;
  if (!Object.keys(rest).length) return null;
  try {
    const json = JSON.stringify(rest);
    if (!json || Buffer.byteLength(json, "utf8") > PAYLOAD_MAX_BYTES) return null;
    return rest;
  } catch { return null; }
}

export function mapAlertInput(input = {}) {
  const clean = (v, max = 1000) => v == null ? null : String(v).trim().slice(0, max);
  const photos = cleanPhotoUrls(Array.isArray(input.photoUrls) ? input.photoUrls : input.photoUrl);
  let payload = payloadFor(input);
  if (photos.length) payload = { ...(payload || {}), photoUrls: photos };
  return {
    payload,
    type: clean(input.type, 40) || "empty",
    sku: clean(input.sku, 120),
    raw_code: clean(input.rawCode, 200),
    note: clean(input.note, 1200),
    priority: ["low", "normal", "high", "critical"].includes(input.priority) ? input.priority : "normal",
    found_at: input.foundAt && typeof input.foundAt === "object" ? input.foundAt : null,
    home_at: input.homeAt && typeof input.homeAt === "object" ? input.homeAt : null,
    home_group: clean(input.homeGroup, 160),
    photo_url: photos[0] || null,
  };
}

/* Workflow edits (owner, priority note, resolution note, timeline) arrive as a
   partial object and are merged into the stored payload, so one field changing
   never drops the rest of the report. */
export function mergePayload(existing, patch) {
  const base = existing && typeof existing === "object" ? existing : {};
  const add = payloadFor(patch);
  if (!add) return base;
  const merged = { ...base, ...add };
  try {
    if (Buffer.byteLength(JSON.stringify(merged), "utf8") > PAYLOAD_MAX_BYTES) return base;
  } catch { return base; }
  return merged;
}
