import { timingSafeEqual } from "node:crypto";
import { requireUser, requireEditor } from "./_lib/auth.js";
import { rest } from "./_lib/db.js";
import { audit } from "./_lib/audit.js";
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

// xlsx files are zip archives, so a correctly-decoded one always starts
// with the "PK" local-file-header signature.
function isZipBuffer(buffer) {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/* Vercel rejects request bodies over 4.5 MB before a Function runs. Base64
   in JSON spends a third of that on encoding, so the workbook can also be
   sent as the raw request body (content-type application/octet-stream or the
   xlsx type, file name in x-file-name), which fits a ~4.4 MB file. */
const MAX_BODY = 4_500_000;

function isBinaryUpload(request) {
  const type = String(request.headers.get("content-type") || "").toLowerCase();
  return type.startsWith("application/octet-stream") || type.includes("spreadsheetml") || type.includes("ms-excel");
}

async function readWorkbook(request) {
  if (isBinaryUpload(request)) {
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_BODY) throw Object.assign(new Error("file_too_large"), { status: 413 });
    const buffer = Buffer.from(await request.arrayBuffer());
    if (!buffer.length) throw Object.assign(new Error("missing_file"), { status: 400 });
    if (buffer.length > MAX_BODY) throw Object.assign(new Error("file_too_large"), { status: 413 });
    let fileName = "inventory.xlsx";
    try { fileName = decodeURIComponent(request.headers.get("x-file-name") || fileName); } catch { /* keep default */ }
    return { buffer, fileName: fileName.slice(0, 200) };
  }
  const body = await readJson(request, MAX_BODY);
  const fileName = String(body.fileName || "inventory.xlsx").slice(0, 200);
  const base64 = String(body.fileBase64 || body.dataBase64 || "");
  if (!base64) throw Object.assign(new Error("missing_file"), { status: 400 });
  return { buffer: Buffer.from(base64, "base64"), fileName };
}

async function handleImport(request) {
  checkImportSecret(request);
  let { buffer, fileName } = await readWorkbook(request);

  // Some automation tools (observed with Power Automate's HTTP action
  // against certain attachment expressions) end up base64-encoding the
  // already-base64 text a second time instead of the raw file bytes. That
  // still decodes to *something*, just not a zip -- so if the first pass
  // doesn't look like one, try unwrapping it once more before giving up.
  if (!isZipBuffer(buffer)) {
    const doubleDecoded = Buffer.from(buffer.toString("utf8"), "base64");
    if (isZipBuffer(doubleDecoded)) buffer = doubleDecoded;
  }

  const state = parseInventoryWorkbook(buffer, fileName);
  const rev = await saveState(state);

  return json({
    ok: true,
    rev,
    rowCount: state.rowCount,
    sourceSheets: state.sourceSheets,
    invalidInventory: state.invalidInventory,
    conflicts: state.conflicts,
  });
}

// Session-authenticated counterpart to handleImport: an editor uploading
// the FG report from the browser (Control Center / drawer "Load inventory
// report") doesn't hold the Power Automate shared secret, so this lets that
// same already-parsed state become the shared server copy every device
// picks up, instead of staying stuck on whichever single device loaded it.
//
// The browser now sends the workbook itself (binary) rather than the parsed
// JSON: the xlsx is zip-compressed and several times smaller than its parsed
// form, which for a full FG report ran past Vercel's 4.5 MB body limit. The
// JSON form is still accepted from older clients.
async function handlePut(request) {
  const editor = await requireEditor(request);
  let data;
  if (isBinaryUpload(request)) {
    const { buffer, fileName } = await readWorkbook(request);
    data = parseInventoryWorkbook(buffer, fileName);
    // The workbook has no catalog photos or day-over-day history; those were
    // added in the browser. Carry over what the shared copy already had.
    const { data: rows } = await rest("inventory_state", "id=eq.yard&select=data");
    const prev = Array.isArray(rows) ? rows[0]?.data : null;
    if (prev?.photos) data.photos = prev.photos;
    if (Array.isArray(prev?.history)) data.history = prev.history;
  } else {
    const body = await readJson(request, MAX_BODY);
    if (!body.data || typeof body.data !== "object" || !body.data.items) return json({ error: "invalid_data" }, 400);
    data = body.data;
  }
  const rev = await saveState(data);
  await audit(editor, "inventory_synced", "inventory", "yard", { rev, rowCount: data.rowCount, fileName: data.fileName });
  return json({ ok: true, rev, rowCount: data.rowCount });
}

async function saveState(data) {
  const rev = (await currentRev()) + 1;
  await rest("inventory_state", "id=eq.yard", {
    method: "PATCH",
    body: { rev, data, updated_at: new Date().toISOString() },
    headers: { prefer: "return=minimal" },
  });
  return rev;
}

export default {
  async fetch(request) {
    try {
      if (request.method === "GET") return await handleGet(request);
      if (request.method === "POST") return await handleImport(request);
      if (request.method === "PUT") return await handlePut(request);
      return methodNotAllowed(["GET", "POST", "PUT"]);
    } catch (error) { return errorResponse(error); }
  },
};
