import nodemailer from "nodemailer";

let cachedTransporter = null;

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
