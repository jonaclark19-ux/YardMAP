import { requireEditor, requireUser } from "./_lib/auth.js";
import { rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    try {
      if (request.method === "GET") {
        const user = await requireUser(request);
        const all = new URL(request.url).searchParams.get("all") === "1" && user.role === "editor";
        const query = all ? "select=*&order=created_at.desc&limit=100" : "active=eq.true&select=*&order=created_at.desc&limit=20";
        const { data } = await rest("announcements", query);
        const now = Date.now();
        const items = (data || []).filter((a) => all || ((!a.starts_at || new Date(a.starts_at).getTime() <= now) && (!a.ends_at || new Date(a.ends_at).getTime() > now)));
        return json({ items });
      }
      const editor = await requireEditor(request);
      const body = await readJson(request, 50_000);
      if (request.method === "POST") {
        const message = String(body.message || "").trim().slice(0, 1000);
        if (!message) return json({ error: "missing_message" }, 400);
        const { data } = await rest("announcements", "", {
          method: "POST",
          body: { message, severity: ["info", "warning", "urgent"].includes(body.severity) ? body.severity : "info", active: true, starts_at: body.startsAt || null, ends_at: body.endsAt || null, created_by: editor.name },
          headers: { prefer: "return=representation" },
        });
        await rpc("yard_bump_announcements_rev");
        await audit(editor, "announcement_created", "announcement", data?.[0]?.id, { message });
        return json({ item: data?.[0] }, 201);
      }
      if (request.method === "PATCH") {
        const id = String(body.id || "");
        if (!id) return json({ error: "missing_id" }, 400);
        const patch = { updated_at: new Date().toISOString() };
        if (body.message !== undefined) patch.message = String(body.message || "").trim().slice(0, 1000);
        if (["info", "warning", "urgent"].includes(body.severity)) patch.severity = body.severity;
        if (typeof body.active === "boolean") patch.active = body.active;
        if (body.startsAt !== undefined) patch.starts_at = body.startsAt || null;
        if (body.endsAt !== undefined) patch.ends_at = body.endsAt || null;
        const { data } = await rest("announcements", `id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: patch, headers: { prefer: "return=representation" } });
        await rpc("yard_bump_announcements_rev");
        await audit(editor, "announcement_updated", "announcement", id, { fields: Object.keys(patch) });
        return json({ item: data?.[0] || null });
      }
      return methodNotAllowed(["GET", "POST", "PATCH"]);
    } catch (error) { return errorResponse(error); }
  },
};
