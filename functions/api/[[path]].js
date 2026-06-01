import { sb, makeToken, json } from "./_supabase.js";

const FIELDS = ["domain","server","geo","seller","source","team","rating",
                "comment","date_taken","taker","status"];
const REQUIRED_FIELDS = ["domain","server","team","rating"];
const FIELD_LABELS = { domain:"Домен", server:"Сервер", geo:"ГЕО", seller:"Селлер",
  source:"Сетка", team:"Команда", rating:"Рейтинг", comment:"Комментарий",
  date_taken:"Дата взятия в работу", taker:"Кто взял в работу", status:"Статус" };
const SORT_STATUS = "На сортировку";
const SENT_STATUS = "Модерация";
const REF_TABLES = ["teams","members","servers","sources","sellers","statuses","geos"];
const LIST_FILTERS = ["geo","team","taker","source","status"];

const enc = (v) => encodeURIComponent(v);
const today = () => new Date().toISOString().slice(0, 10);

// перевод ScamDoc-балла в наш справочник рейтинга
function scoreToRating(score) {
  const s = parseInt(score, 10);
  if (!isFinite(s)) return "";
  if (s >= 80) return "80+";
  if (s >= 60) return "60-79";
  return "0";
}

function cleanRecord(body) {
  const r = {};
  for (const f of FIELDS) r[f] = (body[f] ?? "").toString().trim();
  // пустая дата -> NULL (колонка DATE)
  r.date_taken = r.date_taken ? r.date_taken : null;
  return r;
}

// возвращает массив незаполненных обязательных полей (русскими названиями); пусто = всё ок
function missingRequired(rec, skip = []) {
  return REQUIRED_FIELDS
    .filter((f) => !skip.includes(f) && !(rec[f] || "").trim())
    .map((f) => FIELD_LABELS[f] || f);
}

