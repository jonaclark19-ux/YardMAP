import { timingSafeEqual } from "node:crypto";
import { requireUser } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { parseInventoryWorkbook } from "./_lib/inventoryParse.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

/* GET (session auth) fetches the shared TGU FG report; POST (shared-secret
   auth, since Power Automate can't hold a user session) imports a new one.
   Combined into one file so the daily-import feature doesn't need its own
   Serverless Function on top of the Hobby plan's 12-function cap. */

function checkImportSecret(request) {
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

async function handleGet(request) {
  await requireUser(request);
  const { data } = await rest("inventory_state", "id=eq.yard&select=rev,data,updated_at");
  const row = Array.isArray(data) ? data[0] : null;
  return json({ rev: Number(row?.rev || 0), data: row?.data || null, updatedAt: row?.updated_at || null });
}

async function handleImport(request) {
  checkImportSecret(request);
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
}

export default {
  async fetch(request) {
    try {
      if (request.method === "GET") return await handleGet(request);
      if (request.method === "POST") return await handleImport(request);
      return methodNotAllowed(["GET", "POST"]);
    } catch (error) { return errorResponse(error); }
  },
};
