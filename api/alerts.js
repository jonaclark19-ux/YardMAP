import { requireEditor, requireUser } from "./_lib/auth.js";
import { getMeta, rest, rpc } from "./_lib/db.js";
import { getAlerts } from "./_lib/alertsList.js";
import { MAX_PHOTOS, cleanPhotoUrls } from "./_lib/photos.js";
import { audit } from "./_lib/audit.js";
import { alertToClient, mapAlertInput, mergePayload } from "./_lib/models.js";
import { esc, resolveRecipients, sendMail } from "./_lib/email.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

/* Combines the alerts CRUD endpoint with the recurring-issues report and
   the per-alert "send by email" action -- three small, related endpoints
   that together with everything else would blow past the Hobby plan's
   12-function cap. vercel.json rewrites /api/recurring and /api/alert-email
   here with a ?route= query param; /api/alerts itself is unchanged. */

async function bumpAlertsRev() {
  const revRows = await rpc("yard_bump_alerts_rev");
  return Number(Array.isArray(revRows) ? revRows[0]?.alerts_rev : revRows?.alerts_rev) || 0;
}

// A reporter may add photos to their own report for this long after filing
// it -- long enough for a photo upload that failed on bad yard signal to be
// retried, short enough that old reports are not open for editing.
const AUTHOR_PHOTO_WINDOW_MS = 24 * 3600 * 1000;

/* photoUrls (the list) or photoUrl (one, from older clients), validated.
   undefined when the request did not touch photos at all. */
function photosFromBody(body) {
  if (Array.isArray(body.photoUrls)) return cleanPhotoUrls(body.photoUrls);
  if (body.photoUrl !== undefined) return cleanPhotoUrls(body.photoUrl ? [body.photoUrl] : []);
  return undefined;
}

/* The one change a viewer may make to a report: adding photos to one they
   filed themselves, shortly after filing it. The report form uploads photos
   before creating the report, so this is the retry path for an upload that
   finished late -- without it, an operator's photo was uploaded, refused
   here with 403, and never linked to anything. */
async function attachOwnPhotos(user, id, body) {
  const extra = Object.keys(body).filter((k) => !["id", "photoUrls", "photoUrl"].includes(k));
  const photos = photosFromBody(body);
  if (extra.length || !photos) return json({ error: "forbidden" }, 403);
  const { data } = await rest("alerts", `id=eq.${encodeURIComponent(id)}&select=by_name,created_at,payload,photo_url`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return json({ error: "not_found" }, 404);
  const age = Date.now() - new Date(row.created_at).getTime();
  if (row.by_name !== user.name || !(age < AUTHOR_PHOTO_WINDOW_MS)) return json({ error: "forbidden" }, 403);
  // Additive only: a viewer can add photos but never remove what is there.
  const existing = cleanPhotoUrls(Array.isArray(row.payload?.photoUrls) ? row.payload.photoUrls : row.photo_url);
  const merged = cleanPhotoUrls(existing.concat(photos), MAX_PHOTOS);
  await rest("alerts", `id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { photo_url: merged[0] || null, payload: { ...(row.payload || {}), photoUrls: merged }, updated_at: new Date().toISOString() },
    headers: { prefer: "return=minimal" },
  });
  const rev = await bumpAlertsRev();
  await audit(user, "alert_photos_added", "alert", id, { count: merged.length });
  const list = await getAlerts();
  return json({ rev, items: list.items, truncated: list.truncated });
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
    // A physical count that matches the system is a verification, not an open
    // problem. It is closed here, at creation, because the operators who file
    // most counts are viewers and cannot resolve a report afterwards -- the
    // follow-up PATCH the app used to send was refused, and the count stayed
    // "new" on the server forever.
    const verified = input.type === "inventory" && input.payload?.inventoryResult === "verified";
    const nowIso = new Date().toISOString();
    const { data } = await rest("alerts", "", {
      method: "POST",
      body: {
        ...input,
        status: verified ? "resolved" : "new",
        ...(verified ? { resolved_at: nowIso, resolved_by: user.name } : {}),
        by_name: user.name,
        by_role: user.role,
      },
      headers: { prefer: "return=representation" },
    });
    const created = data?.[0];
    const rev = await bumpAlertsRev();
    await audit(user, "alert_created", "alert", created?.id, { type: created?.type, sku: created?.sku, priority: created?.priority });
    return json({ rev, alert: alertToClient(created) }, 201);
  }

  if (request.method === "PATCH") {
    const user = await requireUser(request);
    const body = await readJson(request, 50_000);
    const id = String(body.id || "");
    if (!id) return json({ error: "missing_id" }, 400);
    if (!UUID_RE.test(id)) return json({ error: "not_found" }, 404);

    if (user.role !== "editor") return await attachOwnPhotos(user, id, body);

    if (body.remove) {
      await rest("alerts", `id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
      const rev = await bumpAlertsRev();
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
    const photos = photosFromBody(body);

    // Workflow edits (owner, resolution note, the appended timeline entry)
    // live in the payload. Read-modify-write it, so changing one field never
    // drops the rest of the report.
    if ((body.payload && typeof body.payload === "object") || photos) {
      const { data: current } = await rest("alerts", `id=eq.${encodeURIComponent(id)}&select=payload`);
      const existing = Array.isArray(current) ? current[0]?.payload : null;
      patch.payload = body.payload && typeof body.payload === "object" ? mergePayload(existing, body.payload) : (existing || {});
      if (photos) {
        patch.payload = { ...patch.payload, photoUrls: photos };
        patch.photo_url = photos[0] || null;
      }
    }

    await rest("alerts", `id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
      headers: { prefer: "return=minimal" },
    });
    const rev = await bumpAlertsRev();
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
  const photo = (a.photoCids || []).length
    ? `<p>${a.photoCids.map((cid) => `<img src="cid:${cid}" alt="photo" width="${PHOTO_EMAIL_WIDTH}" style="width:${PHOTO_EMAIL_WIDTH}px;max-width:100%;height:auto;border:1px solid #ddd;border-radius:6px;margin:0 6px 6px 0"/>`).join("")}</p>`
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

// Reports carry their photos as links to Supabase storage; embedding them by
// reference alone gets stripped by most mail clients' remote-image blocking,
// so fetch each once and attach the bytes with a cid the html can reference.
// Only our own bucket is ever fetched (cleanPhotoUrls), so a report cannot
// make the server request an arbitrary address.
const EMAIL_PHOTO_BUDGET = 15_000_000;

async function photoAttachments(urls) {
  const out = [];
  let total = 0;
  for (const [i, url] of cleanPhotoUrls(urls).entries()) {
    try {
      const res = await fetch(url, { redirect: "error" });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (total + buf.length > EMAIL_PHOTO_BUDGET) break;
      total += buf.length;
      out.push({ filename: `foto-${i + 1}.jpg`, content: buf, contentType, cid: `alertphoto${i}` });
    } catch { /* a missing photo must not block the email */ }
  }
  return out;
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
  const attachments = await photoAttachments(alert.photoUrls);
  alert.photoCids = attachments.map((a) => a.cid);
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
