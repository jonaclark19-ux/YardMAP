import { hashAccessCode, normalizeUsername, requireEditor } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

const safeUser = (u) => ({ id: u.id, username: u.username, name: u.display_name || u.username, role: u.role, active: u.active, lastLoginAt: u.last_login_at, createdAt: u.created_at });

export default {
  async fetch(request) {
    try {
      const editor = await requireEditor(request);
      if (request.method === "GET") {
        const { data } = await rest("yard_users", "select=id,username,display_name,role,active,last_login_at,created_at&order=display_name.asc");
        return json({ items: (data || []).map(safeUser) });
      }
      if (request.method === "POST") {
        const body = await readJson(request, 30_000);
        const name = String(body.name || "").trim();
        const code = String(body.code || "");
        const role = body.role === "editor" ? "editor" : "viewer";
        if (!name) return json({ error: "missing_name" }, 400);
        const { data } = await rest("yard_users", "", {
          method: "POST",
          body: { username: normalizeUsername(name), display_name: name, access_code_hash: hashAccessCode(code), role, active: true },
          headers: { prefer: "return=representation" },
        });
        const user = data?.[0];
        await audit(editor, "user_created", "user", user?.id, { name, role });
        return json({ user: safeUser(user) }, 201);
      }
      if (request.method === "PATCH") {
        const body = await readJson(request, 30_000);
        const id = String(body.id || "");
        if (!id) return json({ error: "missing_id" }, 400);
        const patch = {};
        if (body.name !== undefined) {
          const name = String(body.name || "").trim();
          if (!name) return json({ error: "missing_name" }, 400);
          patch.display_name = name;
          patch.username = normalizeUsername(name);
        }
        if (["editor", "viewer"].includes(body.role)) patch.role = body.role;
        if (typeof body.active === "boolean") patch.active = body.active;
        if (body.code !== undefined) patch.access_code_hash = hashAccessCode(String(body.code || ""));
        const { data } = await rest("yard_users", `id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
          headers: { prefer: "return=representation" },
        });
        const user = data?.[0];
        await audit(editor, "user_updated", "user", id, { fields: Object.keys(patch) });
        return json({ user: user ? safeUser(user) : null });
      }
      return methodNotAllowed(["GET", "POST", "PATCH"]);
    } catch (error) { return errorResponse(error); }
  },
};
