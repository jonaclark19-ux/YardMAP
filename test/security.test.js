process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-000";
process.env.SUPABASE_URL = "https://proj.supabase.co";

import test from "node:test";
import assert from "node:assert/strict";
import { cleanPhotoUrls, isOwnPhotoUrl, photoPath, sniffImage } from "../api/_lib/photos.js";
import { isBlocked, nextRow, LIMITS } from "../api/_lib/ratelimit.js";
import { codeVersion, createSession, readSession } from "../api/_lib/auth.js";
import { alertToClient, mapAlertInput, mergePayload } from "../api/_lib/models.js";
import { allowedRecipients } from "../api/_lib/email.js";

const OWN = "https://proj.supabase.co/storage/v1/object/public/yard-alerts/2026/09/SKU-1.jpg";

/* ------------------------------------------------------------ photos */

test("only our own bucket's URLs are accepted as report photos", () => {
  assert.equal(isOwnPhotoUrl(OWN), true);
  assert.equal(isOwnPhotoUrl("http://169.254.169.254/latest/meta-data"), false, "no internal addresses");
  assert.equal(isOwnPhotoUrl("https://evil.example/storage/v1/object/public/yard-alerts/a.jpg"), false, "no other host");
  assert.equal(isOwnPhotoUrl("https://proj.supabase.co/storage/v1/object/public/other-bucket/a.jpg"), false, "no other bucket");
  assert.equal(isOwnPhotoUrl("https://proj.supabase.co/storage/v1/object/public/yard-alerts/../other/a.jpg"), false, "no traversal");
  assert.equal(isOwnPhotoUrl("https://proj.supabase.co/storage/v1/object/public/yard-alerts/a.jpg?x=1"), false, "no query tricks");
});

test("photoPath is what retention deletes, so a tampered URL yields nothing", () => {
  assert.equal(photoPath(OWN), "2026/09/SKU-1.jpg");
  assert.equal(photoPath("https://proj.supabase.co/storage/v1/object/public/yard-alerts/../../x"), null);
});

test("cleanPhotoUrls dedupes, drops foreign URLs and caps at five", () => {
  const many = Array.from({ length: 8 }, (_, i) => OWN.replace("SKU-1", `SKU-${i}`));
  assert.equal(cleanPhotoUrls(many).length, 5);
  assert.deepEqual(cleanPhotoUrls([OWN, OWN, "https://x.test/a.jpg"]), [OWN]);
  assert.deepEqual(cleanPhotoUrls(OWN), [OWN], "a single string is accepted");
  assert.deepEqual(cleanPhotoUrls(null), []);
});

test("sniffImage recognizes images by their bytes, not their label", () => {
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(sniffImage(Buffer.from("89504e470d0a1a0a0000000000", "hex")), "image/png");
  assert.equal(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(Buffer.from("<html><script>alert(1)</script>")), null);
});

/* -------------------------------------------------------- the model */

test("a new report keeps up to five valid photos and the first as photo_url", () => {
  const other = OWN.replace("SKU-1", "SKU-2");
  const row = mapAlertInput({ type: "quality", photoUrls: [OWN, "https://evil.test/x.jpg", other] });
  assert.equal(row.photo_url, OWN);
  assert.deepEqual(row.payload.photoUrls, [OWN, other]);
});

test("an arbitrary photoUrl from the client never reaches the row", () => {
  const row = mapAlertInput({ type: "quality", photoUrl: "http://10.0.0.1/admin" });
  assert.equal(row.photo_url, null);
  assert.equal(row.payload?.photoUrl, undefined);
});

test("the payload cannot smuggle photo URLs through a workflow merge", () => {
  const merged = mergePayload({ note: "x" }, { photoUrls: ["http://evil.test/a.jpg"], owner: "Ana" });
  assert.equal(merged.photoUrls, undefined);
  assert.equal(merged.owner, "Ana");
});

test("alertToClient exposes photoUrls, seeding it from the old single column", () => {
  const old = alertToClient({ id: "1", photo_url: OWN, payload: null });
  assert.deepEqual(old.photoUrls, [OWN]);
  assert.equal(old.photoUrl, OWN);
  const none = alertToClient({ id: "2", photo_url: null, payload: {} });
  assert.deepEqual(none.photoUrls, []);
});

/* ------------------------------------------------------- throttling */

test("a key is blocked once its window has used the budget", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const limit = LIMITS.loginName;
  const row = { count: limit.max, window_start: new Date(now - 60_000).toISOString() };
  assert.equal(isBlocked(row, limit, now), true);
  assert.equal(isBlocked({ ...row, count: limit.max - 1 }, limit, now), false);
  assert.equal(isBlocked(row, limit, now + limit.windowSec * 1000), false, "the lock lifts when the window ends");
  assert.equal(isBlocked(null, limit, now), false);
});

test("nextRow counts within a window and starts a new one after it", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const limit = LIMITS.loginName;
  const first = nextRow(null, "k", now, limit);
  assert.equal(first.count, 1);
  const second = nextRow(first, "k", now + 1000, limit);
  assert.equal(second.count, 2);
  assert.equal(second.window_start, first.window_start);
  const later = nextRow(second, "k", now + limit.windowSec * 1000 + 1, limit);
  assert.equal(later.count, 1);
});

/* ---------------------------------------------------------- sessions */

test("sessions carry a fingerprint of the access code that changes with it", () => {
  const token = createSession({ id: "u1", username: "ana", role: "viewer", access_code_hash: "scrypt$aa$bb" });
  const s = readSession(new Request("https://x.test/", { headers: { cookie: `tarter_yard_session=${encodeURIComponent(token)}` } }));
  assert.equal(s.cv, codeVersion("scrypt$aa$bb"));
  assert.notEqual(s.cv, codeVersion("scrypt$aa$cc"), "a new code invalidates the old session");
  assert.ok(!s.cv.includes("scrypt"), "the hash itself never rides in the cookie");
});

/* ------------------------------------------------------------- email */

test("EMAIL_ALLOWED_DOMAINS limits recipients; unset allows all", () => {
  const list = ["a@tarter.com", "b@gmail.com", "c@TarterUSA.com"];
  assert.deepEqual(allowedRecipients(list, ""), list);
  assert.deepEqual(allowedRecipients(list, "tarter.com, tarterusa.com"), ["a@tarter.com", "c@TarterUSA.com"]);
  assert.deepEqual(allowedRecipients(list, "@tarter.com"), ["a@tarter.com"]);
});
