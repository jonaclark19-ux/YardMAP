import { rest, supabase } from "./_lib/db.js";
import { alertToClient } from "./_lib/models.js";
import { esc, parseRecipients, sendMail } from "./_lib/email.js";
import { json, errorResponse, methodNotAllowed } from "./_lib/http.js";

// Like the per-alert email, this always renders in English -- it goes to a
// company distribution list, not necessarily the sender's own language.
const TYPE_LABEL = {
  empty: "EMPTY SPOT",
  damaged: "DAMAGED",
  found: "FOUND OUT OF PLACE",
  unknown: "UNKNOWN CODE",
  low: "RUNNING LOW",
  quality: "QUALITY",
  seconds: "SECONDS",
  inventory: "INVENTORY",
  out_of_place: "OUT OF PLACE",
};

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

function summaryHtml(items, sinceDate) {
  const total = items.length;
  const open = items.filter((a) => a.status !== "resolved").length;
  const resolved = total - open;
  const byType = {};
  for (const a of items) byType[a.type] = (byType[a.type] || 0) + 1;
  const typeRows = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<tr><td style="padding:4px 10px;border:1px solid #ddd">${esc(TYPE_LABEL[t] || t)}</td><td style="padding:4px 10px;border:1px solid #ddd">${n}</td></tr>`)
    .join("");
  const rows = items.slice(0, 50).map((a) => `
    <tr>
      <td style="padding:4px 10px;border:1px solid #ddd">${esc(a.sku || a.rawCode || "-")}</td>
      <td style="padding:4px 10px;border:1px solid #ddd">${esc(TYPE_LABEL[a.type] || a.type)}</td>
      <td style="padding:4px 10px;border:1px solid #ddd">${esc((a.priority || "normal").toUpperCase())}</td>
      <td style="padding:4px 10px;border:1px solid #ddd">${esc((a.status || "new").toUpperCase())}</td>
      <td style="padding:4px 10px;border:1px solid #ddd">${a.createdAt ? new Date(a.createdAt).toLocaleDateString("en-US") : "-"}</td>
    </tr>`).join("");
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
      <h2 style="margin:0 0 4px">Tarter Yard Map · Weekly alert summary</h2>
      <p style="color:#555;margin-top:0">Since ${esc(sinceDate.toLocaleDateString("en-US"))}</p>
      <p><strong>Total:</strong> ${total} &nbsp; <strong>Open:</strong> ${open} &nbsp; <strong>Resolved:</strong> ${resolved}</p>
      <h3 style="margin-bottom:4px">By type</h3>
      <table style="border-collapse:collapse">${typeRows || "<tr><td style=\"padding:4px 10px\">No alerts</td></tr>"}</table>
      <h3 style="margin-bottom:4px;margin-top:16px">Detail ${items.length > 50 ? "(first 50)" : ""}</h3>
      <table style="border-collapse:collapse">
        <tr>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">SKU</th>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">Type</th>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">Priority</th>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">Status</th>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">Date</th>
        </tr>
        ${rows || ""}
      </table>
      <p style="color:#888;font-size:12px;margin-top:16px">Automatic summary · Tarter Yard Map</p>
    </div>`;
}


/* ---------------------------------------------------- retention ----
   Resolved work stops being worth storing once nobody is going to look at
   it again. Anything still open is kept no matter how old it is -- age is
   exactly what makes an unresolved report matter more, not less.

   Photos go with their report. They are the bulk of what the yard stores
   (a few hundred KB each against a couple of KB for the report row), and
   an image nobody can reach from a report is pure cost.

   map_history is pruned on a different rule: it is not a record anyone
   reads, it is an undo stack. Every map save writes a full ~41 KB copy of
   the whole yard, and the editor only ever offers the last 100 to restore,
   so everything past that is weight with no way to reach it. Kept by count
   and by recency, whichever is more generous, so a heavy editing day never
   eats the previous week's restore points.

   Every window is env-tunable. Resolved reports are kept 30 days rather
   than the three weeks first asked for, because repeat-SKU detection runs
   on a 30-day window: at 21 days a SKU resolved on day 1 and reported
   again on day 25 would stop being flagged as repeating. The audit trail
   has no such reader, so it keeps the three weeks. */
const RESOLVED_DAYS = Math.max(1, Number(process.env.RETENTION_RESOLVED_DAYS || 30));
const AUDIT_DAYS = Math.max(1, Number(process.env.RETENTION_AUDIT_DAYS || 21));
const HISTORY_KEEP = Math.max(20, Number(process.env.RETENTION_HISTORY_KEEP || 100));
const HISTORY_DAYS = Math.max(1, Number(process.env.RETENTION_HISTORY_DAYS || 30));

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

