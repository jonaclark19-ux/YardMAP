/* Report photos live in the public "yard-alerts" bucket and the only URLs the
   app ever produces for them come from api/upload.js. Anything else arriving
   in a report's photoUrl -- another host, another bucket, a "../" path -- is
   refused here, because the server later fetches these URLs to attach them to
   emails and deletes them with the service key during retention. Accepting an
   arbitrary URL would turn both into a way to reach whatever the caller
   pointed them at. */

export const MAX_PHOTOS = 5;
const BUCKET_PATH = "/storage/v1/object/public/yard-alerts/";
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,300}$/;

function base() {
  return (process.env.SUPABASE_URL || "").replace(/\/$/, "");
}

/** The object path inside the bucket, or null when the URL is not ours. */
export function photoPath(url) {
  const value = String(url || "").trim();
  const prefix = base() + BUCKET_PATH;
  if (!base() || !value.startsWith(prefix)) return null;
  const path = value.slice(prefix.length);
  if (!SAFE_PATH.test(path) || path.includes("..") || path.includes("//")) return null;
  return path;
}

export function isOwnPhotoUrl(url) {
  return photoPath(url) !== null;
}

/** Keeps only our own URLs, de-duplicated, capped at MAX_PHOTOS. */
export function cleanPhotoUrls(list, max = MAX_PHOTOS) {
  const arr = Array.isArray(list) ? list : (list ? [list] : []);
  const out = [];
  for (const u of arr) {
    const v = String(u || "").trim();
    if (isOwnPhotoUrl(v) && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/* The image types the bucket accepts, recognized by their first bytes rather
   than by the MIME type the client claims. */
export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
