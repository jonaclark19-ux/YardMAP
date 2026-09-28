// Auth helpers are pure enough to test without a live Supabase connection:
// session tokens are self-contained (HMAC-signed), and the access-code
// hashing never touches the database. requireUser/requireEditor (which do
// call the database) are exercised indirectly through the API route tests
// once a backend is available; here we lock down the primitives they rely on.
process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-000";

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  normalizeUsername,
  hashAccessCode,
  verifyAccessCode,
  createSession,
  readSession,
  sessionCookie,
  COOKIE_NAME,
} from "../api/_lib/auth.js";

test("normalizeUsername trims, lowercases, and collapses whitespace", () => {
  assert.equal(normalizeUsername("  Javier   Torres "), "javier torres");
  assert.equal(normalizeUsername(""), "");
  assert.equal(normalizeUsername(null), "");
});

test("hashAccessCode rejects codes under 6 characters", () => {
  assert.throws(() => hashAccessCode("abc"), /code_too_short/);
  assert.throws(() => hashAccessCode("abcde"), /code_too_short/);
  assert.ok(hashAccessCode("abcdef").startsWith("scrypt$"));
});

test("a shorter code set before the 6-character rule still verifies", async () => {
  // Built by hand the way the old 4-character minimum allowed.
  const { scryptSync, randomBytes } = await import("node:crypto");
  const salt = randomBytes(16);
  const stored = `scrypt$${salt.toString("hex")}$${scryptSync("1234", salt, 64).toString("hex")}`;
  assert.equal(verifyAccessCode("1234", stored), true);
});

test("hashAccessCode + verifyAccessCode round-trip correctly", () => {
  const hash = hashAccessCode("editor1");
  assert.equal(verifyAccessCode("editor1", hash), true);
  assert.equal(verifyAccessCode("wrongcode", hash), false);
});

test("hashAccessCode salts each call, so identical codes hash differently", () => {
  const a = hashAccessCode("editor1");
  const b = hashAccessCode("editor1");
  assert.notEqual(a, b);
  assert.equal(verifyAccessCode("editor1", a), true);
  assert.equal(verifyAccessCode("editor1", b), true);
});

test("verifyAccessCode rejects malformed or empty stored hashes instead of throwing", () => {
  assert.equal(verifyAccessCode("editor1", ""), false);
  assert.equal(verifyAccessCode("editor1", "not-a-real-hash"), false);
  assert.equal(verifyAccessCode("editor1", null), false);
});

function fakeRequest(cookieHeader) {
  return { headers: { get: (name) => (name.toLowerCase() === "cookie" ? cookieHeader : null) } };
}

test("createSession + readSession round-trip the user's role and name", () => {
  const token = createSession({ id: "u1", display_name: "Javier Torres", username: "javier torres", role: "editor" });
  const cookie = sessionCookie(token);
  // sessionCookie() is "name=value; Path=...", readSession only needs the pair.
  const pair = cookie.split(";")[0];
  const session = readSession(fakeRequest(pair));
  assert.equal(session.name, "Javier Torres");
  assert.equal(session.role, "editor");
  assert.equal(session.uid, "u1");
});

test("readSession rejects a tampered token", () => {
  const token = createSession({ id: "u1", display_name: "Javier", username: "javier", role: "viewer" });
  const [payload] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ uid: "someone-else", role: "editor", exp: 9999999999 })).toString("base64url");
  const tampered = `${tamperedPayload}.${token.split(".")[1]}`;
  const session = readSession(fakeRequest(`${COOKIE_NAME}=${encodeURIComponent(tampered)}`));
  assert.equal(session, null);
});

test("readSession rejects an expired token", () => {
  // Build a session payload that's already expired and sign it the same way
  // createSession does, without waiting for a real 12-hour window to pass.
  const payload = Buffer.from(JSON.stringify({ uid: "u1", role: "editor", exp: Math.floor(Date.now() / 1000) - 10 })).toString("base64url");
  const sig = createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  const session = readSession(fakeRequest(`${COOKIE_NAME}=${encodeURIComponent(`${payload}.${sig}`)}`));
  assert.equal(session, null);
});

import { inviteRole, signupPolicy } from "../api/auth.js";

test("inviteRole: the editor code signs up an editor, the viewer code a viewer", () => {
  const env = { SIGNUP_INVITE_CODE: "VIEW-1234", SIGNUP_EDITOR_INVITE_CODE: "EDIT-9876" };
  assert.equal(inviteRole("EDIT-9876", env), "editor");
  assert.equal(inviteRole("VIEW-1234", env), "viewer");
  assert.equal(inviteRole(" VIEW-1234 ", env), "viewer", "stray spaces from a pasted text are forgiven");
  assert.equal(inviteRole("nope", env), null);
  assert.equal(inviteRole("", env), null);
});

test("inviteRole: without a viewer code signup is open, but only the editor code makes editors", () => {
  assert.equal(inviteRole("", {}), "viewer");
  assert.equal(inviteRole("EDIT-9876", {}), "viewer", "no editor code configured, so nothing grants editor");
  assert.equal(inviteRole("EDIT-9876", { SIGNUP_EDITOR_INVITE_CODE: "EDIT-9876" }), "editor");
  assert.equal(inviteRole("whatever", { SIGNUP_EDITOR_INVITE_CODE: "EDIT-9876" }), "viewer");
});

test("signupPolicy reflects the environment", () => {
  assert.equal(signupPolicy({}), "open");
  assert.equal(signupPolicy({ SIGNUP_INVITE_CODE: "x" }), "invite");
  assert.equal(signupPolicy({ SIGNUP_DISABLED: "1", SIGNUP_INVITE_CODE: "x" }), "closed");
});
