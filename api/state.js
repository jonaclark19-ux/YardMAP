import { requireEditor, requireUser } from "./_lib/auth.js";
import { getMeta, rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { alertToClient } from "./_lib/models.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

/* Combines the map state endpoint with map history, the edit lock and the
   polling sync endpoint -- four small, related endpoints that together
   with everything else would blow past the Hobby plan's 12-function cap.
   vercel.json rewrites /api/history, /api/lock and /api/sync here with a
   ?route= query param; /api/state itself is unchanged (no route param). */

async function currentState() {
  const { data } = await rest("map_state", "id=eq.yard&select=rev,data,updated_by,updated_at");
  return Array.isArray(data) ? data[0] || { rev: 0, data: null } : { rev: 0, data: null };
}

async function handleState(request) {
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
}

async function handleHistory(request) {
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
}

async function currentLock() {
  const { data } = await rest("edit_lock", "id=eq.yard&select=*");
  const lock = data?.[0] || null;
  if (!lock || !lock.expires_at || new Date(lock.expires_at).getTime() <= Date.now()) return null;
  return lock;
}

async function handleLock(request) {
  if (request.method === "GET") {
    await requireUser(request);
    return json({ lock: await currentLock() });
  }
  const editor = await requireEditor(request);
  if (request.method === "POST") {
    const body = await readJson(request, 20_000);
    const action = body.action || "acquire";
    if (action === "release") {
      await rpc("yard_release_lock", { p_session_id: editor.sid });
      await audit(editor, "edit_lock_released", "lock", "yard");
      return json({ ok: true, lock: await currentLock() });
    }
    const rows = await rpc("yard_acquire_lock", { p_holder: editor.name, p_session_id: editor.sid });
    const result = Array.isArray(rows) ? rows[0] : rows;
    if (!result?.ok) return json({ error: "locked", lock: result?.lock_data || await currentLock() }, 409);
    return json({ ok: true, lock: result.lock_data || await currentLock() });
  }
  return methodNotAllowed(["GET", "POST"]);
}

async function handleSync(request) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
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
}

export default {
  async fetch(request) {
    try {
      const route = new URL(request.url).searchParams.get("route") || "";
      if (route === "history") return await handleHistory(request);
      if (route === "lock") return await handleLock(request);
      if (route === "sync") return await handleSync(request);
      return await handleState(request);
    } catch (error) { return errorResponse(error); }
  },
};
