import { timingSafeEqual } from "node:crypto";
import { createSession, hashAccessCode, normalizeUsername, requireEditor, requireUser, sessionCookie, verifyAccessCode, clearSessionCookie, readSession } from "./_lib/auth.js";
import { LIMITS, assertNotLimited, clearHits, clientIp, recordHit } from "./_lib/ratelimit.js";
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
  // Per name, so one account cannot be walked through its code space; per IP,
  // so one client cannot spread the same attack across many names.
  const limits = [
    { key: `login:${username}`, limit: LIMITS.loginName },
    { key: `login-ip:${clientIp(request)}`, limit: LIMITS.loginIp },
  ];
  await assertNotLimited(limits);
  const { data } = await rest("yard_users", `username=eq.${encodeURIComponent(username)}&active=eq.true&select=*`);
  let user = Array.isArray(data) ? data[0] : null;
  if (!user) user = await bootstrapIfEmpty(name, code);
  if (!user || !verifyAccessCode(code, user.access_code_hash)) {
    await recordHit(limits);
    return json({ error: "invalid_credentials" }, 401);
  }
  await clearHits([limits[0].key]);

  await rest("yard_users", `id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", body: { last_login_at: new Date().toISOString() }, headers: { prefer: "return=minimal" } });
  const token = createSession(user);
  await audit({ name: user.display_name || user.username, role: user.role }, "login", "session", user.id);
  return json({ role: user.role, name: user.display_name || user.username, onboarded: !!user.onboarded_at }, 200, { "set-cookie": sessionCookie(token) });
}

/* Invite codes decide who can sign up and as what:
   - SIGNUP_INVITE_CODE: signs up a viewer (operator). Unset, viewer signup
     is open to anyone who finds the URL.
   - SIGNUP_EDITOR_INVITE_CODE: signs up an editor directly. Unset, editors
     can only be made in the Control Center. Whoever holds it gets full
     admin rights, so it goes only to the people who should have them.
   - SIGNUP_DISABLED=1 closes signup entirely.
   Codes are compared in constant time. */
function sameCode(given, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(given || "").trim());
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function inviteRole(given, env = process.env) {
  if (sameCode(given, env.SIGNUP_EDITOR_INVITE_CODE)) return "editor";
  if (!env.SIGNUP_INVITE_CODE) return "viewer";
  return sameCode(given, env.SIGNUP_INVITE_CODE) ? "viewer" : null;
}

export function signupPolicy(env = process.env) {
  if (env.SIGNUP_DISABLED === "1") return "closed";
  return env.SIGNUP_INVITE_CODE ? "invite" : "open";
}

// Self-signup: a viewer, or an editor when the editor invite code is used
// (see inviteRole). Without that code, editor accounts stay admin-created
// (via handleUsers) so only the people already trusted with reviewing and
// emailing alerts can hand that access to someone else. A viewer can file
// reports but nothing that requireEditor gates (resolve, email, users...).
async function handleSignup(request) {
  // GET tells the login screen which signup form to draw (open, invite code
  // field, or none) without anyone having to try and fail first.
  if (request.method === "GET") return json({ signup: signupPolicy(), editorInvite: !!process.env.SIGNUP_EDITOR_INVITE_CODE });
  if (request.method !== "POST") return methodNotAllowed(["GET", "POST"]);
  if (!backendReady()) return json({ error: "backend_not_configured" }, 503);
  if (signupPolicy() === "closed") return json({ error: "signup_closed" }, 403);
  const body = await readJson(request, 20_000);
  const name = String(body.name || "").trim().slice(0, 80);
  const code = String(body.code || "");
  const ipLimit = [{ key: `signup-ip:${clientIp(request)}`, limit: LIMITS.signupIp }];
  await assertNotLimited(ipLimit);
  // Counted before any answer that reveals something (a taken name, a wrong
  // invite), so the endpoint cannot be used to list who has an account.
  await recordHit(ipLimit);
  const role = inviteRole(body.invite);
  if (!role) return json({ error: "invalid_invite" }, 403);
  if (!name) return json({ error: "missing_name" }, 400);
  const username = normalizeUsername(name);
  const { data: existing } = await rest("yard_users", `username=eq.${encodeURIComponent(username)}&select=id&limit=1`);
  if (Array.isArray(existing) && existing.length) return json({ error: "name_taken" }, 409);

  let data;
  try {
    ({ data } = await rest("yard_users", "", {
      method: "POST",
      body: { username, display_name: name, access_code_hash: hashAccessCode(code), role, active: true },
      headers: { prefer: "return=representation" },
    }));
  } catch (e) {
    if (e?.status === 409) return json({ error: "name_taken" }, 409);
    throw e;
  }
  const user = data?.[0];
  if (!user) return json({ error: "signup_failed" }, 500);
  await audit({ name, role }, "user_signed_up", "user", user.id, { role, via: role === "editor" ? "editor_invite" : "invite" });

  try {
    const to = parseRecipients(process.env.ALERT_SUMMARY_RECIPIENTS);
    if (to.length) {
      await sendMail({
        to,
        subject: role === "editor"
          ? `[Tarter Yard Map] Nuevo EDITOR registrado: ${name}`
          : `[Tarter Yard Map] Nuevo operador registrado: ${name}`,
        html: role === "editor"
          ? `<p><strong>${esc(name)}</strong> se registró como <strong>editor</strong> en Tarter Yard Map usando el código de invitación de editor. Puede resolver reportes, enviarlos por correo, editar el mapa y administrar usuarios. Si no lo esperabas, desactívalo en Centro de Control → Usuarios.</p>`
          : `<p><strong>${esc(name)}</strong> se registró como operador (rol: viewer) en Tarter Yard Map. Puede reportar problemas del yard, pero no puede resolver alertas, enviarlas por correo ni administrar usuarios.</p>`,
      });
    }
  } catch (e) { /* the account exists either way -- the notification is best-effort */ }

  const token = createSession(user);
  return json({ role: user.role, name: user.display_name || user.username, onboarded: false }, 200, { "set-cookie": sessionCookie(token) });
}

async function handleLogout(request) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const s = readSession(request);
  if (s) await audit(s, "logout", "session", s.uid);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

async function handleMe(request) {
  if (!backendReady()) return json({ error: "backend_not_configured" }, 503);
  if (request.method === "GET") {
    const user = await requireUser(request);
    return json({ role: user.role, name: user.name, onboarded: !!user.onboarded });
  }
  if (request.method === "PATCH") {
    const user = await requireUser(request);
    const body = await readJson(request, 5_000);
    if (body.onboarded === true) {
      await rest("yard_users", `id=eq.${encodeURIComponent(user.uid)}`, { method: "PATCH", body: { onboarded_at: new Date().toISOString() }, headers: { prefer: "return=minimal" } });
    }
    return json({ ok: true });
  }
  return methodNotAllowed(["GET", "PATCH"]);
}

const safeUser = (u) => ({ id: u.id, username: u.username, name: u.display_name || u.username, role: u.role, active: u.active, lastLoginAt: u.last_login_at, createdAt: u.created_at });

async function handleUsers(request) {
  const editor = await requireEditor(request);
  if (request.method === "GET") {
    const { data } = await rest("yard_users", "select=id,username,display_name,role,active,last_login_at,created_at&order=display_name.asc");
    return json({ items: (data || []).map((u) => ({ ...safeUser(u), self: u.id === editor.uid })) });
  }
  if (request.method === "POST") {
    const body = await readJson(request, 30_000);
    const name = String(body.name || "").trim();
    const code = String(body.code || "");
    const role = body.role === "editor" ? "editor" : "viewer";
    if (!name) return json({ error: "missing_name" }, 400);
    let data;
    try {
      ({ data } = await rest("yard_users", "", {
        method: "POST",
        body: { username: normalizeUsername(name), display_name: name, access_code_hash: hashAccessCode(code), role, active: true },
        headers: { prefer: "return=representation" },
      }));
    } catch (e) {
      if (e?.status === 409) return json({ error: "name_taken" }, 409);
      throw e;
    }
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
    // Nobody can take away the last editor's access -- not even that editor
    // -- because there would be no one left to give it back.
    if (patch.active === false && id === editor.uid) return json({ error: "cannot_deactivate_self" }, 400);
    if (patch.role === "viewer" || patch.active === false) {
      const { data: editors } = await rest("yard_users", "role=eq.editor&active=eq.true&select=id");
      const others = (editors || []).filter((u) => u.id !== id);
      if ((editors || []).some((u) => u.id === id) && others.length === 0) return json({ error: "last_editor" }, 400);
    }
    let data;
    try {
      ({ data } = await rest("yard_users", `id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
        headers: { prefer: "return=representation" },
      }));
    } catch (e) {
      if (e?.status === 409) return json({ error: "name_taken" }, 409);
      throw e;
    }
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
