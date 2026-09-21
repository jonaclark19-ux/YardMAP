import nodemailer from "nodemailer";
import { rest } from "./db.js";

let cachedTransporter = null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function config() {
  const host = process.env.SMTP_HOST || "";
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass) throw Object.assign(new Error("smtp_not_configured"), { status: 503 });
  return { host, port, user, pass, from };
}

function transporter() {
  if (cachedTransporter) return cachedTransporter;
  const { host, port, user, pass } = config();
  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cachedTransporter;
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function parseRecipients(raw, max = 20) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    .slice(0, max);
}

/* Resolving a saved group's addresses on the server, rather than letting the
   client post the addresses it happens to be showing, means a group edited a
   minute ago still sends to the right people, and a stale tab cannot mail a
   member who was just removed. Unknown ids are ignored: a group deleted while
   someone had the modal open should not fail their send. */
export async function recipientsFromGroups(groupIds, max = 100) {
  const ids = (Array.isArray(groupIds) ? groupIds : [groupIds])
    .map((id) => String(id || "").trim())
    .filter((id) => UUID_RE.test(id))
    .slice(0, 20);
  if (!ids.length) return [];
  const filter = `id=in.(${ids.map(encodeURIComponent).join(",")})`;
  const { data } = await rest("email_groups", `${filter}&select=emails&limit=20`);
  const flat = (data || []).flatMap((row) => (Array.isArray(row.emails) ? row.emails : []));
  return parseRecipients(flat.join(","), max);
}

/* One place to turn "whatever the send modal posted" into a recipient list:
   the groups the user ticked, plus any addresses they typed by hand. */
export async function resolveRecipients({ to, groupIds }, max = 100) {
  const merged = [...(await recipientsFromGroups(groupIds, max)), ...parseRecipients(to, max)];
  return [...new Set(merged.map((e) => e.toLowerCase()))].slice(0, max);
}

export async function sendMail({ to, subject, html, text, attachments }) {
  const { from } = config();
  const recipients = Array.isArray(to) ? to : [to];
  if (!recipients.length) throw Object.assign(new Error("no_recipients"), { status: 400 });
  const tx = transporter();
  await tx.sendMail({
    from,
    to: recipients.join(", "),
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    attachments: attachments && attachments.length ? attachments : undefined,
  });
}
