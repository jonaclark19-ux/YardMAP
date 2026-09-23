import { requireEditor, requireUser } from "./_lib/auth.js";
import { getMeta, rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { alertToClient, mapAlertInput, mergePayload } from "./_lib/models.js";
import { esc, resolveRecipients, sendMail } from "./_lib/email.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

/* Combines the alerts CRUD endpoint with the recurring-issues report and
   the per-alert "send by email" action -- three small, related endpoints
   that together with everything else would blow past the Hobby plan's
   12-function cap. vercel.json rewrites /api/recurring and /api/alert-email
   here with a ?route= query param; /api/alerts itself is unchanged. */

async function recurrenceMap(days = 30) {
  try {
    const rows = await rpc("yard_alert_recurrence", { p_days: days });
    return new Map((rows || []).map((r) => [String(r.sku || ""), Number(r.report_count || 0)]));
  } catch { return new Map(); }
}

/* The client treats this response as the whole authoritative list, so a flat
   "newest 1500" meant that once the yard passed 1500 reports the oldest
   simply stopped existing as far as the app was concerned -- and the ones to
   go first are the oldest, which is where the open backlog lives. A silent
   wrong answer, not a slow one.

   Pagination was the obvious fix and the wrong one: it would still have the
   client download every report ever filed, just in instalments. What the app
   actually needs is narrower than "everything":

     - every report that is not resolved, at any age. Age is what makes an
       unresolved report matter more, so these are never bounded by date.
     - resolved reports inside the window the UI can actually display. The
       Control Center's widest range is 30 days and repeatedSkus() runs on
       30, so nothing older is reachable by any screen.

   Note this asks the server for status != resolved, while the client also
   treats a verified inventory check as closed. That makes the first query a
   superset of what the app calls open -- which is the safe direction: a
   report can be fetched and then filtered out, never missed.

   With retention deleting resolved reports at 30 days, the second query is
   already close to a no-op. The window is wider than retention on purpose,
   so turning retention off does not start hiding rows the UI still shows. */
const OPEN_LIMIT = 4000;
const RESOLVED_LIMIT = 4000;
const RESOLVED_WINDOW_DAYS = Math.max(30, Number(process.env.ALERTS_RESOLVED_WINDOW_DAYS || 60));

async function getAlerts() {
  const since = new Date(Date.now() - RESOLVED_WINDOW_DAYS * 86400000).toISOString();
  const [openRes, doneRes] = await Promise.all([
    rest("alerts", `status=neq.resolved&select=*&order=created_at.desc&limit=${OPEN_LIMIT}`),
    rest("alerts", `status=eq.resolved&created_at=gte.${encodeURIComponent(since)}&select=*&order=created_at.desc&limit=${RESOLVED_LIMIT}`),
  ]);
  const open = openRes.data || [];
  const done = doneRes.data || [];

  // Hitting either cap would put us back where we started, so say so instead
  // of quietly returning a short list. A yard with 4000 unresolved reports
  // has a problem the app should not be hiding.
  const truncated = open.length >= OPEN_LIMIT || done.length >= RESOLVED_LIMIT;
  if (truncated) {
    console.warn("alerts: list truncated", { open: open.length, resolved: done.length, openLimit: OPEN_LIMIT, resolvedLimit: RESOLVED_LIMIT });
  }

  const rec = await recurrenceMap(30);
  const rows = open.concat(done).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { items: rows.map((a) => alertToClient(a, rec.get(String(a.sku || "")) || 0)), truncated };
}

async function handleAlerts(request) {
  if (request.method === "GET") {
    await requireUser(request);
    const [meta, list] = await Promise.all([getMeta(), getAlerts()]);
    return json({ rev: Number(meta?.alerts_rev || 0), items: list.items, truncated: list.truncated });
  }

  if (request.method === "POST") {
    const user = await requireUser(request);
    const body = await readJson(request, 6_000_000);
    const input = mapAlertInput(body.alert || {});
    const { data } = await rest("alerts", "", {
      method: "POST",
      body: {
        ...input,
        status: "new",
        by_name: user.name,
        by_role: user.role,
      },
      headers: { prefer: "return=representation" },
    });
    const created = data?.[0];
    const revRows = await rpc("yard_bump_alerts_rev");
    const rev = Number(Array.isArray(revRows) ? revRows[0]?.alerts_rev : revRows?.alerts_rev) || 0;
    await audit(user, "alert_created", "alert", created?.id, { type: created?.type, sku: created?.sku, priority: created?.priority });
    return json({ rev, alert: alertToClient(created) }, 201);
  }

  if (request.method === "PATCH") {
    const user = await requireEditor(request);
    const body = await readJson(request, 50_000);
    const id = String(body.id || "");
    if (!id) return json({ error: "missing_id" }, 400);
    if (!UUID_RE.test(id)) return json({ error: "not_found" }, 404);

    if (body.remove) {
      await rest("alerts", `id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
      const revRows = await rpc("yard_bump_alerts_rev");
      const rev = Number(Array.isArray(revRows) ? revRows[0]?.alerts_rev : revRows?.alerts_rev) || 0;
      await audit(user, "alert_deleted", "alert", id);
      const list = await getAlerts();
      return json({ rev, items: list.items, truncated: list.truncated });
    }

    const patch = { updated_at: new Date().toISOString() };
    if (["new", "acknowledged", "in_progress", "resolved"].includes(body.status)) {
      patch.status = body.status;
      if (body.status === "acknowledged") patch.acknowledged_at = new Date().toISOString();
      if (body.status === "in_progress") patch.in_progress_at = new Date().toISOString();
      if (body.status === "resolved") {
        patch.resolved_at = new Date().toISOString();
        patch.resolved_by = user.name;
      } else {
        patch.resolved_at = null;
        patch.resolved_by = null;
      }
    }
    if (["low", "normal", "high", "critical"].includes(body.priority)) patch.priority = body.priority;
    if (body.assignedTo !== undefined) patch.assigned_to = String(body.assignedTo || "").trim().slice(0, 160) || null;
    if (body.photoUrl !== undefined) patch.photo_url = String(body.photoUrl || "").trim().slice(0, 2000) || null;

    // Workflow edits (owner, resolution note, the appended timeline entry)
    // live in the payload. Read-modify-write it, so changing one field never
    // drops the rest of the report.
    if (body.payload && typeof body.payload === "object") {
      const { data: current } = await rest("alerts", `id=eq.${encodeURIComponent(id)}&select=payload`);
      const existing = Array.isArray(current) ? current[0]?.payload : null;
      patch.payload = mergePayload(existing, body.payload);
    }

    await rest("alerts", `id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
      headers: { prefer: "return=minimal" },
    });
    const revRows = await rpc("yard_bump_alerts_rev");
    const rev = Number(Array.isArray(revRows) ? revRows[0]?.alerts_rev : revRows?.alerts_rev) || 0;
    await audit(user, "alert_updated", "alert", id, patch);
    const list = await getAlerts();
    return json({ rev, items: list.items, truncated: list.truncated });
  }

  return methodNotAllowed(["GET", "POST", "PATCH"]);
}

async function handleRecurring(request) {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  await requireEditor(request);
  const url = new URL(request.url);
  const days = Math.max(7, Math.min(90, Number(url.searchParams.get("days") || 30)));
  const rows = await rpc("yard_alert_recurrence", { p_days: days });
  return json({ days, items: (rows || []).filter((r) => Number(r.report_count || 0) >= 2).slice(0, 50) });
}

// Rendered width of the report photo inside the email body. Small enough
// that the details table above it stays the focus of the message, and
// still legible for the defect it documents.
const PHOTO_EMAIL_WIDTH = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Alert emails always render in English, regardless of which language the
// sender has the app set to: the recipient is picked from an address book
// of company contacts, not necessarily the sender's own language.
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

function alertHtml(a, user, note) {
  const rows = [
    ["Type", TYPE_LABEL[a.type] || a.type || "-"],
    ["SKU / Code", a.sku || a.rawCode || "-"],
  ];
  // The V2 report form (quality/seconds/inventory/out_of_place) carries
  // several type-specific fields inside the alert's payload -- without
  // these the email only ever showed the generic columns, dropping the
  // actual problem detail (reason, disposition, destination, variance...).
  if (a.type === "quality") {
    rows.push(
      ["Quantity", a.quantity ?? "-"],
      ["Reason", a.reason || "-"],
      ["Disposition", a.disposition ? String(a.disposition).replace(/_/g, " ") : "-"],
      ["Destination", a.destination || "-"],
    );
  } else if (a.type === "seconds") {
    rows.push(
      ["Quantity", a.quantity ?? "-"],
      ["Reason", a.reason || "-"],
    );
  } else if (a.type === "inventory") {
    rows.push(
      ["System", a.systemInventory ?? "-"],
      ["Physical", a.physicalQuantity ?? "-"],
      ["Variance", a.variance ?? "-"],
      ["Result", a.inventoryResult ? String(a.inventoryResult).replace(/_/g, " ") : "-"],
    );
  } else if (a.type === "out_of_place") {
    rows.push(
      ["Finding", a.locationFinding === "additional_stock" ? "Additional stock" : "Wrong location"],
      ["Quantity", a.quantity ?? "-"],
      ["Assigned group", a.homeGroup || "-"],
    );
  }
  rows.push(
    ["Priority", (a.priority || "normal").toUpperCase()],
    ["Status", (a.status || "new").toUpperCase()],
    ["Reported by", `${a.by || "-"}${a.role ? ` (${a.role})` : ""}`],
    ["Date", a.createdAt ? new Date(a.createdAt).toLocaleString("en-US") : "-"],
    ["Assigned to", a.assignedTo || "-"],
    ["Note", a.note || "-"],
  );
  const rowsHtml = rows.map(([k, v]) => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd;font-weight:600;background:#f4f4f4">${esc(k)}</td>
      <td style="padding:6px 12px;border:1px solid #ddd">${esc(v)}</td>
    </tr>`).join("");
  // Outlook (and several mobile clients) ignore CSS max-width on images and
  // paint them at their natural size -- a phone camera shot then fills the
  // whole message. The width *attribute* is the one sizing hint every client
  // honours, so it carries the real constraint and the CSS only keeps the
  // image from overflowing a narrow screen.
  const photo = a.photoUrl
    ? `<p><img src="cid:alertphoto" alt="photo" width="${PHOTO_EMAIL_WIDTH}" style="width:${PHOTO_EMAIL_WIDTH}px;max-width:100%;height:auto;border:1px solid #ddd;border-radius:6px"/></p>`
    : "";
  const shared = note ? `<p style="color:#444"><strong>Message from ${esc(user.name)}:</strong> ${esc(note)}</p>` : "";
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
      <h2 style="margin:0 0 8px">Tarter Yard Map · Alert</h2>
      ${shared}
      <table style="border-collapse:collapse;margin-top:8px">${rowsHtml}</table>
      ${photo}
      <p style="color:#888;font-size:12px;margin-top:16px">Sent by ${esc(user.name)} from Tarter Yard Map.</p>
    </div>`;
}

// Reports carry photoUrl as a link to Supabase storage; embedding it by
// reference alone gets stripped by most mail clients' remote-image blocking,
// so fetch it once and attach the bytes with a cid the html can reference.
async function photoAttachment(photoUrl) {
  if (!photoUrl) return [];
  try {
    const res = await fetch(photoUrl);
    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return [];
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8_000_000) return [];
    return [{ filename: "foto.jpg", content: buf, contentType, cid: "alertphoto" }];
  } catch { return []; }
}

async function handleEmail(request) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const user = await requireEditor(request);
  const body = await readJson(request, 20_000);
  const id = String(body.id || "");
  if (!id) return json({ error: "missing_id" }, 400);
  if (!UUID_RE.test(id)) return json({ error: "not_found" }, 404);
  const to = await resolveRecipients({ to: body.to, groupIds: body.groupIds });
  if (!to.length) return json({ error: "invalid_recipients" }, 400);
  const note = String(body.note || "").trim().slice(0, 1000);

  const { data } = await rest("alerts", `id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return json({ error: "not_found" }, 404);
  const alert = alertToClient(row);

  const subject = `[Tarter Yard Map] Alerta ${TYPE_LABEL[alert.type] || alert.type}: ${alert.sku || alert.rawCode || id}`;
  const attachments = await photoAttachment(alert.photoUrl);
  await sendMail({ to, subject, html: alertHtml(alert, user, note), attachments });
  await audit(user, "alert_emailed", "alert", id, { to, count: to.length });
  return json({ ok: true, to });
}

export default {
  async fetch(request) {
    try {
      const route = new URL(request.url).searchParams.get("route") || "";
      if (route === "recurring") return await handleRecurring(request);
      if (route === "email") return await handleEmail(request);
      return await handleAlerts(request);
    } catch (error) { return errorResponse(error); }
  },
};
