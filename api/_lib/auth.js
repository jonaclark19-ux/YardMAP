import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { rest } from "./db.js";

export const COOKIE_NAME = "tarter_yard_session";
const SESSION_TTL_SEC = 60 * 60 * 12;

function secret() {
  const s = process.env.SESSION_SECRET || "";
  if (s.length < 32) throw Object.assign(new Error("session_secret_not_configured"), { status: 503 });
  return s;
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(input) {
  return createHmac("sha256", secret()).update(input).digest("base64url");
}

export function createSession(user) {
  const payload = {
    uid: user.id,
    name: user.display_name || user.username,
    username: user.username,
    role: user.role,
    sid: randomBytes(12).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function parseCookies(request) {
  const raw = request.headers.get("cookie") || "";
  const out = {};
  raw.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export function readSession(request) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function requireUser(request) {
  const session = readSession(request);
  if (!session) throw Object.assign(new Error("unauthorized"), { status: 401 });
  const { data } = await rest("yard_users", `id=eq.${encodeURIComponent(session.uid)}&active=eq.true&select=id,username,display_name,role,active`, {});
  const user = Array.isArray(data) ? data[0] : null;
  if (!user) throw Object.assign(new Error("unauthorized"), { status: 401 });
  return { ...session, name: user.display_name || user.username, role: user.role };
}

export async function requireEditor(request) {
  const user = await requireUser(request);
  if (user.role !== "editor") throw Object.assign(new Error("forbidden"), { status: 403 });
  return user;
}

export function normalizeUsername(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function hashAccessCode(code) {
  const value = String(code || "");
  if (value.length < 4) throw Object.assign(new Error("code_too_short"), { status: 400 });
  const salt = randomBytes(16);
  const hash = scryptSync(value, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyAccessCode(code, stored) {
  try {
    const [kind, saltHex, hashHex] = String(stored || "").split("$");
    if (kind !== "scrypt" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(String(code || ""), Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
