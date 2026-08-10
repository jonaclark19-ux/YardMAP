import { requireEditor } from "./_lib/auth.js";
import { rpc } from "./_lib/db.js";
import { json, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    try {
      await requireEditor(request);
      const url = new URL(request.url);
      const days = Math.max(7, Math.min(90, Number(url.searchParams.get("days") || 30)));
      const rows = await rpc("yard_alert_recurrence", { p_days: days });
      return json({ days, items: (rows || []).filter((r) => Number(r.report_count || 0) >= 2).slice(0, 50) });
    } catch (error) { return errorResponse(error); }
  },
};