// ---------- маршрутизация ----------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const method = request.method;
  let body = {};
  if (method === "POST") {
    try { body = await request.json(); } catch (e) { body = {}; }
  }
  const db = sb(env);

  try {
    // ---- AUTH ----
    if (path === "login" && method === "POST") {
      const user = (body.user || "").trim();
      const pass = (body.pass || "").trim();
      if (user === (env.APP_USER || "admin") &&
          pass === (env.APP_PASS || "JohnSnow")) {
        const token = await makeToken(env);
        const cookie = `dt_session=${token}; HttpOnly; Secure; SameSite=Lax; ` +
                       `Path=/; Max-Age=2592000`;
        return json({ ok: true }, 200, { "Set-Cookie": cookie });
      }
      return json({ ok: false, error: "Неверный логин или пароль" }, 401);
    }
    if (path === "logout") {
      const cookie = "dt_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
      return json({ ok: true }, 200, { "Set-Cookie": cookie });
    }
    if (path === "me") return json({ authed: true });

    // ---- REFS ----
    if (path === "refs" && method === "GET") {
      const out = {};
      for (const t of REF_TABLES) {
        if (t === "members") {
          out.members = await db.select("members", "select=id,name,team&order=name.asc");
        } else {
          out[t] = await db.select(t, "select=id,name&order=name.asc");
        }
      }
      return json(out);
    }
    if (path === "ref" && method === "POST") {
      const { action, table } = body;
      if (!REF_TABLES.includes(table)) return json({ error: "bad table" }, 400);
      if (action === "add") {
        const row = table === "members"
          ? { name: body.name.trim(), team: (body.team || "").trim() }
          : { name: body.name.trim() };
        try { await db.insert(table, [row]); }
        catch (e) { return json({ error: "Возможно, уже существует" }, 409); }
        return json({ ok: true });
      }
      if (action === "rename") {
        await db.update(table, `id=eq.${enc(body.id)}`, { name: body.name.trim() });
        return json({ ok: true });
      }
      if (action === "delete") {
        await db.remove(table, `id=eq.${enc(body.id)}`);
        return json({ ok: true });
      }
      return json({ error: "bad action" }, 400);
    }

    // ---- RECORDS ----
    if (path === "records" && method === "GET") {
      const section = url.searchParams.get("section") || "domains";
      let q = `section=eq.${enc(section)}&order=id.desc`;
      for (const f of LIST_FILTERS) {
        const v = url.searchParams.get(f);
        if (v) q += `&${f}=eq.${enc(v)}`;
      }
      let rows = await db.select("records", q);
      const term = (url.searchParams.get("q") || "").trim().toLowerCase();
      if (term) {
        rows = rows.filter((r) =>
          ["domain","seller","source","team","taker","status"]
            .some((k) => (r[k] || "").toLowerCase().includes(term)));
      }
      // фильтр «занят/свободен» по полю taker (кто взял в работу)
      const avail = url.searchParams.get("avail") || "";
      if (avail === "busy") rows = rows.filter((r) => (r.taker || "").trim() !== "");
      else if (avail === "free") rows = rows.filter((r) => (r.taker || "").trim() === "");
      // опции фильтров — только встречающиеся в этом разделе
      const all = await db.select("records",
        `section=eq.${enc(section)}&select=geo,team,taker,source,status`);
      const opts = {};
      for (const f of LIST_FILTERS) {
        opts[f] = [...new Set(all.map((r) => r[f]).filter(Boolean))].sort();
      }
      return json({ rows, options: opts });
    }

    if (path === "record/save" && method === "POST") {
      const rec = cleanRecord(body);
      const section = body.section || "domains";
      const multi = (body.sources_multi || []).map((s) => s.trim()).filter(Boolean);
      const isSorting = rec.status === SORT_STATUS;
      const id = body.id;

      // если статус «На сортировку» с мультивыбором — source придёт из multi[0]
      const skip = (isSorting && multi.length) ? ["source"] : [];
      const miss = missingRequired(rec, skip);
      if (miss.length) {
        return json({ error: "Не заполнены обязательные поля: " + miss.join(", ") }, 400);
      }

      if (id) {
        // если статус изменился — обновляем дату изменения статуса
        const cur = await db.select("records",
          `id=eq.${enc(id)}&select=status,sort_group,status_changed_at`);
        const prevStatus = (cur[0] && cur[0].status) || "";
        const statusChanged = (rec.status || "") !== prevStatus;
        if (statusChanged && rec.status) rec.status_changed_at = today();

        if (isSorting && multi.length) {
          rec.source = multi[0];
          const grp = (cur[0] && cur[0].sort_group) ? cur[0].sort_group : `g${id}`;
          await db.update("records", `id=eq.${enc(id)}`, { ...rec, sort_group: grp });
          await db.remove("records",
            `sort_group=eq.${enc(grp)}&id=neq.${enc(id)}&section=eq.reused`);
          const dups = multi.slice(1).map((src) =>
            ({ ...rec, section: "reused", source: src, sort_group: grp,
               status_changed_at: today() }));
          if (dups.length) await db.insert("records", dups);
          return json({ ok: true });
        }
        await db.update("records", `id=eq.${enc(id)}`, rec);
        return json({ ok: true });
      } else {
        // новая запись: если статус задан — ставим дату его выставления
        if (rec.status) rec.status_changed_at = today();
        if (isSorting && multi.length) {
          rec.source = multi[0];
          const ins = await db.insert("records", [{ ...rec, section }]);
          const newId = ins[0].id;
          const grp = `g${newId}`;
          await db.update("records", `id=eq.${enc(newId)}`, { sort_group: grp });
          const dups = multi.slice(1).map((src) =>
            ({ ...rec, section: "reused", source: src, sort_group: grp }));
          if (dups.length) await db.insert("records", dups);
          return json({ ok: true });
        }
        await db.insert("records", [{ ...rec, section }]);
        return json({ ok: true });
      }
    }

    if (path === "record/delete" && method === "POST") {
      await db.remove("records", `id=eq.${enc(body.id)}`);
      return json({ ok: true });
    }

    if (path === "record/set_status" && method === "POST") {
      const id = body.id;
      const status = (body.status || "").trim();
      if (!id || !status) return json({ error: "id и status обязательны" }, 400);
      await db.update("records", `id=eq.${enc(id)}`,
        { status, status_changed_at: today() });
      return json({ ok: true });
    }

    // «Долго!» в Модерации: исходной записи -> «На стоп»,
    // создаём в Б/у клон без селлера и даты со статусом «На сортировку»,
    // чтобы домен можно было отдать другому селлеру через раздел Сортировка.
    if (path === "record/long_clone" && method === "POST") {
      const id = body.id;
      if (!id) return json({ error: "id обязателен" }, 400);
      const cur = await db.select("records", `id=eq.${enc(id)}&select=*`);
      if (!cur.length) return json({ error: "Запись не найдена" }, 404);
      const orig = cur[0];

      // 1) Исходная запись -> «На стоп» + дата смены статуса
      await db.update("records", `id=eq.${enc(id)}`,
        { status: "На стоп", status_changed_at: today() });

      // 2) Клон в Б/у: копируем все поля, очищаем seller/date_taken/sort_group,
      //    статус ставим «На сортировку», status_changed_at = сегодня
      const clone = {};
      for (const f of FIELDS) clone[f] = orig[f] ?? "";
      clone.seller = "";
      clone.date_taken = null;
      clone.status = SORT_STATUS;
      clone.section = "reused";
      clone.sort_group = "";
      clone.status_changed_at = today();
      await db.insert("records", [clone]);

      return json({ ok: true });
    }

    if (path === "record/bulk_add" && method === "POST") {
      const section = body.section || "domains";
      const shared = cleanRecord(body);
      delete shared.domain;
      // обязательные общие поля (domain проверяем построчно ниже)
      const miss = missingRequired(shared, ["domain"]);
      if (miss.length) {
        return json({ error: "Не заполнены обязательные поля: " + miss.join(", ") }, 400);
      }
      const lines = (body.domains_bulk || "").split(/\r?\n/);
      const rows = [];
      const stamp = shared.status ? today() : null;
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        const parts = line.split(/[\t,;]/);
        const domain = parts[0].trim();
        if (!domain) continue;
        const rec = { ...shared, section, domain };
        if (parts.length > 1 && parts[1].trim()) rec.seller = parts[1].trim();
        if (stamp) rec.status_changed_at = stamp;
        rows.push(rec);
      }
      if (!rows.length) {
        return json({ error: "Список доменов пуст" }, 400);
      }
      await db.insert("records", rows);
      return json({ ok: true, count: rows.length });
    }

    // ---- SORTING ----
    if (path === "sorting" && method === "GET") {
      const rows = await db.select("records",
        `status=eq.${enc(SORT_STATUS)}&order=domain.asc,source.asc`);
      return json({ rows });
    }
    if (path === "sorting/set_seller" && method === "POST") {
      await db.update("records", `id=eq.${enc(body.id)}`,
        { seller: (body.seller || "").trim() });
      return json({ ok: true });
    }

    // ---- SENDING ----
    if (path === "sending" && method === "GET") {
      const team = url.searchParams.get("team") || "";
      const rows = await db.select("records",
        `status=eq.${enc(SORT_STATUS)}&team=eq.${enc(team)}&seller=neq.` +
        `&order=seller.asc,source.asc,domain.asc`);
      const groups = {};
      const order = [];
      for (const r of rows) {
        if (!groups[r.seller]) { groups[r.seller] = []; order.push(r.seller); }
        groups[r.seller].push({ id: r.id, source: r.source, geo: r.geo, domain: r.domain });
      }
      const requests = order.map((seller) => {
        const items = groups[seller];
        const copy = seller + "\n" +
          items.map((it) => `${it.source} / ${it.geo} / ${it.domain}`).join("\n");
        return { seller, items, ids: items.map((i) => i.id),
                 copy_text: copy, count: items.length };
      });
      return json({ requests, total: rows.length });
    }
    if (path === "sending/mark_sent" && method === "POST") {
      const ids = (body.ids || []).map(String).filter(Boolean);
      if (ids.length) {
        const d = today();
        const inList = ids.map(enc).join(",");
        await db.update("records", `id=in.(${inList})`,
          { status: SENT_STATUS, date_taken: d, status_changed_at: d });
      }
      return json({ ok: true, count: ids.length });
    }

    // ---- STATS ----
    if (path === "stats" && method === "GET") {
      const period = url.searchParams.get("period") || "all";
      const value = url.searchParams.get("value") || "";
      return json(await computeStats(db, period, value));
    }
    if (path === "stats_simple" && method === "GET") {
      const period = url.searchParams.get("period") || "all";
      const value = url.searchParams.get("value") || "";
      const team = url.searchParams.get("team") || "";
      return json(await computeSimpleStats(db, period, value, team));
    }

    // ---- SCANNER ----
    // Сводка по аукционной базе
    if (path === "scan/overview" && method === "GET") {
      const meta = await db.select("auction_meta", "id=eq.1");
      const cnt = await db.select("auction_domains", "select=id&limit=1");
      const allCount = await fetch(`${env.SUPABASE_URL.replace(/\/+$/,"")}/rest/v1/auction_domains?select=count`,
        { headers: { apikey: env.SUPABASE_SERVICE_KEY,
                     Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
                     Prefer: "count=exact" } });
      const cntHeader = allCount.headers.get("Content-Range") || "*/0";
      const auction_total = parseInt(cntHeader.split("/").pop(), 10) || 0;
      const blRes = await fetch(`${env.SUPABASE_URL.replace(/\/+$/,"")}/rest/v1/domain_blacklist?select=count`,
        { headers: { apikey: env.SUPABASE_SERVICE_KEY,
                     Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
                     Prefer: "count=exact" } });
      const blHeader = blRes.headers.get("Content-Range") || "*/0";
      const blacklist_total = parseInt(blHeader.split("/").pop(), 10) || 0;
      return json({
        meta: (meta && meta[0]) || null,
        auction_total, blacklist_total,
      });
    }

    // Создать задачу подбора
    if (path === "scan/start" && method === "POST") {
      const want_good = Math.max(0, parseInt(body.want_good, 10) || 0);
      const want_great = Math.max(0, parseInt(body.want_great, 10) || 0);
      if (want_good + want_great === 0)
        return json({ error: "Укажите want_good или want_great" }, 400);
      const ins = await db.insert("scan_jobs", [{
        status: "pending",
        want_good, want_great,
        min_hours: Math.max(0, parseInt(body.min_hours, 10) || 3),
        max_hours: Math.max(1, parseInt(body.max_hours, 10) || 24),
        max_price: Math.max(0, parseFloat(body.max_price) || 0),
        min_sd_score: Math.max(0, Math.min(100, parseInt(body.min_sd_score, 10) || 70)),
        max_sd_score: Math.max(0, Math.min(100, parseInt(body.max_sd_score, 10) || 80)),
      }]);
      return json({ ok: true, job: ins[0] });
    }

    // Список задач
    if (path === "scan/jobs" && method === "GET") {
      const rows = await db.select("scan_jobs",
        "order=created_at.desc&limit=20");
      return json({ jobs: rows });
    }

    // Одна задача (для опроса)
    if (path === "scan/job" && method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id" }, 400);
      const rows = await db.select("scan_jobs", `id=eq.${enc(id)}`);
      return json({ job: rows[0] || null });
    }

    // Отмена задачи
    if (path === "scan/cancel" && method === "POST") {
      await db.update("scan_jobs", `id=eq.${enc(body.id)}`,
        { status: "cancelled" });
      return json({ ok: true });
    }

    // Принять домен из подборки:
    //   1) добавить в чёрный список (никогда больше не показывать)
    //   2) создать запись в records (раздел domains) со статусом «На сортировку»
    //      и копией всех известных полей — чтобы домен ушёл в обычный поток
    if (path === "scan/accept" && method === "POST") {
      const item = body.item || {};
      const domain = (item.domain || "").trim();
      if (!domain) return json({ error: "domain" }, 400);
      // 1) blacklist (с защитой от дубля)
      try {
        await db.insert("domain_blacklist", [{ domain, reason: "picked" }]);
      } catch (e) {
        // если уже есть — игнорируем
      }
      // 2) запись в records
      const now = new Date().toISOString();
      const rec = {
        section: "domains",
        domain,
        rating: scoreToRating(item.scamdoc_score),
        comment: item.url || "",
        date_taken: now.slice(0, 10),
        status: "На сортировку",
        status_changed_at: now.slice(0, 10),
      };
      await db.insert("records", [rec]);
      return json({ ok: true });
    }

    // Принять все: батч
    if (path === "scan/accept_all" && method === "POST") {
      const items = Array.isArray(body.items) ? body.items : [];
      let added = 0;
      for (const item of items) {
        const domain = (item.domain || "").trim();
        if (!domain) continue;
        try { await db.insert("domain_blacklist", [{ domain, reason: "picked" }]); }
        catch (e) {}
        const now = new Date().toISOString();
        await db.insert("records", [{
          section: "domains", domain,
          rating: scoreToRating(item.scamdoc_score),
          comment: item.url || "",
          date_taken: now.slice(0, 10),
          status: "На сортировку",
          status_changed_at: now.slice(0, 10),
        }]);
        added++;
      }
      return json({ ok: true, added });
    }

    // Просто отправить в чёрный список без записи в records
    // (например, если пользователь решил «не брать»)
    if (path === "scan/dismiss" && method === "POST") {
      const domain = (body.domain || "").trim();
      if (!domain) return json({ error: "domain" }, 400);
      try { await db.insert("domain_blacklist", [{ domain, reason: "manual" }]); }
      catch (e) {}
      return json({ ok: true });
    }

    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

