import { createSession, hashAccessCode, normalizeUsername, requireEditor, requireUser, sessionCookie, verifyAccessCode, clearSessionCookie, readSession } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";
import { esc, parseRecipients, sendMail } from "./_lib/email.js";

/* This file combines login, logout, me and users -- four small, related
   auth endpoints -- into one Vercel Function. The Hobby plan caps a
   deployment at 12 Serverless Functions; vercel.json rewrites the old
   /api/login, /api/logout, /api/me and /api/users paths here with a
   ?route= query param so the public API is unchanged. */

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

function backendReady() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const secret = process.env.SESSION_SECRET || "";
  return !!(url && key && secret.length >= 32);
}

async function handleLogin(request) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const body = await readJson(request, 20_000);
  const name = String(body.name || "").trim();
  const code = String(body.code || "");
  if (!name || !code) return json({ error: "invalid_credentials" }, 401);
  const username = normalizeUsername(name);
  const { data } = await rest("yard_users", `username=eq.${encodeURIComponent(username)}&active=eq.true&select=*`);
  let user = Array.isArray(data) ? data[0] : null;
  if (!user) user = await bootstrapIfEmpty(name, code);
  if (!user || !verifyAccessCode(code, user.access_code_hash)) return json({ error: "invalid_credentials" }, 401);

  await rest("yard_users", `id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", body: { last_login_at: new Date().toISOString() }, headers: { prefer: "return=minimal" } });
  const token = createSession(user);
  await audit({ name: user.display_name || user.username, role: user.role }, "login", "session", user.id);
  return json({ role: user.role, name: user.display_name || user.username }, 200, { "set-cookie": sessionCookie(token) });
}

// Self-signup, always as "viewer" -- editor accounts stay admin-created
// (via handleUsers) so only the people already trusted with reviewing and
// emailing alerts can hand that access to someone else. A viewer can file
// reports but nothing that requireEditor gates (resolve, email, users...).
async function handleSignup(request) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  if (!backendReady()) return json({ error: "backend_not_configured" }, 503);
  const body = await readJson(request, 20_000);
  const name = String(body.name || "").trim().slice(0, 160);
  const code = String(body.code || "");
  if (!name) return json({ error: "missing_name" }, 400);
  if (code.length < 4) return json({ error: "code_too_short" }, 400);
  const username = normalizeUsername(name);
  const { data: existing } = await rest("yard_users", `username=eq.${encodeURIComponent(username)}&select=id&limit=1`);
  if (Array.isArray(existing) && existing.length) return json({ error: "name_taken" }, 409);

  const { data } = await rest("yard_users", "", {
    method: "POST",
    body: { username, display_name: name, access_code_hash: hashAccessCode(code), role: "viewer", active: true },
    headers: { prefer: "return=representation" },
  });
  const user = data?.[0];
  if (!user) return json({ error: "signup_failed" }, 500);
  await audit({ name, role: "viewer" }, "user_signed_up", "user", user.id);

  try {
    const to = parseRecipients(process.env.ALERT_SUMMARY_RECIPIENTS);
    if (to.length) {
      await sendMail({
        to,
        subject: `[Tarter Yard Map] Nuevo operador registrado: ${name}`,
        html: `<p><strong>${esc(name)}</strong> se registró como operador (rol: viewer) en Tarter Yard Map. Puede reportar problemas del yard, pero no puede resolver alertas, enviarlas por correo ni administrar usuarios.</p>`,
      });
    }
  } catch (e) { /* the account exists either way -- the notification is best-effort */ }

  const token = createSession(user);
  return json({ role: user.role, name: user.display_name || user.username }, 200, { "set-cookie": sessionCookie(token) });
}

async function handleLogout(request) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const s = readSession(request);
  if (s) await audit(s, "logout", "session", s.uid);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

async function handleMe(request) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  if (!backendReady()) return json({ error: "backend_not_configured" }, 503);
  const user = await requireUser(request);
  return json({ role: user.role, name: user.name });
}

const safeUser = (u) => ({ id: u.id, username: u.username, name: u.display_name || u.username, role: u.role, active: u.active, lastLoginAt: u.last_login_at, createdAt: u.created_at });

async function handleUsers(request) {
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
}

export default {
  async fetch(request) {
    try {
      const route = new URL(request.url).searchParams.get("route") || "login";
      if (route === "login") return await handleLogin(request);
      if (route === "signup") return await handleSignup(request);
      if (route === "logout") return await handleLogout(request);
      if (route === "me") return await handleMe(request);
      if (route === "users") return await handleUsers(request);
      return json({ error: "unknown_route" }, 404);
    } catch (error) { return errorResponse(error); }
  },
};
