function config() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw Object.assign(new Error("supabase_not_configured"), { status: 503 });
  return { url, key };
}

export async function supabase(path, { method = "GET", body, headers = {} } = {}) {
  const { url, key } = config();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      ...(!key.startsWith("sb_secret_") ? { authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const detail = typeof data === "object" && data ? (data.message || data.error || data.details) : data;
    const err = Object.assign(new Error(detail || `supabase_${res.status}`), { status: res.status, data });
    throw err;
  }
  return { data, status: res.status, headers: res.headers };
}

export async function rest(table, query = "", opts = {}) {
  return supabase(`/rest/v1/${table}${query ? `?${query}` : ""}`, opts);
}

export async function rpc(name, args = {}) {
  const { data } = await supabase(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body: args,
    headers: { prefer: "return=representation" },
  });
  return data;
}

export async function getMeta() {
  const { data } = await rest("app_meta", "id=eq.yard&select=*", { headers: { accept: "application/json" } });
  return Array.isArray(data) ? data[0] || null : null;
}
