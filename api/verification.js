import { requireUser } from "./_lib/auth.js";
import { rest, rpc } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

export default {
  async fetch(request) {
    try {
      const user = await requireUser(request);
      if (request.method === "GET") {
        const url = new URL(request.url);
        const sku = String(url.searchParams.get("sku") || "").trim();
        const query = sku
          ? `sku=eq.${encodeURIComponent(sku)}&select=*`
          : "select=*&order=verified_at.desc&limit=500";
        const { data } = await rest("sku_verifications", query);
        return json({ items: data || [] });
      }
      if (request.method === "POST") {
        const body = await readJson(request, 30_000);
        const sku = String(body.sku || "").trim().toUpperCase().slice(0, 120);
        if (!sku) return json({ error: "missing_sku" }, 400);
        const row = { sku, verified_at: new Date().toISOString(), verified_by: user.name, location: body.location && typeof body.location === "object" ? body.location : null, group_name: String(body.groupName || "").slice(0, 160) || null };
        const { data } = await rest("sku_verifications", "on_conflict=sku", { method: "POST", body: row, headers: { prefer: "resolution=merge-duplicates,return=representation" } });
        await rpc("yard_bump_verifications_rev");
        await audit(user, "sku_verified", "sku", sku, { location: row.location, groupName: row.group_name });
        return json({ item: data?.[0] || row });
      }
      return methodNotAllowed(["GET", "POST"]);
    } catch (error) { return errorResponse(error); }
  },
};
