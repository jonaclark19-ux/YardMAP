import { requireEditor } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { json, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    try {
      await requireEditor(request);
      const { data } = await rest("audit_log", "select=*&order=id.desc&limit=150");
      return json({ items: data || [] });
    } catch (error) { return errorResponse(error); }
  },
};
