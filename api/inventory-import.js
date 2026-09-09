import { timingSafeEqual } from "node:crypto";
import { rest } from "./_lib/db.js";
import { parseInventoryWorkbook } from "./_lib/inventoryParse.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

/* Power Automate can't log in as an editor, so this endpoint is gated by a
   shared secret header instead of a user session. */
function checkSecret(request) {
  const expected = process.env.INVENTORY_IMPORT_SECRET || "";
  if (!expected) throw Object.assign(new Error("import_secret_not_configured"), { status: 503 });
  const got = request.headers.get("x-import-secret") || "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }
}

async function currentRev() {
  const { data } = await rest("inventory_state", "id=eq.yard&select=rev");
  return Number((Array.isArray(data) ? data[0] : null)?.rev || 0);
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      checkSecret(request);
      const body = await readJson(request, 25_000_000);
      const fileName = String(body.fileName || "inventory.xlsx").slice(0, 200);
      const base64 = String(body.fileBase64 || body.dataBase64 || "");
      if (!base64) return json({ error: "missing_file" }, 400);
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length > 20_000_000) return json({ error: "file_too_large" }, 413);

      const state = parseInventoryWorkbook(buffer, fileName);
      const rev = (await currentRev()) + 1;

      await rest("inventory_state", "id=eq.yard", {
        method: "PATCH",
        body: { rev, data: state, updated_at: new Date().toISOString() },
        headers: { prefer: "return=minimal" },
      });

      return json({
        ok: true,
        rev,
        rowCount: state.rowCount,
        sourceSheets: state.sourceSheets,
        invalidInventory: state.invalidInventory,
        conflicts: state.conflicts,
      });
    } catch (error) { return errorResponse(error); }
  },
};
