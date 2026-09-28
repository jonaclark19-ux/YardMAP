import { rest } from "./db.js";

/* Throttling for the endpoints a stranger can call without a session: login,
   signup and photo upload. Access codes are short enough that an unthrottled
   login lets anyone walk the whole code space for a known name in minutes, so
   failures are counted per name and per IP, and a key that runs over its
   budget is locked for the rest of its window.

   The counters live in Supabase (table auth_attempts, see
   supabase/migration-security.sql) because Vercel Functions keep no memory
   between invocations. If that table has not been created yet the limiter
   fails open and logs once per cold start: a missing migration must never
   lock every user out of the app. */

let warned = false;

export function clientIp(request) {
  const fwd = request.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || request.headers.get("x-real-ip") || "unknown").trim().slice(0, 64);
}

export const LIMITS = {
  loginName: { max: 5, windowSec: 15 * 60 },
  loginIp: { max: 30, windowSec: 15 * 60 },
  // Generous: a whole crew often signs up from the same yard Wi-Fi address.
  signupIp: { max: 20, windowSec: 60 * 60 },
  // Up to five photos a report, so this still allows ~30 reports an hour.
  upload: { max: 150, windowSec: 60 * 60 },
};

/* Pure decision, split out so it can be tested without a database: given the
   stored row for a key, is the caller over budget right now? */
export function isBlocked(row, limit, now = Date.now()) {
  if (!row) return false;
  const start = new Date(row.window_start).getTime();
  if (!Number.isFinite(start) || now - start >= limit.windowSec * 1000) return false;
  return Number(row.count || 0) >= limit.max;
}

export function nextRow(row, key, now = Date.now(), limit) {
  const start = row ? new Date(row.window_start).getTime() : NaN;
  const fresh = !row || !Number.isFinite(start) || now - start >= limit.windowSec * 1000;
  return {
    key,
    count: fresh ? 1 : Number(row.count || 0) + 1,
    window_start: fresh ? new Date(now).toISOString() : row.window_start,
  };
}

function missingTable(error) {
  const code = error?.data?.code;
  return code === "42P01" || code === "PGRST205" || error?.status === 404;
}

async function readRows(keys) {
  const list = keys.map((k) => `"${String(k).replace(/"/g, "")}"`).join(",");
  const { data } = await rest("auth_attempts", `key=in.(${encodeURIComponent(list)})&select=key,count,window_start`);
  return new Map((data || []).map((r) => [r.key, r]));
}

/** Throws 429 when any of the keys is over its limit. */
export async function assertNotLimited(entries) {
  try {
    const rows = await readRows(entries.map((e) => e.key));
    for (const { key, limit } of entries) {
      if (isBlocked(rows.get(key), limit)) {
        throw Object.assign(new Error("too_many_attempts"), { status: 429, retryAfter: limit.windowSec });
      }
    }
  } catch (error) {
    if (error?.status === 429) throw error;
    if (!warned) { console.warn("ratelimit: disabled", missingTable(error) ? "(run supabase/migration-security.sql)" : error?.message); warned = true; }
  }
}

/** Counts one hit against every key. Best-effort: never fails the request. */
export async function recordHit(entries) {
  try {
    const rows = await readRows(entries.map((e) => e.key));
    const now = Date.now();
    const body = entries.map(({ key, limit }) => nextRow(rows.get(key), key, now, limit));
    await rest("auth_attempts", "on_conflict=key", {
      method: "POST",
      body,
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    });
  } catch (error) {
    if (!warned) { console.warn("ratelimit: disabled", error?.message); warned = true; }
  }
}

export async function clearHits(keys) {
  try {
    const list = keys.map((k) => `"${String(k).replace(/"/g, "")}"`).join(",");
    await rest("auth_attempts", `key=in.(${encodeURIComponent(list)})`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  } catch { /* nothing to clear */ }
}
