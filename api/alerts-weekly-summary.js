import { rest } from "./_lib/db.js";
import { alertToClient } from "./_lib/models.js";
import { esc, parseRecipients, sendMail } from "./_lib/email.js";
import { json, errorResponse, methodNotAllowed } from "./_lib/http.js";

const TYPE_LABEL = {
  empty: "ESPACIO VACÍO",
  damaged: "DAÑADO",
  found: "FUERA DE LUGAR",
  unknown: "CÓDIGO DESCONOCIDO",
  low: "QUEDA POCO",
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
      <td style="padding:4px 10px;border:1px solid #ddd">${a.createdAt ? new Date(a.createdAt).toLocaleDateString("es") : "-"}</td>
    </tr>`).join("");
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
      <h2 style="margin:0 0 4px">Tarter Yard Map · Resumen semanal de alertas</h2>
      <p style="color:#555;margin-top:0">Desde ${esc(sinceDate.toLocaleDateString("es"))}</p>
      <p><strong>Total:</strong> ${total} &nbsp; <strong>Abiertas:</strong> ${open} &nbsp; <strong>Resueltas:</strong> ${resolved}</p>
      <h3 style="margin-bottom:4px">Por tipo</h3>
      <table style="border-collapse:collapse">${typeRows || "<tr><td style=\"padding:4px 10px\">Sin alertas</td></tr>"}</table>
      <h3 style="margin-bottom:4px;margin-top:16px">Detalle ${items.length > 50 ? "(primeras 50)" : ""}</h3>
      <table style="border-collapse:collapse">
        <tr>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">SKU</th>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">Tipo</th>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">Prioridad</th>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">Estado</th>
          <th style="padding:4px 10px;border:1px solid #ddd;background:#f4f4f4;text-align:left">Fecha</th>
        </tr>
        ${rows || ""}
      </table>
      <p style="color:#888;font-size:12px;margin-top:16px">Resumen automático · Tarter Yard Map</p>
    </div>`;
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed(["GET", "POST"]);
    try {
      if (!isAuthorized(request)) throw Object.assign(new Error("unauthorized"), { status: 401 });
      const to = parseRecipients(process.env.ALERT_SUMMARY_RECIPIENTS);
      if (!to.length) return json({ error: "no_summary_recipients_configured" }, 503);

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const { data } = await rest("alerts", `created_at=gte.${encodeURIComponent(since.toISOString())}&select=*&order=created_at.desc&limit=500`);
      const items = (data || []).map((a) => alertToClient(a));

      await sendMail({ to, subject: `[Tarter Yard Map] Resumen semanal de alertas (${items.length})`, html: summaryHtml(items, since) });
      return json({ ok: true, count: items.length, to });
    } catch (error) { return errorResponse(error); }
  },
};
