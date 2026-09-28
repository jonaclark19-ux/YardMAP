import { randomUUID } from "node:crypto";
import { requireUser } from "./_lib/auth.js";
import { audit } from "./_lib/audit.js";
import { sniffImage } from "./_lib/photos.js";
import { LIMITS, assertNotLimited, recordHit } from "./_lib/ratelimit.js";
import { json, readJson, errorResponse, methodNotAllowed } from "./_lib/http.js";

function storageConfig() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw Object.assign(new Error("supabase_not_configured"), { status: 503 });
  return { url, key };
}

// Vercel refuses request bodies over 4.5 MB before this code runs, and base64
// adds a third, so ~3.3 MB of image is the real ceiling. The client resizes
// to 1600 px JPEG first, which lands far below it.
const MAX_IMAGE_BYTES = 3_300_000;

export default {
  async fetch(request) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      const user = await requireUser(request);
      const limit = [{ key: `upload:${user.uid}`, limit: LIMITS.upload }];
      await assertNotLimited(limit);
      const body = await readJson(request, 4_500_000);
      const dataUrl = String(body.dataUrl || "");
      const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!match) return json({ error: "unsupported_image" }, 400);
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length > MAX_IMAGE_BYTES) return json({ error: "image_too_large" }, 413);
      // Trust the bytes, not the label: whatever is stored under an image
      // content type in a public bucket has to actually be an image.
      const mime = sniffImage(bytes);
      if (!mime) return json({ error: "unsupported_image" }, 400);
      await recordHit(limit);
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const sku = String(body.sku || "unknown").toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").slice(0, 80) || "unknown";
      const now = new Date();
      const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${sku}-${randomUUID()}.${ext}`;
      const { url, key } = storageConfig();
      const res = await fetch(`${url}/storage/v1/object/yard-alerts/${path}`, {
        method: "POST",
        headers: { apikey: key, ...(!key.startsWith("sb_secret_") ? { authorization: `Bearer ${key}` } : {}), "content-type": mime, "x-upsert": "false" },
        body: bytes,
      });
      if (!res.ok) throw Object.assign(new Error("upload_failed"), { status: 502 });
      const publicUrl = `${url}/storage/v1/object/public/yard-alerts/${path}`;
      await audit(user, "alert_photo_uploaded", "storage", path, { sku, bytes: bytes.length });
      return json({ url: publicUrl });
    } catch (error) { return errorResponse(error); }
  },
};
