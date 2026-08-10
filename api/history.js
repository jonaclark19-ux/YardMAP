import { requireEditor } from "./_lib/auth.js";
import { rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    try {
      const user = await requireEditor(request);
      if (request.method === "GET") {
        const { data } = await rest("map_history", "select=id,rev,updated_by,updated_at,action&order=id.desc&limit=100");
        return json({ items: data || [] });
      }
      if (request.method === "POST") {
        const body = await readJson(request, 20_000);
        const historyId = Number(body.historyId || 0);
        if (!historyId) return json({ error: "missing_history_id" }, 400);
        const rows = await rpc("yard_restore_map", { p_history_id: historyId, p_actor: user.name });
        const result = Array.isArray(rows) ? rows[0] : rows;
        if (!result?.ok) return json({ error: "history_not_found" }, 404);
        await audit(user, "map_restored", "map_history", historyId, { rev: result.rev });
        return json({ ok: true, rev: Number(result.rev), data: result.data });
      }
      return methodNotAllowed(["GET", "POST"]);
    } catch (error) { return errorResponse(error); }
  },
};
