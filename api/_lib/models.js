export function alertToClient(a, recurringCount = undefined) {
  const out = {
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
  };
}
