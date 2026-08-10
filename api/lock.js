import { requireEditor, requireUser } from "./_lib/auth.js";
import { rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

async function current() {
  const { data } = await rest("edit_lock", "id=eq.yard&select=*");
  const lock = data?.[0] || null;
  if (!lock || !lock.expires_at || new Date(lock.expires_at).getTime() <= Date.now()) return null;
  return lock;
}

export default {
  async fetch(request) {
    try {
      if (request.method === "GET") {
        await requireUser(request);
        return json({ lock: await current() });
      }
      const editor = await requireEditor(request);
      if (request.method === "POST") {
        const body = await readJson(request, 20_000);
        const action = body.action || "acquire";
        if (action === "release") {
          await rpc("yard_release_lock", { p_session_id: editor.sid });
          await audit(editor, "edit_lock_released", "lock", "yard");
          return json({ ok: true, lock: await current() });
        }
        const rows = await rpc("yard_acquire_lock", { p_holder: editor.name, p_session_id: editor.sid });
        const result = Array.isArray(rows) ? rows[0] : rows;
        if (!result?.ok) return json({ error: "locked", lock: result?.lock_data || await current() }, 409);
        return json({ ok: true, lock: result.lock_data || await current() });
      }
      return methodNotAllowed(["GET", "POST"]);
    } catch (error) { return errorResponse(error); }
  },
};
