import { requireEditor, requireUser } from "./_lib/auth.js";
import { getMeta, rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { alertToClient, mapAlertInput, mergePayload } from "./_lib/models.js";
import { esc, parseRecipients, sendMail } from "./_lib/email.js";
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

async function getAlerts() {
  const { data } = await rest("alerts", "select=*&order=created_at.desc&limit=400");
  const rec = await recurrenceMap(30);
  return (data || []).map((a) => alertToClient(a, rec.get(String(a.sku || "")) || 0));
}

async function handleAlerts(request) {
  if (request.method === "GET") {
    await requireUser(request);
    const [meta, items] = await Promise.all([getMeta(), getAlerts()]);
    return json({ rev: Number(meta?.alerts_rev || 0), items });
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
      const items = await getAlerts();
      return json({ rev, items });
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
    const items = await getAlerts();
    return json({ rev, items });
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TYPE_LABEL = {
  empty: "ESPACIO VACÍO",
  damaged: "DAÑADO",
  found: "FUERA DE LUGAR",
  unknown: "CÓDIGO DESCONOCIDO",
  low: "QUEDA POCO",
  quality: "CALIDAD",
  seconds: "SECONDS",
  inventory: "INVENTARIO",
  out_of_place: "FUERA DE LUGAR",
};

function alertHtml(a, user, note) {
  const rows = [
    ["Tipo", TYPE_LABEL[a.type] || a.type || "-"],
    ["SKU / Código", a.sku || a.rawCode || "-"],
  ];
  // The V2 report form (quality/seconds/inventory/out_of_place) carries
  // several type-specific fields inside the alert's payload -- without
  // these the email only ever showed the generic columns, dropping the
  // actual problem detail (reason, disposition, destination, variance...).
  if (a.type === "quality") {
    rows.push(
      ["Cantidad", a.quantity ?? "-"],
      ["Razón", a.reason || "-"],
      ["Disposición", a.disposition ? String(a.disposition).replace(/_/g, " ") : "-"],
      ["Destino", a.destination || "-"],
    );
  } else if (a.type === "seconds") {
    rows.push(
      ["Cantidad", a.quantity ?? "-"],
      ["Razón", a.reason || "-"],
    );
  } else if (a.type === "inventory") {
    rows.push(
      ["Sistema", a.systemInventory ?? "-"],
      ["Físico", a.physicalQuantity ?? "-"],
      ["Variación", a.variance ?? "-"],
      ["Resultado", a.inventoryResult ? String(a.inventoryResult).replace(/_/g, " ") : "-"],
    );
  } else if (a.type === "out_of_place") {
    rows.push(
      ["Hallazgo", a.locationFinding === "additional_stock" ? "Stock adicional" : "Ubicación incorrecta"],
      ["Cantidad", a.quantity ?? "-"],
      ["Grupo asignado", a.homeGroup || "-"],
    );
  }
  rows.push(
    ["Prioridad", (a.priority || "normal").toUpperCase()],
    ["Estado", (a.status || "new").toUpperCase()],
    ["Reportado por", `${a.by || "-"}${a.role ? ` (${a.role})` : ""}`],
    ["Fecha", a.createdAt ? new Date(a.createdAt).toLocaleString("es") : "-"],
    ["Asignado a", a.assignedTo || "-"],
    ["Nota", a.note || "-"],
  );
  const rowsHtml = rows.map(([k, v]) => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd;font-weight:600;background:#f4f4f4">${esc(k)}</td>
      <td style="padding:6px 12px;border:1px solid #ddd">${esc(v)}</td>
    </tr>`).join("");
  const photo = a.photoUrl ? `<p><img src="cid:alertphoto" alt="foto" style="max-width:480px;border:1px solid #ddd;border-radius:6px"/></p>` : "";
  const shared = note ? `<p style="color:#444"><strong>Mensaje de ${esc(user.name)}:</strong> ${esc(note)}</p>` : "";
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
      <h2 style="margin:0 0 8px">Tarter Yard Map · Alerta</h2>
      ${shared}
      <table style="border-collapse:collapse;margin-top:8px">${rowsHtml}</table>
      ${photo}
      <p style="color:#888;font-size:12px;margin-top:16px">Enviado por ${esc(user.name)} desde Tarter Yard Map.</p>
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
  const to = parseRecipients(body.to);
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
