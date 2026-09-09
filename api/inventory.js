import { requireUser } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { json, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    try {
      await requireUser(request);
      const { data } = await rest("inventory_state", "id=eq.yard&select=rev,data,updated_at");
      const row = Array.isArray(data) ? data[0] : null;
      return json({ rev: Number(row?.rev || 0), data: row?.data || null, updatedAt: row?.updated_at || null });
    } catch (error) { return errorResponse(error); }
  },
};
