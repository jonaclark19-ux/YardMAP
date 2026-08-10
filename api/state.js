import { requireEditor, requireUser } from "./_lib/auth.js";
import { rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

async function currentState() {
  const { data } = await rest("map_state", "id=eq.yard&select=rev,data,updated_by,updated_at");
  return Array.isArray(data) ? data[0] || { rev: 0, data: null } : { rev: 0, data: null };
}

export default {
  async fetch(request) {
    try {
      if (request.method === "GET") {
        await requireUser(request);
        const state = await currentState();
        return json({ rev: Number(state.rev || 0), data: state.data, updatedBy: state.updated_by, updatedAt: state.updated_at });
      }
      if (request.method === "PUT") {
        const user = await requireEditor(request);
        const body = await readJson(request, 5_500_000);
        if (!body.data || !Array.isArray(body.data.tiles)) return json({ error: "invalid_map" }, 400);
        const rows = await rpc("yard_save_map", {
          p_expected_rev: Number(body.rev || 0),
          p_data: body.data,
          p_actor: user.name,
        });
        const result = Array.isArray(rows) ? rows[0] : rows;
        if (!result?.ok) return json({ error: "revision_conflict", rev: Number(result?.rev || 0), data: result?.data || null }, 409);
        await audit(user, "map_saved", "map", "yard", { rev: Number(result.rev || 0) });
        return json({ rev: Number(result.rev), data: result.data });
      }
      return methodNotAllowed(["GET", "PUT"]);
    } catch (error) { return errorResponse(error); }
  },
};