/* The bucket is public-read but writes go through the service key, so the
   object path has to be recovered from the URL the report stored. A photo
   that fails to delete is logged and skipped: the report row still goes,
   and a leftover object is cheaper than aborting the whole sweep. */
async function deletePhoto(photoUrl) {
  const marker = "/storage/v1/object/public/yard-alerts/";
  const at = String(photoUrl || "").indexOf(marker);
  if (at < 0) return false;
  const path = String(photoUrl).slice(at + marker.length);
  if (!path) return false;
  try {
    await supabase(`/storage/v1/object/yard-alerts/${path}`, { method: "DELETE" });
    return true;
  } catch (e) {
    console.error("retention: could not delete photo", path, e?.message);
    return false;
  }
}

async function purgeResolvedAlerts() {
  const cutoff = daysAgo(RESOLVED_DAYS);
  // Selected before deleting so the photos can be chased down, and capped so
  // one run can never time out; whatever is left goes on the next pass.
  const { data } = await rest(
    "alerts",
    `status=eq.resolved&created_at=lt.${encodeURIComponent(cutoff)}&select=id,photo_url&limit=500`,
  );
  const rows = data || [];
  if (!rows.length) return { alerts: 0, photos: 0 };

  let photos = 0;
  for (const row of rows) {
    if (row.photo_url && (await deletePhoto(row.photo_url))) photos += 1;
  }
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length) {
    await rest("alerts", `id=in.(${ids.map(encodeURIComponent).join(",")})`, {
      method: "DELETE", headers: { prefer: "return=minimal" },
    });
  }
  return { alerts: ids.length, photos };
}

async function purgeAuditLog() {
  const cutoff = daysAgo(AUDIT_DAYS);
  const { data } = await rest(
    "audit_log",
    `created_at=lt.${encodeURIComponent(cutoff)}&select=id&limit=2000`,
  );
  const ids = (data || []).map((r) => r.id).filter((v) => v != null);
  if (!ids.length) return 0;
  await rest("audit_log", `id=in.(${ids.join(",")})`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  return ids.length;
}

async function purgeMapHistory() {
  const { data: recent } = await rest("map_history", `select=id&order=id.desc&limit=${HISTORY_KEEP}`);
  const keepIds = (recent || []).map((r) => r.id).filter((v) => v != null);
  if (keepIds.length < HISTORY_KEEP) return 0;   // nothing to prune yet
  const floor = Math.min(...keepIds);
  const cutoff = daysAgo(HISTORY_DAYS);
  // Older than the last HISTORY_KEEP revisions AND older than the date
  // window, so both conditions have to agree before a snapshot is dropped.
  const { data } = await rest(
    "map_history",
    `id=lt.${floor}&updated_at=lt.${encodeURIComponent(cutoff)}&select=id&limit=2000`,
  );
  const ids = (data || []).map((r) => r.id).filter((v) => v != null);
  if (!ids.length) return 0;
  await rest("map_history", `id=in.(${ids.join(",")})`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  return ids.length;
}

async function runRetention() {
  const [alerts, audit, history] = await Promise.all([
    purgeResolvedAlerts(), purgeAuditLog(), purgeMapHistory(),
  ]);
  return {
    ok: true,
    resolvedAlertsDeleted: alerts.alerts,
    photosDeleted: alerts.photos,
    auditRowsDeleted: audit,
    mapSnapshotsDeleted: history,
    windows: { resolvedDays: RESOLVED_DAYS, auditDays: AUDIT_DAYS, historyKeep: HISTORY_KEEP, historyDays: HISTORY_DAYS },
  };
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed(["GET", "POST"]);
    try {
      if (!isAuthorized(request)) throw Object.assign(new Error("unauthorized"), { status: 401 });

      // The daily retention sweep rides this function rather than getting its
      // own: the Hobby plan caps Serverless Functions at 12, and a nightly
      // delete has no business costing one of them.
      if (new URL(request.url).searchParams.get("route") === "retention") {
        return json(await runRetention());
      }

      const to = parseRecipients(process.env.ALERT_SUMMARY_RECIPIENTS);
      if (!to.length) return json({ error: "no_summary_recipients_configured" }, 503);

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const { data } = await rest("alerts", `created_at=gte.${encodeURIComponent(since.toISOString())}&select=*&order=created_at.desc&limit=500`);
      const items = (data || []).map((a) => alertToClient(a));

      await sendMail({ to, subject: `[Tarter Yard Map] Weekly alert summary (${items.length})`, html: summaryHtml(items, since) });
      return json({ ok: true, count: items.length, to });
    } catch (error) { return errorResponse(error); }
  },
};
