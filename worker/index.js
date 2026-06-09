/**
 * Domain Scanner Worker
 *
 * Два cron-задания:
 *   "0 *\/3 * * *"   — каждые 3 часа: скачать Namecheap CSV, отфильтровать,
 *                      переписать таблицу auction_domains.
 *   "* * * * *"     — каждую минуту: продвинуть одну активную задачу
 *                      сканирования (ScamDoc + VirusTotal партиями).
 *
 * Worker не принимает HTTP-запросы напрямую — он работает только по cron.
 * Frontend общается с Supabase через Pages-функции (/api/scan/*).
 *
 * Переменные окружения (Cloudflare → Worker → Settings → Variables):
 *   SUPABASE_URL            — тот же, что у Pages
 *   SUPABASE_SERVICE_KEY    — service_role (СЕКРЕТ!)
 *   RAPIDAPI_KEY            — ключ scampredictor.p.rapidapi.com (СЕКРЕТ!)
 *   VT_API_KEY              — ключ VirusTotal v3 (СЕКРЕТ!)
 *   NAMECHEAP_CSV_URL       — URL CSV-выгрузки (по умолчанию закодирован)
 */

const DEFAULT_CSV_URL =
  "https://d3ry1h4w5036x1.cloudfront.net/reports/Namecheap_Market_Sales.csv";

// Сколько доменов прокручивать через ScamDoc за один тик (минуту).
const SCAMDOC_BATCH = 15;
// VirusTotal: лимит 4 req/min, оставляем запас.
const VT_BATCH = 3;