// ---------- статистика ----------
function monthLabel(d) {
  if (!d) return "Без даты";
  const m = /^(\d{4})-(\d{2})/.exec(d);
  return m ? `${m[1]}-${m[2]}` : "Без даты";
}
function weekLabel(d) {
  if (!d) return "Без даты";
  const dt = new Date(d + "T00:00:00Z");
  if (isNaN(dt)) return "Без даты";
  const t = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;          // 0 = понедельник
  t.setUTCDate(t.getUTCDate() - day + 3);        // ближайший четверг
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const RU_MON = ["", "Январь","Февраль","Март","Апрель","Май","Июнь","Июль",
  "Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
function monthHuman(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${RU_MON[+m[2]]} ${m[1]}` : ym;
}

async function computeStats(db, period, value) {
  const all = await db.select("records", "select=*&order=id.asc");

  const distinct = (field) => [...new Set(all.map((r) => r[field]).filter(Boolean))];
  const refList = async (t) =>
    (await db.select(t, "select=name&order=name.asc")).map((r) => r.name);

  let teams = await refList("teams");
  let sources = await refList("sources");
  let statuses = await refList("statuses");
  let members = await refList("members");
  let sellers = await refList("sellers");
  const augment = (base, field) => {
    const s = new Set(base);
    distinct(field).forEach((v) => s.add(v));
    return [...base, ...[...s].filter((x) => !base.includes(x)).sort()];
  };
  teams = augment(teams, "team");
  sources = augment(sources, "source");
  statuses = augment(statuses, "status");
  members = augment(members, "taker");
  sellers = augment(sellers, "seller");

  const monthOpts = [...new Set(all.map((r) => monthLabel(r.date_taken)))]
    .filter((m) => m !== "Без даты").sort();
  const weekOpts = [...new Set(all.map((r) => weekLabel(r.date_taken)))]
    .filter((w) => w !== "Без даты").sort();
  const month_options = monthOpts.map((m) => ({ value: m, label: monthHuman(m) }));
  const week_options = weekOpts.map((w) => ({ value: w, label: w }));

  let rows = all, applied = "За всё время";
  if (period === "month" && value) {
    rows = all.filter((r) => monthLabel(r.date_taken) === value);
    applied = "Месяц: " + monthHuman(value);
  } else if (period === "week" && value) {
    rows = all.filter((r) => weekLabel(r.date_taken) === value);
    applied = value;
  } else { period = "all"; value = ""; }

  const cnt = (pred) => rows.filter(pred).length;

  const block1 = teams.map((t) => {
    const d = cnt((r) => r.team === t && r.section === "domains");
    const u = cnt((r) => r.team === t && r.section === "reused");
    return { team: t, domains: d, reused: u, total: d + u };
  });
  const block1_total = {
    domains: block1.reduce((a, b) => a + b.domains, 0),
    reused: block1.reduce((a, b) => a + b.reused, 0),
    total: block1.reduce((a, b) => a + b.total, 0),
  };

  const block2 = teams.map((t) => {
    const cells = {};
    sources.forEach((s) => cells[s] = cnt((r) => r.team === t && r.source === s));
    return { team: t, cells, total: Object.values(cells).reduce((a, b) => a + b, 0) };
  });

  const block3 = statuses.map((st) => {
    const per = {};
    teams.forEach((t) => per[t] =
      cnt((r) => r.section === "domains" && r.team === t && r.status === st));
    return { status: st, per, total: Object.values(per).reduce((a, b) => a + b, 0) };
  });
  const block3_total = {};
  teams.forEach((t) => block3_total[t] = block3.reduce((a, b) => a + b.per[t], 0));

  const block4 = [];
  sellers.forEach((seller) => sources.forEach((src) => {
    const counts = {};
    statuses.forEach((st) =>
      counts[st] = cnt((r) => r.seller === seller && r.source === src && r.status === st));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total) block4.push({ seller, source: src, counts, total });
  }));

  const block5 = [];
  members.forEach((m) => {
    const counts = {};
    statuses.forEach((st) => counts[st] = cnt((r) => r.taker === m && r.status === st));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total) block5.push({ taker: m, counts, total });
  });

  const months = [...new Set(rows.map((r) => monthLabel(r.date_taken)))].sort();
  const by_team_month = {}, by_member_month = {}, month_total = {};
  teams.forEach((t) => { by_team_month[t] = {}; months.forEach((mo) => by_team_month[t][mo] = 0); });
  members.forEach((m) => { by_member_month[m] = {}; months.forEach((mo) => by_member_month[m][mo] = 0); });
  months.forEach((mo) => month_total[mo] = 0);
  rows.forEach((r) => {
    const mo = monthLabel(r.date_taken);
    if (by_team_month[r.team]) by_team_month[r.team][mo]++;
    if (by_member_month[r.taker]) by_member_month[r.taker][mo]++;
    month_total[mo]++;
  });

  return {
    teams, sources, statuses, members, months,
    block1, block1_total, block2, block3, block3_total, block4, block5,
    by_team_month, by_member_month, month_total,
    grand_total: rows.length, period, value, applied,
    month_options, week_options,
  };
}

// ---------- упрощённый отчёт ----------
// Два блока:
//   1) «По сеткам» — фильтрация по date_taken (когда взяли в работу)
//   2) «Аккаунты» — фильтрация по status_changed_at (когда поменялся статус)
// + общий фильтр Команда (или все)
async function computeSimpleStats(db, period, value, team) {
  const all = await db.select("records", "select=*&order=id.asc");

  // справочники + дополнения из фактических значений
  const refList = async (t) =>
    (await db.select(t, "select=name&order=name.asc")).map((r) => r.name);
  const distinct = (field, rows) =>
    [...new Set(rows.map((r) => r[field]).filter(Boolean))];

  let teamsAll = await refList("teams");
  for (const t of distinct("team", all)) if (!teamsAll.includes(t)) teamsAll.push(t);
  let sourcesAll = await refList("sources");
  for (const s of distinct("source", all)) if (!sourcesAll.includes(s)) sourcesAll.push(s);

  // опции периода
  const monthOpts = [...new Set(all.map((r) => monthLabel(r.date_taken)))]
    .filter((m) => m !== "Без даты").sort();
  const weekOpts = [...new Set(all.map((r) => weekLabel(r.date_taken)))]
    .filter((w) => w !== "Без даты").sort();
  const month_options = monthOpts.map((m) => ({ value: m, label: m }));
  const week_options = weekOpts.map((w) => ({ value: w, label: w }));

  // период применяем к КОНКРЕТНОЙ дате (по сеткам -> date_taken, по аккаунтам -> status_changed_at)
  const inPeriod = (dateStr) => {
    if (period === "all") return true;
    if (!dateStr) return false;
    if (period === "month") return monthLabel(dateStr) === value;
    if (period === "week") return weekLabel(dateStr) === value;
    return true;
  };

  // фильтрация по команде применяется к обоим блокам
  const teamFilter = (r) => !team || r.team === team;

  // ----- Блок 1: по сеткам, дата = date_taken -----
  // Для каждой сетки считаем разрез по статусам:
  //   принято (Принят), выдано (Выдан), модерация (Модерация),
  //   отказ (Отказ), на стоп (На стоп), правки (Правки)
  const NET_STATUSES = ["Принят", "Выдан", "Модерация", "Отказ", "На стоп", "Правки"];
  const netRows = all.filter((r) => teamFilter(r) && inPeriod(r.date_taken));
  const netBlock = sourcesAll.map((src) => {
    const counts = {};
    NET_STATUSES.forEach((st) => {
      counts[st] = netRows.filter((r) => r.source === src && r.status === st).length;
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { source: src, counts, total };
  }).filter((row) => row.total > 0);   // показываем только непустые сетки

  // ----- Блок 2: аккаунты, дата = status_changed_at -----
  // Для каждой сетки:
  //   получено = «Выдан» (когда был выставлен этот статус)
  //   ожидаем  = «Принят» (когда был выставлен этот статус)
  const ACC_STATUSES = ["Выдан", "Принят"];
  const accRows = all.filter((r) => teamFilter(r) && inPeriod(r.status_changed_at));
  const accBlock = sourcesAll.map((src) => {
    const got = accRows.filter((r) => r.source === src && r.status === "Выдан").length;
    const wait = accRows.filter((r) => r.source === src && r.status === "Принят").length;
    return { source: src, got, wait, total: got + wait };
  }).filter((row) => row.total > 0);

  // подпись периода
  let applied = "За всё время";
  if (period === "month" && value) applied = "Месяц: " + value;
  else if (period === "week" && value) applied = value;

  return {
    teams: teamsAll, team, period, value, applied,
    month_options, week_options,
    net_statuses: NET_STATUSES, acc_statuses: ACC_STATUSES,
    net_block: netBlock,    // по сеткам (от date_taken)
    acc_block: accBlock,    // аккаунты (от status_changed_at)
    net_total: netRows.length,
    acc_total: accRows.length,
  };
}
