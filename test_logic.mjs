// Мок PostgREST поверх массива в памяти + прогон ключевых сценариев.
import { onRequest } from "./functions/api/[[path]].js";

let DB = { records: [], teams: [], sources: [], sellers: [], statuses: [],
           geos: [], members: [], servers: [] };
let SEQ = { records: 0, teams: 0, sources: 0, sellers: 0, statuses: 0,
            geos: 0, members: 0, servers: 0 };

function matchFilters(row, params) {
  for (const [k, v] of params) {
    if (["select", "order"].includes(k)) continue;
    const m = /^(eq|neq|in)\.(.*)$/s.exec(v) || ["", "eq", v];
    const op = m[1] || "eq", val = m[2];
    if (op === "eq") { if (String(row[k] ?? "") !== val) return false; }
    else if (op === "neq") { if (String(row[k] ?? "") === val) return false; }
    else if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",");
      if (!list.includes(String(row[k]))) return false;
    }
  }
  return true;
}

globalThis.fetch = async (urlStr, opts = {}) => {
  const u = new URL(urlStr);
  const table = u.pathname.split("/rest/v1/")[1];
  const params = [...u.searchParams.entries()];
  const method = opts.method || "GET";
  const body = opts.body ? JSON.parse(opts.body) : null;

  const ok = (data) => ({
    ok: true, status: 200,
    text: async () => (data == null ? "" : JSON.stringify(data)),
  });

  if (method === "GET") {
    let rows = DB[table].filter((r) => matchFilters(r, params));
    const order = u.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) =>
        (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1));
    }
    return ok(rows);
  }
  if (method === "POST") {
    const arr = Array.isArray(body) ? body : [body];
    const inserted = arr.map((row) => {
      const rec = { id: ++SEQ[table], ...row };
      DB[table].push(rec);
      return rec;
    });
    return ok(inserted);
  }
  if (method === "PATCH") {
    const rows = DB[table].filter((r) => matchFilters(r, params));
    rows.forEach((r) => Object.assign(r, body));
    return ok(rows);
  }
  if (method === "DELETE") {
    DB[table] = DB[table].filter((r) => !matchFilters(r, params));
    return ok(null);
  }
  return { ok: false, status: 500, text: async () => "unhandled" };
};

const ENV = { SUPABASE_URL: "http://x/", SUPABASE_SERVICE_KEY: "k",
              APP_USER: "admin", APP_PASS: "JohnSnow", SESSION_SECRET: "s" };

