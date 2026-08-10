import { requireEditor, requireUser } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    try {
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
    } catch (error) { return errorResponse(error); }
  },
};
