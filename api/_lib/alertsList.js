import { rest, rpc } from "./db.js";
import { alertToClient } from "./models.js";

/* The one definition of "the list of reports the app works with", shared by
   GET /api/alerts, every alert write that answers with the fresh list, and
   the /api/sync poll. The poll used to carry its own "newest 1500" query,
   so fifteen seconds after any change it quietly replaced this list with the
   old truncated one.

   What the app needs is narrower than "everything":
     - every report that is not resolved, at any age. Age is what makes an
       unresolved report matter more, so these are never bounded by date.
     - resolved reports inside the window the UI can actually display. The
       Control Center's widest range is 30 days and repeatedSkus() runs on
       30, so nothing older is reachable by any screen.

   Supabase caps any single response at its "Max rows" setting (1000 by
   default) no matter what limit= asks for, so each half is read in pages. */
export const OPEN_LIMIT = 4000;
export const RESOLVED_LIMIT = 4000;
export const PAGE_SIZE = 1000;
const RESOLVED_WINDOW_DAYS = Math.max(30, Number(process.env.ALERTS_RESOLVED_WINDOW_DAYS || 60));

export function resolvedSince(now = Date.now()) {
  return new Date(now - RESOLVED_WINDOW_DAYS * 86400000).toISOString();
}

/** Reads query page by page until a short page or the cap. `read` is
    injectable so the paging itself can be tested without a database. */
export async function fetchPaged(table, query, cap, read = rest) {
  const out = [];
  for (let offset = 0; offset < cap; offset += PAGE_SIZE) {
    const size = Math.min(PAGE_SIZE, cap - offset);
    const { data } = await read(table, `${query}&limit=${size}&offset=${offset}`);
    const rows = Array.isArray(data) ? data : [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

async function recurrenceMap(days = 30) {
  try {
    const rows = await rpc("yard_alert_recurrence", { p_days: days });
    return new Map((rows || []).map((r) => [String(r.sku || ""), Number(r.report_count || 0)]));
  } catch { return new Map(); }
}

export async function getAlerts() {
  const since = resolvedSince();
  const [open, done] = await Promise.all([
    fetchPaged("alerts", "status=neq.resolved&select=*&order=created_at.desc,id.desc", OPEN_LIMIT),
    fetchPaged("alerts", `status=eq.resolved&created_at=gte.${encodeURIComponent(since)}&select=*&order=created_at.desc,id.desc`, RESOLVED_LIMIT),
  ]);

  // Hitting either cap would silently hide reports again, so say so. A yard
  // with 4000 unresolved reports has a problem the app should not be hiding.
  const truncated = open.length >= OPEN_LIMIT || done.length >= RESOLVED_LIMIT;
  if (truncated) {
    console.warn("alerts: list truncated", { open: open.length, resolved: done.length, openLimit: OPEN_LIMIT, resolvedLimit: RESOLVED_LIMIT });
  }

  const rec = await recurrenceMap(30);
  const rows = open.concat(done).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { items: rows.map((a) => alertToClient(a, rec.get(String(a.sku || "")) || 0)), truncated };
}
