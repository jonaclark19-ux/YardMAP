import { readSession, clearSessionCookie } from "./_lib/auth.js";
import { audit } from "./_lib/audit.js";
import { json, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    const s = readSession(request);
    if (s) await audit(s, "logout", "session", s.uid);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  },
};
