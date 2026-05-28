// Общие утилиты: доступ к Supabase через REST (PostgREST) и аутентификация.
// Файл с префиксом "_" не является маршрутом, но его можно импортировать.

export function sb(env) {
  const base = (env.SUPABASE_URL || "").replace(/\/+$/, "") + "/rest/v1/";
  const key = env.SUPABASE_SERVICE_KEY;
  const headers = {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  };

  async function req(method, path, body, extraPrefer) {
    const h = { ...headers };
    if (extraPrefer) h["Prefer"] = extraPrefer;
    const res = await fetch(base + path, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${t}`);
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  return {
    // GET строки. query — строка PostgREST, напр. "section=eq.domains&order=id.desc"
    select: (table, query = "") => req("GET", `${table}?${query}`),
    insert: (table, rows) =>
      req("POST", table, rows, "return=representation"),
    update: (table, query, patch) =>
      req("PATCH", `${table}?${query}`, patch, "return=representation"),
    remove: (table, query) => req("DELETE", `${table}?${query}`),
  };
}

// ---------- auth ----------
function b64url(buf) {
  let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function makeToken(env) {
  const user = env.APP_USER || "admin";
  const pass = env.APP_PASS || "JohnSnow";
  const secret = env.SESSION_SECRET || "dt-default-secret-change-me";
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(user + ":" + pass));
  return b64url(sig);
}

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get("Cookie") || "";
  raw.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

export async function isAuthed(request, env) {
  const token = parseCookies(request)["dt_session"];
  if (!token) return false;
  const expected = await makeToken(env);
  // постоянное по времени сравнение не критично здесь, но сделаем простое равенство
  return token === expected;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
