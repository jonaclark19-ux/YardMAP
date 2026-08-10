import { requireEditor, requireUser } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    try {
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
    } catch (error) { return errorResponse(error); }
  },
};