// ============================================================
// Supabase REST helper (тот же стиль, что в Pages-функции)
// ============================================================
function sb(env) {
  const base = (env.SUPABASE_URL || "").replace(/\/+$/, "") + "/rest/v1/";
  const key = env.SUPABASE_SERVICE_KEY;
  const headers = {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  };
  async function req(method, path, body, prefer) {
    const h = { ...headers };
    if (prefer) h["Prefer"] = prefer;
    const res = await fetch(base + path, {
      method, headers: h,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }
  return {
    select: (table, q = "") => req("GET", `${table}?${q}`),
    insert: (table, rows, prefer = "return=representation") => req("POST", table, rows, prefer),
    upsert: (table, rows) => req("POST", table, rows,
      "resolution=merge-duplicates,return=representation"),
    update: (table, q, patch) => req("PATCH", `${table}?${q}`, patch, "return=representation"),
    remove: (table, q) => req("DELETE", `${table}?${q}`),
  };
}

// ============================================================
// Парсинг CSV — минималистичный, держит запятые в кавычках
// ============================================================
function parseCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Колонки Namecheap CSV (по индексам, как в исходном python-скрипте):
//   0  url, 1  domain, 3  end_date (ISO),
//   4  price, 7  bid_count, 8  ahrefs_dr,
//   14 reg_date, 20 backlinks, 23 majestic_tf
function parseCsvText(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = parseCsvLine(line);
    if (parts.length >= 15) rows.push(parts);
  }
  return rows;
}

function toNum(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }

// ============================================================
// CRON 1: скачивание и фильтрация CSV каждые 3 часа
// ============================================================
async function refreshAuctionDomains(env) {
  const db = sb(env);
  const url = env.NAMECHEAP_CSV_URL || DEFAULT_CSV_URL;
  try {
    const resp = await fetch(url, { cf: { cacheTtl: 0 } });
    if (!resp.ok) throw new Error(`fetch CSV failed: ${resp.status}`);
    const text = await resp.text();
    const rows = parseCsvText(text);

    // Фильтр: .com, год регистрации 2000-2016 (валидные домены для нашего пула).
    // Окно по времени и цена применяются позже — на момент подбора, потому
    // что параметры меняются от задачи к задаче.
    const kept = [];
    for (const p of rows) {
      const domain = (p[1] || "").trim().toLowerCase();
      if (!domain.endsWith(".com")) continue;
      const regDate = (p[14] || "").trim();
      const regYear = parseInt(regDate.slice(0, 4), 10) || 0;
      if (regYear < 2000 || regYear > 2016) continue;
      const endStr = (p[3] || "").trim();
      if (!endStr) continue;
      // нормализуем 'Z' и пытаемся распарсить
      const endDt = new Date(endStr.replace("Z", "+00:00"));
      if (isNaN(endDt.getTime())) continue;
      kept.push({
        domain,
        url: (p[0] || "").trim(),
        end_date: endDt.toISOString(),
        reg_date: regDate.slice(0, 10) || null,
        reg_year: regYear,
        price: toNum(p[4]),
        bid_count: Math.round(toNum(p[7])),
        ahrefs_dr: toNum(p[8]),
        majestic_tf: toNum(p[23]),
        backlinks: toNum(p[20]),
      });
    }

    // Перезаписываем снапшот: чистим таблицу и вставляем заново батчами.
    // Это проще и быстрее, чем «вычислять разницу», т.к. CSV меняется
    // целиком каждый час на стороне Namecheap.
    await db.remove("auction_domains", "id=gte.0");
    const CHUNK = 500;
    for (let i = 0; i < kept.length; i += CHUNK) {
      await db.insert("auction_domains", kept.slice(i, i + CHUNK),
        "return=minimal");
    }

    await db.update("auction_meta", "id=eq.1", {
      last_fetch_at: new Date().toISOString(),
      last_fetch_ok: true,
      last_error: "",
      rows_total: rows.length,
      rows_kept: kept.length,
    });
    console.log(`Auction refresh ok: ${kept.length} of ${rows.length} kept`);
  } catch (e) {
    console.error("refresh failed:", e);
    try {
      await db.update("auction_meta", "id=eq.1", {
        last_fetch_at: new Date().toISOString(),
        last_fetch_ok: false,
        last_error: String(e.message || e).slice(0, 800),
      });
    } catch (_) {}
  }
}

// ============================================================
// ScamDoc и VirusTotal проверки (с 30-дневным кэшем в Supabase)
// ============================================================
const CACHE_TTL_DAYS = 30;
const CACHE_TTL_MS = CACHE_TTL_DAYS * 86400 * 1000;

function isFresh(checkedAt) {
  if (!checkedAt) return false;
  const t = new Date(checkedAt).getTime();
  return isFinite(t) && (Date.now() - t) < CACHE_TTL_MS;
}

async function cacheGet(db, table, domain) {
  try {
    const rows = await db.select(table, `domain=eq.${encodeURIComponent(domain)}`);
    return rows && rows[0] ? rows[0] : null;
  } catch (e) {
    return null;
  }
}

async function cachePut(db, table, row) {
  // upsert по domain (PRIMARY KEY)
  try {
    await db.upsert(table, [row]);
  } catch (e) {
    // не критично — кэш просто не запишется
    console.error(`cache ${table} put failed:`, e.message || e);
  }
}

async function checkScamdoc(domain, env, db) {
  // 1) кэш
  if (db) {
    const cached = await cacheGet(db, "scam_cache", domain);
    if (cached && isFresh(cached.checked_at)) {
      return { ok: true, trust: cached.trust_score, cached: true };
    }
  }
  // 2) API
  const url = "https://scampredictor.p.rapidapi.com/domain/" + domain;
  try {
    const r = await fetch(url, {
      headers: {
        "x-rapidapi-key": env.RAPIDAPI_KEY,
        "x-rapidapi-host": "scampredictor.p.rapidapi.com",
        "Content-Type": "application/json",
      },
    });
    if (!r.ok) return { ok: false, code: r.status };
    const d = await r.json();
    if (d.final_score == null) return { ok: false, code: 200, reason: "no_score" };
    const risk = parseFloat(d.final_score);
    const trust = Math.max(0, Math.min(100, Math.round((1 - risk) * 100)));
    // 3) запоминаем в кэш (поле в БД называется trust_score)
    if (db) {
      await cachePut(db, "scam_cache", {
        domain, trust_score: trust, checked_at: new Date().toISOString(),
      });
    }
    return { ok: true, trust, cached: false };
  } catch (e) {
    return { ok: false, code: 0, reason: String(e.message || e) };
  }
}

async function checkVirusTotal(domain, env) {
  // VirusTotal без кэша: реальные блокировки могут появиться в любой
  // момент, а лимит 4 req/min всё равно ограничивает скорость.
  try {
    const r = await fetch("https://www.virustotal.com/api/v3/domains/" + domain, {
      headers: { "x-apikey": env.VT_API_KEY },
    });
    if (r.status === 404) return { malicious: 0, suspicious: 0, clean: true };
    if (!r.ok) return { malicious: 0, suspicious: 0, clean: true, soft_fail: true };
    const data = await r.json();
    const s = (data.data && data.data.attributes && data.data.attributes.last_analysis_stats) || {};
    const mal = s.malicious || 0;
    const susp = s.suspicious || 0;
    return { malicious: mal, suspicious: susp, clean: mal === 0 && susp === 0 };
  } catch (e) {
    return { malicious: 0, suspicious: 0, clean: true, soft_fail: true };
  }
}

// ============================================================
// CRON 2: продвижение активных задач сканирования
// ============================================================
async function advanceScanJob(env) {
  const db = sb(env);
  // одна задача за тик — простота важнее
  const queue = await db.select("scan_jobs",
    "status=in.(pending,running)&order=created_at.asc&limit=1");
  if (!queue.length) return;
  const job = queue[0];

  try {
    // === Инициализация: выбрать пул кандидатов из auction_domains ===
    if (job.status === "pending") {
      const now = new Date();
      const winStart = new Date(now.getTime() + job.min_hours * 3600 * 1000);
      const winEnd = new Date(now.getTime() + job.max_hours * 3600 * 1000);
      // запрос с окном по end_date и ценой
      let q = `end_date=gte.${winStart.toISOString()}` +
              `&end_date=lte.${winEnd.toISOString()}` +
              `&order=end_date.asc`;
      if (job.max_price > 0) q += `&price=lte.${job.max_price}`;
      const candidates = await db.select("auction_domains", q + "&limit=2000");

      // исключаем чёрный список (домены, которые уже приняли)
      const blackRows = await db.select("domain_blacklist",
        "select=domain&limit=100000");
      const blackset = new Set(blackRows.map((r) => r.domain));
      let pool = candidates.filter((c) => !blackset.has(c.domain));

      // Подтянем кэш ScamDoc для всех кандидатов одним запросом и применим:
      //   - свежий кэш с баллом < min_sd_score → пропускаем сразу (не тратим API)
      //   - свежий кэш с баллом ≥ min_sd_score → сохраним балл, чтобы взять без API
      //   - нет кэша или истёк → ставим в очередь как обычно
      const TTL_MS = CACHE_TTL_MS;
      const tCutoff = new Date(Date.now() - TTL_MS).toISOString();
      let cached = [];
      try {
        cached = await db.select("scam_cache",
          `select=domain,trust_score,checked_at&checked_at=gte.${tCutoff}&limit=100000`);
      } catch (_) { cached = []; }
      const cacheMap = new Map(cached.map((c) => [c.domain, c.trust_score]));

      const minSd = job.min_sd_score;
      const filtered = pool.filter((c) => {
        const score = cacheMap.get(c.domain);
        if (score == null) return true;         // нет свежего кэша — проверим
        return score >= minSd;                  // кэш ≥ порога — берём в очередь
      });

      // упорядочиваем: сначала те, у кого уже есть кэшированный балл (моментальный
      // pickup), потом остальные (которым нужен реальный API-вызов)
      filtered.sort((a, b) => {
        const ca = cacheMap.has(a.domain) ? 1 : 0;
        const cb = cacheMap.has(b.domain) ? 1 : 0;
        if (ca !== cb) return cb - ca;          // сначала кэшированные
        // среди прочих — ближе к концу аукциона
        return new Date(a.end_date) - new Date(b.end_date);
      });

      const need = (job.want_good || 0) + (job.want_great || 0);
      const total = Math.min(filtered.length, Math.max(need * 5, 30));
      const seen = filtered.slice(0, total).map((c) => c.id);
      const skippedByCache = pool.length - filtered.length;
      await db.update("scan_jobs", `id=eq.${job.id}`, {
        status: "running",
        step: "scamdoc",
        progress: 0,
        total: seen.length,
        seen_ids: seen,
        logs: appendLog(job.logs,
          `Кандидатов в окне: ${pool.length}. Отсеяно кэшем (низкий балл): ${skippedByCache}. ` +
          `Будем проверять: ${seen.length}.`),
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // === Прогон ScamDoc партиями ===
    if (job.step === "scamdoc") {
      const ids = job.seen_ids || [];
      const greatLen = (job.results_great || []).length;
      const goodLen = (job.results_good || []).length;
      const enough = greatLen >= job.want_great && goodLen >= job.want_good;
      if (enough || job.progress >= ids.length) {
        // переходим на VT по тем, что прошли ScamDoc и попали в великие/хорошие
        const passed = [...(job.results_great || []), ...(job.results_good || [])];
        await db.update("scan_jobs", `id=eq.${job.id}`, {
          step: passed.length ? "virustotal" : "done",
          progress: 0,
          total: passed.length,
          status: passed.length ? "running" : "done",
          logs: appendLog(job.logs, `ScamDoc завершён. Прошло: ${passed.length}`),
          updated_at: new Date().toISOString(),
        });
        return;
      }
      // берём следующий батч id'ов
      const startIdx = job.progress;
      const batch = ids.slice(startIdx, startIdx + SCAMDOC_BATCH);
      if (!batch.length) return;
      const rows = await db.select("auction_domains",
        `id=in.(${batch.join(",")})&select=*`);
      // отсортируем согласно порядку в seen_ids
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = batch.map((id) => byId.get(id)).filter(Boolean);

      const newGreat = [...(job.results_great || [])];
      const newGood = [...(job.results_good || [])];
      const newLogs = (job.logs || []).slice();

      for (const r of ordered) {
        if (newGreat.length >= job.want_great && newGood.length >= job.want_good) break;
        const res = await checkScamdoc(r.domain, env, db);
        if (!res.ok) {
          newLogs.push({ msg: `ScamDoc ? ${r.domain}: ${res.code} ${res.reason || ""}`,
            level: "warning", time: nowHm() });
          continue;
        }
        const score = res.trust;
        const cachedMark = res.cached ? " ⚡" : "";
        if (score < job.min_sd_score) {
          newLogs.push({ msg: `SKIP ${r.domain}: ${score}%${cachedMark} (ниже ${job.min_sd_score})`,
            level: "dim", time: nowHm() });
          continue;
        }
        const entry = toEntry(r, score);
        if (score >= job.max_sd_score && newGreat.length < job.want_great) {
          newGreat.push(entry);
          newLogs.push({ msg: `GREAT ${r.domain}: ${score}%${cachedMark}`, level: "success", time: nowHm() });
        } else if (score < job.max_sd_score && newGood.length < job.want_good) {
          newGood.push(entry);
          newLogs.push({ msg: `GOOD ${r.domain}: ${score}%${cachedMark}`, level: "success", time: nowHm() });
        } else {
          newLogs.push({ msg: `пропуск ${r.domain}: ${score}%${cachedMark} (квота заполнена)`,
            level: "dim", time: nowHm() });
        }
      }

      await db.update("scan_jobs", `id=eq.${job.id}`, {
        progress: startIdx + batch.length,
        results_great: newGreat,
        results_good: newGood,
        logs: capLogs(newLogs),
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // === Прогон VirusTotal партиями ===
    if (job.step === "virustotal") {
      const candidates = [...(job.results_great || []), ...(job.results_good || [])];
      const startIdx = job.progress;
      if (startIdx >= candidates.length) {
        await db.update("scan_jobs", `id=eq.${job.id}`, {
          status: "done", step: "done",
          logs: appendLog(job.logs, `Готово. Great: ${(job.results_great || []).length}, ` +
            `Good: ${(job.results_good || []).length}, Flagged: ${(job.flagged || []).length}`),
          updated_at: new Date().toISOString(),
        });
        return;
      }
      const batch = candidates.slice(startIdx, startIdx + VT_BATCH);
      const great = [...(job.results_great || [])];
      const good = [...(job.results_good || [])];
      const flagged = [...(job.flagged || [])];
      const newLogs = (job.logs || []).slice();
      for (const entry of batch) {
        const vt = await checkVirusTotal(entry.domain, env);
        entry.vt_malicious = vt.malicious;
        entry.vt_suspicious = vt.suspicious;
        if (!vt.clean) {
          // выкидываем из great/good, переносим в flagged
          const inG = great.findIndex((x) => x.domain === entry.domain);
          if (inG !== -1) great.splice(inG, 1);
          const inGd = good.findIndex((x) => x.domain === entry.domain);
          if (inGd !== -1) good.splice(inGd, 1);
          flagged.push(entry);
          newLogs.push({ msg: `FLAGGED ${entry.domain} (${vt.malicious} malicious)`,
            level: "error", time: nowHm() });
        } else {
          newLogs.push({ msg: `CLEAN ${entry.domain}`, level: "success", time: nowHm() });
        }
      }
      await db.update("scan_jobs", `id=eq.${job.id}`, {
        progress: startIdx + batch.length,
        results_great: great, results_good: good, flagged,
        logs: capLogs(newLogs),
        updated_at: new Date().toISOString(),
      });
      return;
    }
  } catch (e) {
    console.error("advance job error:", e);
    await db.update("scan_jobs", `id=eq.${job.id}`, {
      status: "error",
      error_msg: String(e.message || e).slice(0, 800),
      logs: appendLog(job.logs, `Ошибка: ${String(e.message || e)}`, "error"),
      updated_at: new Date().toISOString(),
    });
  }
}

function nowHm() {
  const d = new Date();
  return d.getHours().toString().padStart(2, "0") + ":" +
         d.getMinutes().toString().padStart(2, "0");
}
function appendLog(logs, msg, level = "info") {
  const next = (logs || []).slice();
  next.push({ msg, level, time: nowHm() });
  return capLogs(next);
}
function capLogs(logs) { return logs.slice(-200); }   // не разрастаемся бесконечно

function toEntry(r, score) {
  // r — строка auction_domains
  const now = Date.now();
  const end = new Date(r.end_date).getTime();
  return {
    auction_id: r.id,
    domain: r.domain,
    url: r.url,
    scamdoc_score: score,
    hours_left: Math.round(((end - now) / 3600000) * 10) / 10,
    end_date: r.end_date,
    reg_date: r.reg_date,
    reg_year: r.reg_year,
    price: r.price,
    bid_count: r.bid_count,
    ahrefs_dr: r.ahrefs_dr,
    majestic_tf: r.majestic_tf,
    backlinks: r.backlinks,
    vt_malicious: 0, vt_suspicious: 0,
  };
}

// ============================================================
// Точка входа: cron триггеры
// ============================================================
export default {
  async scheduled(controller, env, ctx) {
    const cron = controller.cron;
    // wrangler.toml задаст две cron-строки:
    //   "0 */3 * * *" — обновить CSV
    //   "* * * * *"   — двигать задачу
    if (cron === "0 */3 * * *") {
      ctx.waitUntil(refreshAuctionDomains(env));
    } else {
      ctx.waitUntil(advanceScanJob(env));
    }
  },
  // на всякий случай — ручной триггер по HTTP (для отладки)
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/refresh") {
      // защита: требуем тот же admin pass, что и для Pages
      const auth = req.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.APP_PASS || "JohnSnow"}`)
        return new Response("forbidden", { status: 403 });
      await refreshAuctionDomains(env);
      return new Response("refreshed");
    }
    if (url.pathname === "/tick") {
      const auth = req.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.APP_PASS || "JohnSnow"}`)
        return new Response("forbidden", { status: 403 });
      await advanceScanJob(env);
      return new Response("ticked");
    }
    return new Response("Domain Scanner Worker is alive", { status: 200 });
  },
};
