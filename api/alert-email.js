import { requireUser } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { alertToClient } from "./_lib/models.js";
import { esc, parseRecipients, sendMail } from "./_lib/email.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

const TYPE_LABEL = {
  empty: "ESPACIO VACÍO",
  damaged: "DAÑADO",
  found: "FUERA DE LUGAR",
  unknown: "CÓDIGO DESCONOCIDO",
  low: "QUEDA POCO",
};

function alertHtml(a, user, note) {
  const rows = [
    ["Tipo", TYPE_LABEL[a.type] || a.type || "-"],
    ["SKU / Código", a.sku || a.rawCode || "-"],
    ["Prioridad", (a.priority || "normal").toUpperCase()],
    ["Estado", (a.status || "new").toUpperCase()],
    ["Reportado por", `${a.by || "-"}${a.role ? ` (${a.role})` : ""}`],
    ["Fecha", a.createdAt ? new Date(a.createdAt).toLocaleString("es") : "-"],
    ["Asignado a", a.assignedTo || "-"],
    ["Nota", a.note || "-"],
  ];
  const rowsHtml = rows.map(([k, v]) => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd;font-weight:600;background:#f4f4f4">${esc(k)}</td>
      <td style="padding:6px 12px;border:1px solid #ddd">${esc(v)}</td>
    </tr>`).join("");
  const photo = a.photoUrl ? `<p><img src="${esc(a.photoUrl)}" alt="foto" style="max-width:480px;border:1px solid #ddd;border-radius:6px"/></p>` : "";
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

export default {
  async fetch(request) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      const user = await requireUser(request);
      const body = await readJson(request, 20_000);
      const id = String(body.id || "");
      if (!id) return json({ error: "missing_id" }, 400);
      const to = parseRecipients(body.to);
      if (!to.length) return json({ error: "invalid_recipients" }, 400);
      const note = String(body.note || "").trim().slice(0, 1000);

      const { data } = await rest("alerts", `id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return json({ error: "not_found" }, 404);
      const alert = alertToClient(row);

      const subject = `[Tarter Yard Map] Alerta ${TYPE_LABEL[alert.type] || alert.type}: ${alert.sku || alert.rawCode || id}`;
      await sendMail({ to, subject, html: alertHtml(alert, user, note) });
      await audit(user, "alert_emailed", "alert", id, { to, count: to.length });
      return json({ ok: true, to });
    } catch (error) { return errorResponse(error); }
  },
};
