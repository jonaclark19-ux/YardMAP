import { createSession, hashAccessCode, normalizeUsername, sessionCookie, verifyAccessCode } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

async function bootstrapIfEmpty(name, code) {
  const { data: existing } = await rest("yard_users", "select=id&limit=1");
  if (Array.isArray(existing) && existing.length) return null;
  const bootName = String(process.env.BOOTSTRAP_ADMIN_NAME || "").trim();
  const bootCode = String(process.env.BOOTSTRAP_ADMIN_CODE || "");
  if (!bootName || !bootCode || normalizeUsername(name) !== normalizeUsername(bootName) || code !== bootCode) return null;
  const username = normalizeUsername(name);
  const { data } = await rest("yard_users", "", {
    method: "POST",
    body: { username, display_name: String(name).trim(), access_code_hash: hashAccessCode(code), role: "editor", active: true },
    headers: { prefer: "return=representation" },
  });
  return data?.[0] || null;
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      const body = await readJson(request, 20_000);
      const name = String(body.name || "").trim();
      const code = String(body.code || "");
      if (!name || !code) return json({ error: "invalid_credentials" }, 401);
      const username = normalizeUsername(name);
      const { data } = await rest("yard_users", `username=eq.${encodeURIComponent(username)}&active=eq.true&select=*`);
      let user = Array.isArray(data) ? data[0] : null;
      if (!user) user = await bootstrapIfEmpty(name, code);
      if (!user || !verifyAccessCode(code, user.access_code_hash)) return json({ error: "invalid_credentials" }, 401);

      await rest("yard_users", `id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: { last_login_at: new Date().toISOString() },
        headers: { prefer: "return=minimal" },
      });
      const token = createSession(user);
      await audit({ name: user.display_name || user.username, role: user.role }, "login", "session", user.id);
      return json({ role: user.role, name: user.display_name || user.username }, 200, { "set-cookie": sessionCookie(token) });
    } catch (error) { return errorResponse(error); }
  },
};