async function call(path, method = "GET", body = null, cookie = "valid") {
  const headers = {};
  if (cookie) headers["Cookie"] = "dt_session=" + cookie;
  const req = new Request("https://app/api/" + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await onRequest({ request: req, env: ENV });
  const txt = await res.text();
  return { status: res.status, data: txt ? JSON.parse(txt) : null,
           setCookie: res.headers.get("Set-Cookie") };
}

function assert(cond, msg) {
  if (!cond) { console.error("❌ FAIL:", msg); process.exitCode = 1; }
  else console.log("✓", msg);
}

(async () => {
  // seed refs
  DB.teams = [{id:1,name:"Мукорез"},{id:2,name:"Пампура"}];
  SEQ.teams = 2;
  DB.sources = [{id:1,name:"Taboola"},{id:2,name:"OutBrain"},{id:3,name:"Mediago"}];
  SEQ.sources = 3;
  DB.sellers = [{id:1,name:"Бинго"},{id:2,name:"Скрудж"}]; SEQ.sellers = 2;
  DB.statuses = [{id:1,name:"Принят"},{id:2,name:"На сортировку"},{id:3,name:"Модерация"}];
  SEQ.statuses = 3;
  DB.geos = [{id:1,name:"GB"}]; SEQ.geos = 1;
  DB.members = [{id:1,name:"Серка О",team:"Мукорез"}]; SEQ.members = 1;

  // login check
  let r = await call("login", "POST", { user: "admin", pass: "JohnSnow" }, null);
  assert(r.status === 200 && r.data.ok && r.setCookie.includes("dt_session="), "login ok sets cookie");
  r = await call("login", "POST", { user: "admin", pass: "wrong" }, null);
  assert(r.status === 401, "login rejects wrong pass");

  // add a normal record
  r = await call("record/save", "POST", { section: "domains", domain: "a.com",
    geo: "GB", team: "Мукорез", taker: "Серка О", status: "Принят", date_taken: "2026-04-10" });
  assert(r.status === 200, "insert normal record");
  assert(DB.records.length === 1 && DB.records[0].date_taken === "2026-04-10", "record stored with date");

  // sorting: 3 sources -> 1 domains + 2 reused dups
  const mainId = DB.records[0].id;
  r = await call("record/save", "POST", { id: mainId, section: "domains", domain: "a.com",
    geo: "GB", team: "Мукорез", taker: "Серка О", status: "На сортировку",
    date_taken: "2026-04-10", sources_multi: ["Taboola","OutBrain","Mediago"] });
  assert(r.status === 200, "save sorting multi");
  const grp = DB.records.find((x) => x.id === mainId).sort_group;
  const inGroup = DB.records.filter((x) => x.sort_group === grp);
  const dCount = inGroup.filter((x) => x.section === "domains").length;
  const uCount = inGroup.filter((x) => x.section === "reused").length;
  assert(dCount === 1 && uCount === 2, `sorting dup: domains=${dCount} reused=${uCount} (want 1/2)`);
  assert(inGroup.find((x) => x.section === "domains").source === "Taboola", "main keeps first source");

  // sorting list shows 3 rows
  r = await call("sorting");
  assert(r.data.rows.length === 3, "sorting list has 3 rows");

  // assign same seller to all -> one заявка
  for (const row of r.data.rows)
    await call("sorting/set_seller", "POST", { id: row.id, seller: "Бинго" });
  const wb = DB.records.filter((x) => x.sort_group === grp);
  assert(wb.every((x) => x.seller === "Бинго"), "seller propagated to all group rows");

  // sending for Мукорез -> 1 group, 3 items, copy text format
  r = await call("sending?team=" + encodeURIComponent("Мукорез"));
  assert(r.data.requests.length === 1 && r.data.requests[0].count === 3, "sending: 1 заявка, 3 домена");
  const ct = r.data.requests[0].copy_text;
  assert(ct.startsWith("Бинго\n") && ct.includes(" / GB / a.com"), "copy text = seller + сетка/гео/домен");

  // mark sent -> status Модерация + today date, gone from sorting
  const ids = r.data.requests[0].ids;
  r = await call("sending/mark_sent", "POST", { ids });
  assert(r.status === 200, "mark_sent ok");
  const today = new Date().toISOString().slice(0,10);
  const sent = DB.records.filter((x) => ids.includes(x.id));
  assert(sent.every((x) => x.status === "Модерация" && x.date_taken === today),
    "mark_sent: Модерация + today on all (domains & reused)");
  r = await call("sorting");
  assert(r.data.rows.length === 0, "sorting empty after sent");

  // bulk add 3 (one with seller, blank lines ignored)
  r = await call("record/bulk_add", "POST", { section: "reused",
    domains_bulk: "x1.com\n  \nx2.com, Скрудж\nx3.com", team: "Пампура", status: "Принят" });
  assert(r.data.count === 3, "bulk add counted 3");
  const x2 = DB.records.find((x) => x.domain === "x2.com");
  assert(x2.seller === "Скрудж" && x2.team === "Пампура", "bulk per-line seller + shared field");

  // records filter by team equality
  r = await call("records?section=reused&team=" + encodeURIComponent("Пампура"));
  assert(r.data.rows.length === 3, "records filter team=Пампура -> 3");

  // stats sanity
  r = await call("stats?period=all");
  assert(r.status === 200 && typeof r.data.grand_total === "number", "stats computes");
  const muk = r.data.block1.find((b) => b.team === "Мукорез");
  assert(muk.total === 3, `block1 Мукорез total=${muk.total} (3 sorted+sent rows)`);

  // auth: no cookie -> middleware would block, but we call router directly;
  // emulate unauth by hitting a protected path without valid token is handled by middleware (not router)

  console.log("\nDone.");
})();
