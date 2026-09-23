/* The fields that live in their own columns. Anything else a report carries —
   quantity, physical count, variance, reason, the status timeline — travels in
   `details`, so a newer report shape survives the round trip instead of being
   cut down to the columns the first version of the app knew about. */
const CORE_KEYS = new Set([
  "id", "type", "sku", "rawCode", "note", "status", "priority", "assignedTo",
  "by", "role", "createdAt", "acknowledgedAt", "inProgressAt", "resolvedAt",
  "resolvedBy", "foundAt", "homeAt", "homeGroup", "photoUrl", "recurringCount",
]);

/* Who moved a report along the workflow is recorded by the person doing it,
   not claimed up front by whoever filed it. */
const WORKFLOW_KEYS = new Set(["acknowledgedBy", "inProgressBy", "resolutionNote"]);

const MAX_DETAILS_BYTES = 32_000;
const MAX_TIMELINE = 100;

export function cleanDetails(input, { onCreate = false } = {}) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (CORE_KEYS.has(key)) continue;
    if (onCreate && WORKFLOW_KEYS.has(key)) continue;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) continue;
    if (value === undefined || typeof value === "function") continue;
    out[key] = value;
  }
  if (Array.isArray(out.timeline)) out.timeline = out.timeline.slice(-MAX_TIMELINE);
  if (JSON.stringify(out).length > MAX_DETAILS_BYTES) {
    throw Object.assign(new Error("details_too_large"), { status: 413 });
  }
  return out;
}

export function alertToClient(a, recurringCount = undefined) {
  // Details first, columns after: a value stored in `details` can never
  // override the status, the author or the timestamps the server owns.
  const details = a.details && typeof a.details === "object" && !Array.isArray(a.details) ? a.details : {};
  const out = {
    ...details,
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
  if (recurringCount !== undefined) out.recurringCount = recurringCount;
  return out;
}

export function mapAlertInput(input = {}) {
  const clean = (v, max = 1000) => v == null ? null : String(v).trim().slice(0, max);
  return {
    type: clean(input.type, 40) || "empty",
    sku: clean(input.sku, 120),
    raw_code: clean(input.rawCode, 200),
    note: clean(input.note, 1200),
    priority: ["low", "normal", "high", "critical"].includes(input.priority) ? input.priority : "normal",
    found_at: input.foundAt && typeof input.foundAt === "object" ? input.foundAt : null,
    home_at: input.homeAt && typeof input.homeAt === "object" ? input.homeAt : null,
    home_group: clean(input.homeGroup, 160),
    photo_url: clean(input.photoUrl, 2000),
    details: cleanDetails(input, { onCreate: true }),
  };
}
