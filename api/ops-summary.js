import { requireUser } from "./_lib/auth.js";
import { getMeta, rest } from "./_lib/db.js";
import { json, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    try {
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
    } catch (error) { return errorResponse(error); }
  },
};
