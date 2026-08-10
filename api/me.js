import { requireUser } from "./_lib/auth.js";
import { json, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    try {
      const user = await requireUser(request);
      return json({ role: user.role, name: user.name });
    } catch (error) { return errorResponse(error); }
  },
};
