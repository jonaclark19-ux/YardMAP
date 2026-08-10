import { requireEditor, requireUser } from "./_lib/auth.js";
import { getMeta, rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { alertToClient, mapAlertInput } from "./_lib/models.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

async function recurrenceMap(days = 30) {
  try {
    const rows = await rpc("yard_alert_recurrence", { p_days: days });
    return new Map((rows || []).map((r) => [String(r.sku || ""), Number(r.report_count || 0)]));
  } catch { return new Map(); }
}

async function getAlerts() {
  const { data } = await rest("alerts", "select=*&order=created_at.desc&limit=400");
  const rec = await recurrenceMap(30);
  return (data || []).map((a) => alertToClient(a, rec.get(String(a.sku || "")) || 0));
}

export default {
  async fetch(request) {
    try {
      if (request.method === "GET") {
        await requireUser(request);
        const [meta, items] = await Promise.all([getMeta(), getAlerts()]);
        return json({ rev: Number(meta?.alerts_rev || 0), items });
      }

      if (request.method === "POST") {
        const user = await requireUser(request);
        const body = await readJson(request, 6_000_000);
        const input = mapAlertInput(body.alert || {});
        const { data } = await rest("alerts", "", {
          method: "POST",
          body: {
            ...input,
            status: "new",
            by_name: user.name,
            by_role: user.role,
          },
          headers: { prefer: "return=representation" },
        });
        const created = data?.[0];
        const revRows = await rpc("yard_bump_alerts_rev");
        const rev = Number(Array.isArray(revRows) ? revRows[0]?.alerts_rev : revRows?.alerts_rev) || 0;
        await audit(user, "alert_created", "alert", created?.id, { type: created?.type, sku: created?.sku, priority: created?.priority });
        return json({ rev, alert: alertToClient(created) }, 201);
      }

      if (request.method === "PATCH") {
        const user = await requireEditor(request);
        const body = await readJson(request, 50_000);
        const id = String(body.id || "");
        if (!id) return json({ error: "missing_id" }, 400);

        if (body.remove) {
          await rest("alerts", `id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
          const revRows = await rpc("yard_bump_alerts_rev");
          const rev = Number(Array.isArray(revRows) ? revRows[0]?.alerts_rev : revRows?.alerts_rev) || 0;
          await audit(user, "alert_deleted", "alert", id);
          const items = await getAlerts();
          return json({ rev, items });
        }

        const patch = { updated_at: new Date().toISOString() };
        if (["new", "acknowledged", "in_progress", "resolved"].includes(body.status)) {
          patch.status = body.status;
          if (body.status === "acknowledged") patch.acknowledged_at = new Date().toISOString();
          if (body.status === "in_progress") patch.in_progress_at = new Date().toISOString();
          if (body.status === "resolved") {
            patch.resolved_at = new Date().toISOString();
            patch.resolved_by = user.name;
          } else {
            patch.resolved_at = null;
            patch.resolved_by = null;
          }
        }
        if (["low", "normal", "high", "critical"].includes(body.priority)) patch.priority = body.priority;
        if (body.assignedTo !== undefined) patch.assigned_to = String(body.assignedTo || "").trim().slice(0, 160) || null;
        if (body.photoUrl !== undefined) patch.photo_url = String(body.photoUrl || "").trim().slice(0, 2000) || null;

        await rest("alerts", `id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
          headers: { prefer: "return=minimal" },
        });
        const revRows = await rpc("yard_bump_alerts_rev");
        const rev = Number(Array.isArray(revRows) ? revRows[0]?.alerts_rev : revRows?.alerts_rev) || 0;
        await audit(user, "alert_updated", "alert", id, patch);
        const items = await getAlerts();
        return json({ rev, items });
      }

      return methodNotAllowed(["GET", "POST", "PATCH"]);
    } catch (error) { return errorResponse(error); }
  },
};
