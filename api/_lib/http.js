export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function readJson(request, maxBytes = 6_000_000) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > maxBytes) throw Object.assign(new Error("payload_too_large"), { status: 413 });
  const text = await request.text();
  if (text.length > maxBytes) throw Object.assign(new Error("payload_too_large"), { status: 413 });
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}

export function errorResponse(error) {
  const status = error?.status || 500;
  const message = status >= 500 ? "server_error" : (error?.message || "request_failed");
  if (status >= 500) console.error(error);
  return json({ error: message }, status);
}

export function methodNotAllowed(allowed) {
  return json({ error: "method_not_allowed" }, 405, { allow: allowed.join(", ") });
}
