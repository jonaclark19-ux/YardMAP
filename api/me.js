import { requireUser } from "./_lib/auth.js";
import { json, errorResponse, methodNotAllowed } from "./_lib/http.js";

/* Is the backend actually usable, without needing a session to find out?
   requireUser() rejects a visitor with no cookie as 401 before it ever touches
   Supabase, so a half-configured deployment looked identical to a working one:
   the client saw 401, concluded a server was there, hid "Continue offline", and
   then login failed against the unconfigured backend -- locking everyone out.
   Reporting configuration first keeps that door open. */
function backendReady() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const secret = process.env.SESSION_SECRET || "";
  return !!(url && key && secret.length >= 32);
}

export default {
  async fetch(request) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    if (!backendReady()) return json({ error: "backend_not_configured" }, 503);
    try {
      const user = await requireUser(request);
      return json({ role: user.role, name: user.name });
    } catch (error) { return errorResponse(error); }
  },
};
