import { requireUser } from "./_lib/auth.js";
import { getMeta, rest } from "./_lib/db.js";
import { alertToClient } from "./_lib/models.js";
import { json, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    try {
      await requireUser(request);
      const url = new URL(request.url);
      const srev = Number(url.searchParams.get("srev") || 0);
      const arev = Number(url.searchParams.get("arev") || 0);
      const [{ data: stateRows }, meta] = await Promise.all([
        rest("map_state", "id=eq.yard&select=rev,data,updated_by,updated_at"),
        getMeta(),
      ]);
      const state = stateRows?.[0] || { rev: 0, data: null };
      const serverSrev = Number(state.rev || 0);
      const serverArev = Number(meta?.alerts_rev || 0);
      const out = { srev: serverSrev, arev: serverArev };
      if (serverSrev !== srev) out.state = { rev: serverSrev, data: state.data, updatedBy: state.updated_by, updatedAt: state.updated_at };
      if (serverArev !== arev) {
        const { data } = await rest("alerts", "select=*&order=created_at.desc&limit=400");
        out.alerts = { rev: serverArev, items: (data || []).map((a) => alertToClient(a)) };
      }
      return json(out);
    } catch (error) { return errorResponse(error); }
  },
};
