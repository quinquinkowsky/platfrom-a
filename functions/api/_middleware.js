import { isAuthed, json } from "./_supabase.js";

// Защищает все /api/* кроме /api/login. Без валидной сессии — 401.
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");

  if (path === "login") return next();      // вход разрешён без сессии
  if (await isAuthed(request, env)) return next();
  return json({ error: "unauthorized" }, 401);
}
