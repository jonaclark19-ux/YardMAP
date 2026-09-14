import { requireEditor, requireUser } from "./_lib/auth.js";
import { getMeta, rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

/* Combines announcements, shift handoffs, zone status, the ops summary and
   the audit log into one Vercel Function -- five small, related endpoints
   that together with everything else would blow past the Hobby plan's
   12-function cap. vercel.json rewrites their old paths here with a
   ?route= query param so the public API is unchanged. */

async function handleAnnouncements(request) {
  if (request.method === "GET") {
    const user = await requireUser(request);
    const all = new URL(request.url).searchParams.get("all") === "1" && user.role === "editor";
    const query = all ? "select=*&order=created_at.desc&limit=100" : "active=eq.true&select=*&order=created_at.desc&limit=20";
    const { data } = await rest("announcements", query);
    const now = Date.now();
    const items = (data || []).filter((a) => all || ((!a.starts_at || new Date(a.starts_at).getTime() <= now) && (!a.ends_at || new Date(a.ends_at).getTime() > now)));
    return json({ items });
  }
  const editor = await requireEditor(request);
  const body = await readJson(request, 50_000);
  if (request.method === "POST") {
    const message = String(body.message || "").trim().slice(0, 1000);
    if (!message) return json({ error: "missing_message" }, 400);
    const { data } = await rest("announcements", "", {
      method: "POST",
      body: { message, severity: ["info", "warning", "urgent"].includes(body.severity) ? body.severity : "info", active: true, starts_at: body.startsAt || null, ends_at: body.endsAt || null, created_by: editor.name },
      headers: { prefer: "return=representation" },
    });
    await rpc("yard_bump_announcements_rev");
    await audit(editor, "announcement_created", "announcement", data?.[0]?.id, { message });
    return json({ item: data?.[0] }, 201);
  }
  if (request.method === "PATCH") {
    const id = String(body.id || "");
    if (!id) return json({ error: "missing_id" }, 400);
    const patch = { updated_at: new Date().toISOString() };
    if (body.message !== undefined) patch.message = String(body.message || "").trim().slice(0, 1000);
    if (["info", "warning", "urgent"].includes(body.severity)) patch.severity = body.severity;
    if (typeof body.active === "boolean") patch.active = body.active;
    if (body.startsAt !== undefined) patch.starts_at = body.startsAt || null;
    if (body.endsAt !== undefined) patch.ends_at = body.endsAt || null;
    const { data } = await rest("announcements", `id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: patch, headers: { prefer: "return=representation" } });
    await rpc("yard_bump_announcements_rev");
    await audit(editor, "announcement_updated", "announcement", id, { fields: Object.keys(patch) });
    return json({ item: data?.[0] || null });
  }
  return methodNotAllowed(["GET", "POST", "PATCH"]);
}

async function handleHandoff(request) {
  if (request.method === "GET") {
    await requireUser(request);
    const { data } = await rest("shift_handoffs", "select=*&order=created_at.desc&limit=30");
    return json({ items: data || [] });
  }
  if (request.method === "POST") {
    const editor = await requireEditor(request);
    const body = await readJson(request, 30_000);
    const summary = String(body.summary || "").trim().slice(0, 1800);
    if (!summary) return json({ error: "missing_summary" }, 400);
    const { data: openAlerts } = await rest("alerts", "status=neq.resolved&select=id");
    const row = { shift_label: String(body.shiftLabel || "Shift handoff").trim().slice(0, 120), summary, open_alerts_count: (openAlerts || []).length, created_by: editor.name };
    const { data } = await rest("shift_handoffs", "", { method: "POST", body: row, headers: { prefer: "return=representation" } });
    await audit(editor, "shift_handoff_created", "handoff", data?.[0]?.id, { openAlerts: row.open_alerts_count });
    return json({ item: data?.[0] || row }, 201);
  }
  return methodNotAllowed(["GET", "POST"]);
}

async function handleZones(request) {
  if (request.method === "GET") {
    await requireUser(request);
    const { data } = await rest("zone_status", "select=*&order=zone_key.asc");
    return json({ items: data || [] });
  }
  const editor = await requireEditor(request);
  if (request.method === "POST" || request.method === "PATCH") {
    const body = await readJson(request, 30_000);
    const zoneKey = String(body.zoneKey || "").trim().slice(0, 160);
    if (!zoneKey) return json({ error: "missing_zone" }, 400);
    const status = ["active", "restricted", "temporary", "maintenance"].includes(body.status) ? body.status : "active";
    const row = { zone_key: zoneKey, status, note: String(body.note || "").trim().slice(0, 800) || null, updated_by: editor.name, updated_at: new Date().toISOString() };
    const { data } = await rest("zone_status", "on_conflict=zone_key", { method: "POST", body: row, headers: { prefer: "resolution=merge-duplicates,return=representation" } });
    await audit(editor, "zone_status_updated", "zone", zoneKey, { status, note: row.note });
    return json({ item: data?.[0] || row });
  }
  return methodNotAllowed(["GET", "POST", "PATCH"]);
}

async function handleSummary(request) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  const user = await requireUser(request);
  const nowIso = new Date().toISOString();
  const [meta, { data: announcements }, { data: zones }, { data: handoffs }, { data: lockRows }] = await Promise.all([
    getMeta(),
    rest("announcements", "active=eq.true&select=*&order=created_at.desc&limit=20"),
    rest("zone_status", "select=*&order=zone_key.asc"),
    rest("shift_handoffs", "select=*&order=created_at.desc&limit=5"),
    rest("edit_lock", "id=eq.yard&select=*"),
  ]);
  const activeAnnouncements = (announcements || []).filter((a) => (!a.starts_at || a.starts_at <= nowIso) && (!a.ends_at || a.ends_at > nowIso));
  let lock = lockRows?.[0] || null;
  if (lock?.expires_at && new Date(lock.expires_at).getTime() <= Date.now()) lock = null;
  return json({ role: user.role, announcements: activeAnnouncements, zones: zones || [], handoffs: handoffs || [], lock, revisions: { announcements: Number(meta?.announcements_rev || 0), verifications: Number(meta?.verifications_rev || 0) } });
}

async function handleAudit(request) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  await requireEditor(request);
  const { data } = await rest("audit_log", "select=*&order=id.desc&limit=150");
  return json({ items: data || [] });
}

export default {
  async fetch(request) {
    try {
      const route = new URL(request.url).searchParams.get("route") || "";
      if (route === "announcements") return await handleAnnouncements(request);
      if (route === "handoff") return await handleHandoff(request);
      if (route === "zones") return await handleZones(request);
      if (route === "summary") return await handleSummary(request);
      if (route === "audit") return await handleAudit(request);
      return json({ error: "unknown_route" }, 404);
    } catch (error) { return errorResponse(error); }
  },
};
