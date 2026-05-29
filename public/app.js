"use strict";

const FIELDS = ["domain","server","geo","seller","source","team","rating",
                "comment","date_taken","taker","status"];
const LABELS = {domain:"Домен",server:"Сервер",geo:"ГЕО",seller:"Селлер",
  source:"Сетка / источник",team:"Команда",rating:"Рейтинг",
  comment:"Комментарий / почта",date_taken:"Дата взятия в работу",
  taker:"Кто взял в работу",status:"Статус"};
const OPT_FIELDS = ["server","geo","seller","source","team","taker","status"];
const LIST_FILTERS = [["geo","ГЕО"],["team","Команда"],["taker","Участник"],
  ["source","Сетка"],["status","Статус"]];
const SORT_STATUS = "На сортировку";

let REFS = null;   // {teams:[{id,name}], members:[{id,name,team}], ...}

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => (s == null ? "" : String(s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;"));

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error("unauthorized"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

function flash(msg, kind = "ok") {
  $("flash").innerHTML = `<div class="flash flash-${kind}">${esc(msg)}</div>`;
  setTimeout(() => { $("flash").innerHTML = ""; }, 3500);
}
function names(table) { return (REFS[table] || []).map((r) => r.name); }

// ---------- auth ----------
function showLogin() { $("login").classList.remove("hidden"); $("app").classList.add("hidden"); }
function showApp()   { $("login").classList.add("hidden");   $("app").classList.remove("hidden"); }

async function doLogin() {
  const user = $("login-user").value, pass = $("login-pass").value;
  $("login-err").textContent = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, pass }),
    });
    const d = await res.json();
    if (res.ok && d.ok) { await boot(); }
    else $("login-err").textContent = d.error || "Ошибка входа";
  } catch (e) { $("login-err").textContent = "Сеть недоступна"; }
}

// ---------- nav ----------
function renderNav() {
  const teams = names("teams");
  const sendMenu = teams.map((t, i) =>
    `<a href="#/sending/${i}">${esc(t)}</a>`).join("") ||
    `<span class="tab-menu-empty">нет команд</span>`;
  $("nav").innerHTML = `
    <a href="#/domains" data-v="domains">Домены</a>
    <a href="#/reused" data-v="reused">Б/у</a>
    <a href="#/sorting" data-v="sorting">Сортировка</a>
    <div class="tab-drop"><a data-v="sending">На отправку ▾</a>
      <div class="tab-menu">${sendMenu}</div></div>
    <a href="#/moderation" data-v="moderation">Модерация</a>
    <a href="#/expected" data-v="expected">Ожидаемое</a>
    <a href="#/stats" data-v="stats">Статистика</a>
    <a href="#/settings" data-v="settings">Справочники</a>`;
}
function setActive(view) {
  document.querySelectorAll("#nav a[data-v]").forEach((a) =>
    a.classList.toggle("active", a.dataset.v === view));
}

// ---------- router ----------
async function route() {
  const hash = location.hash || "#/domains";
  // отделяем query-string ДО разбиения по "/", иначе parts[0] окажется
  // вида "stats?period=month..." и не совпадёт с "stats"
  const pathPart = hash.slice(2).split("?")[0];
  const parts = pathPart.split("/");
  const view = parts[0] || "domains";
  setActive(view === "reused" ? "reused" : view);
  const el = $("view");
  el.innerHTML = `<div class="loading">Загрузка…</div>`;
  try {
    if (view === "domains") await viewRecords("domains");
    else if (view === "reused") await viewRecords("reused");
    else if (view === "sorting") await viewSorting();
    else if (view === "sending") await viewSending(parts[1] || "0");
    else if (view === "moderation") await viewStatusQueue("moderation");
    else if (view === "expected") await viewStatusQueue("expected");
    else if (view === "stats") await viewStats();
    else if (view === "settings") await viewSettings();
    else await viewRecords("domains");
  } catch (e) {
    if (e.message !== "unauthorized")
      el.innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`;
  }
}

// ---------- view: records ----------
async function viewRecords(section) {
  const params = new URLSearchParams(section === "reused" ? { section } : { section });
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  ["q", "avail", ...LIST_FILTERS.map((f) => f[0])].forEach((k) => {
    if (qs.get(k)) params.set(k, qs.get(k));
  });
  const data = await api("records?" + params.toString());
  const rows = data.rows;
  const title = section === "reused" ? "Б/у (повторное использование)" : "Домены";
  const sel = {}; LIST_FILTERS.forEach(([f]) => sel[f] = qs.get(f) || "");
  const q = qs.get("q") || "";

  const filterSelects = LIST_FILTERS.map(([f, label]) => {
    const opts = (data.options[f] || []).map((o) =>
      `<option value="${esc(o)}" ${sel[f] === o ? "selected" : ""}>${esc(o)}</option>`).join("");
    return `<select class="filter-sel" data-filter="${f}">
      <option value="">${esc(label)}: все</option>${opts}</select>`;
  }).join("");
  const availVal = qs.get("avail") || "";
  const availSelect = `<select class="filter-sel" data-filter="avail">
    <option value="">Занятость: все</option>
    <option value="free" ${availVal === "free" ? "selected" : ""}>Свободен</option>
    <option value="busy" ${availVal === "busy" ? "selected" : ""}>Занят</option>
  </select>`;

  const anyFilter = q || Object.values(sel).some(Boolean) || availVal;

  const body = rows.map((r) => {
    const busy = (r.taker || "").trim() !== "";
    const availPill = busy
      ? `<span class="pill pill-busy">● занят</span>`
      : `<span class="pill pill-free">○ свободен</span>`;
    return `
    <tr>
      <td class="mono">${esc(r.domain)}</td>
      <td class="mono dim">${esc(r.server)}</td>
      <td>${esc(r.geo)}</td><td>${esc(r.seller)}</td><td>${esc(r.source)}</td>
      <td>${esc(r.team)}</td><td class="dim">${esc(r.rating)}</td>
      <td>${availPill}</td><td class="mono dim">${esc(r.date_taken || "")}</td>
      <td>${esc(r.taker)}</td>
      <td>${r.status ? `<span class="pill pill-${esc((r.status||"").replace(/ /g,""))}">${esc(r.status)}</span>` : ""}</td>
      <td class="dim">${esc(r.comment)}</td>
      <td><div class="row-actions">
        <button class="btn-ghost btn-sm" data-edit='${esc(JSON.stringify(r))}'>✎</button>
        <button class="btn-danger btn-sm" data-del="${r.id}" data-dom="${esc(r.domain)}">✕</button>
      </div></td>
    </tr>`;
  }).join("");

  $("view").innerHTML = `
    <div class="sec-head">
      <div><h1>${esc(title)}</h1>
        <div class="sub">${anyFilter ? "Найдено" : "Всего записей"}: ${rows.length}</div></div>
      <div class="head-actions">
        <button class="btn btn-ghost" id="bulk-open">⊞ Оптом</button>
        <button class="btn" id="add-open">+ Добавить</button>
      </div>
    </div>
    <div class="filter-bar">
      <input class="search" id="f-q" value="${esc(q)}" placeholder="Поиск: домен, селлер…">
      ${filterSelects}${availSelect}
      <button class="btn btn-sm" id="apply-filter">Применить</button>
      ${anyFilter ? `<a class="reset-link" id="reset-filter">Сбросить</a>` : ""}
    </div>
    <div class="table-wrap">${rows.length ? `<table class="records-table">
      <thead><tr><th>Домен</th><th>Сервер</th><th>ГЕО</th><th>Селлер</th><th>Сетка</th>
        <th>Команда</th><th>Рейтинг</th><th>Занятость</th><th>Дата</th><th>Кто взял</th>
        <th>Статус</th><th>Коммент</th><th>Действия</th></tr></thead>
      <tbody>${body}</tbody></table>` :
      `<div class="empty">Нет записей.</div>`}</div>`;

  // wire filters
  const applyFilters = () => {
    const p = new URLSearchParams();
    const qv = $("f-q").value.trim(); if (qv) p.set("q", qv);
    document.querySelectorAll("[data-filter]").forEach((s) => {
      if (s.value) p.set(s.dataset.filter, s.value);
    });
    location.hash = `#/${section}?${p.toString()}`;
  };
  $("apply-filter").onclick = applyFilters;
  $("f-q").addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
  document.querySelectorAll("[data-filter]").forEach((s) => s.onchange = applyFilters);
  if ($("reset-filter")) $("reset-filter").onclick = () => location.hash = `#/${section}`;
  $("add-open").onclick = () => openRecordModal(section, null);
  $("bulk-open").onclick = () => openBulkModal(section);
  document.querySelectorAll("[data-edit]").forEach((b) =>
    b.onclick = () => openRecordModal(section, JSON.parse(b.dataset.edit)));
  document.querySelectorAll("[data-del]").forEach((b) =>
    b.onclick = async () => {
      if (!confirm("Удалить запись " + b.dataset.dom + "?")) return;
      await api("record/delete", { method: "POST", body: { id: b.dataset.del } });
      flash("Запись удалена"); route();
    });
}

// ---------- modal: single record ----------
function optionsFor(field, current) {
  let vals = [];
  if (field === "taker") vals = names("members");
  else if (field === "team") vals = names("teams");
  else if (field === "server") vals = names("servers");
  else if (field === "source") vals = names("sources");
  else if (field === "seller") vals = names("sellers");
  else if (field === "status") vals = names("statuses");
  else if (field === "geo") vals = names("geos");
  const set = new Set(vals); if (current) set.add(current);
  return [...set].sort();
}

function openRecordModal(section, rec) {
  const isEdit = !!rec;
  const v = (f) => rec ? (rec[f] == null ? "" : rec[f]) : "";
  const grid = FIELDS.map((f) => {
    let inner;
    if (OPT_FIELDS.includes(f)) {
      const opts = optionsFor(f, v(f)).map((o) =>
        `<option value="${esc(o)}" ${v(f) === o ? "selected" : ""}>${esc(o)}</option>`).join("");
      inner = `<select id="m-${f}" ${f === "status" ? 'onchange="window.__toggleSort()"' : ""}>
        <option value=""></option>${opts}</select>`;
    } else if (f === "date_taken") {
      inner = `<input type="date" id="m-${f}" value="${esc(v(f) || "")}">`;
    } else {
      inner = `<input type="text" id="m-${f}" value="${esc(v(f))}">`;
    }
    return `<div class="field ${f === "comment" ? "full" : ""}">
      <label>${LABELS[f]}</label>${inner}</div>`;
  }).join("");

  const srcChecks = names("sources").map((o) =>
    `<label class="chk"><input type="checkbox" class="src-chk" value="${esc(o)}"
      ${rec && rec.source === o ? "checked" : ""}> ${esc(o)}</label>`).join("");

  showModal(`
    <h2>${isEdit ? "Редактировать: " + esc(rec.domain || "") : "Новая запись"}</h2>
    <div class="form-grid">${grid}</div>
    <div class="sort-block ${(v("status") === SORT_STATUS) ? "" : "hidden"}" id="sort-block">
      <div class="sort-block-title">Сетки для сортировки
        <span class="hint">первая останется в «Домены», остальные продублируются в «Б/у»</span></div>
      <div class="sort-checks">${srcChecks}</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="m-cancel">Отмена</button>
      <button class="btn" id="m-save">Сохранить</button>
    </div>`);

  window.__toggleSort = () => {
    const st = $("m-status").value;
    $("sort-block").classList.toggle("hidden", st !== SORT_STATUS);
  };
  $("m-cancel").onclick = closeModal;
  $("m-save").onclick = async () => {
    const body = { section };
    if (isEdit) body.id = rec.id;
    FIELDS.forEach((f) => body[f] = $("m-" + f).value);
    if (body.status === SORT_STATUS) {
      body.sources_multi = [...document.querySelectorAll(".src-chk:checked")].map((c) => c.value);
    }
    try {
      await api("record/save", { method: "POST", body });
      closeModal(); flash("Сохранено"); route();
    } catch (e) { alert("Ошибка: " + e.message); }
  };
}

function openBulkModal(section) {
  const grid = FIELDS.filter((f) => f !== "domain").map((f) => {
    let inner;
    if (OPT_FIELDS.includes(f)) {
      const opts = optionsFor(f, "").map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
      inner = `<select id="b-${f}"><option value=""></option>${opts}</select>`;
    } else if (f === "date_taken") inner = `<input type="date" id="b-${f}">`;
    else inner = `<input type="text" id="b-${f}">`;
    return `<div class="field ${f === "comment" ? "full" : ""}"><label>${LABELS[f]}</label>${inner}</div>`;
  }).join("");

  showModal(`
    <h2>Оптовое добавление доменов</h2>
    <div class="field full"><label>Список доменов — по одному в строке</label>
      <textarea id="b-domains" rows="9" class="bulk-area"
        placeholder="example1.com&#10;example2.com&#10;…&#10;&#10;Можно с селлером: example.com, Бинго"></textarea>
      <span class="hint">После домена через запятую/Tab можно указать селлера для строки.</span>
    </div>
    <div class="bulk-shared-title">Общие поля — применятся ко всем</div>
    <div class="form-grid">${grid}</div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="b-cancel">Отмена</button>
      <button class="btn" id="b-save">Добавить все</button>
    </div>`);
  $("b-cancel").onclick = closeModal;
  $("b-save").onclick = async () => {
    const body = { section, domains_bulk: $("b-domains").value };
    FIELDS.filter((f) => f !== "domain").forEach((f) => body[f] = $("b-" + f).value);
    try {
      const d = await api("record/bulk_add", { method: "POST", body });
      closeModal(); flash("Добавлено доменов: " + d.count); route();
    } catch (e) { alert("Ошибка: " + e.message); }
  };
}

// generic modal
function showModal(html) {
  let bg = $("modal-bg");
  if (!bg) {
    bg = document.createElement("div");
    bg.id = "modal-bg"; bg.className = "modal-bg show";
    document.body.appendChild(bg);
  }
  bg.className = "modal-bg show";
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.onclick = (e) => { if (e.target === bg) closeModal(); };
}
function closeModal() { const bg = $("modal-bg"); if (bg) bg.className = "modal-bg"; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// ---------- view: sorting ----------
async function viewSorting() {
  const { rows } = await api("sorting");
  const sellers = names("sellers");
  const body = rows.map((r) => {
    const opts = sellers.map((s) =>
      `<option value="${esc(s)}" ${r.seller === s ? "selected" : ""}>${esc(s)}</option>`).join("");
    return `<tr>
      <td class="mono">${esc(r.domain)}</td><td>${esc(r.geo)}</td><td>${esc(r.team)}</td>
      <td>${esc(r.source)}</td><td>${esc(r.taker)}</td>
      <td><select class="filter-sel" data-seller="${r.id}">
        <option value="">— выбрать селлера —</option>${opts}</select></td>
      <td>${r.seller ? `<span class="pill pill-Принят">✓ готово</span>` : `<span class="dim">ожидает</span>`}</td>
    </tr>`;
  }).join("");
  $("view").innerHTML = `
    <div class="sec-head"><div><h1>Сортировка</h1>
      <div class="sub">Домены со статусом «На сортировку». Укажите селлера — он перенесётся в «Домены»/«Б/у», и заявка появится в «На отправку».</div></div></div>
    <div class="table-wrap">${rows.length ? `<table>
      <thead><tr><th>Домен</th><th>ГЕО</th><th>Команда</th><th>Сетка</th><th>Кто взял</th><th>Селлер</th><th></th></tr></thead>
      <tbody>${body}</tbody></table>` : `<div class="empty">Нет доменов на сортировке.</div>`}</div>`;
  document.querySelectorAll("[data-seller]").forEach((s) =>
    s.onchange = async () => {
      await api("sorting/set_seller", { method: "POST", body: { id: s.dataset.seller, seller: s.value } });
      flash("Селлер указан и перенесён в Домены/Б-У"); route();
    });
}

// ---------- view: sending ----------
async function viewSending(key) {
  const teams = names("teams");
  const idx = parseInt(key, 10);
  const team = teams[idx] !== undefined ? teams[idx] : key;
  const data = await api("sending?team=" + encodeURIComponent(team));
  const tabs = teams.map((t, i) =>
    `<a class="btn ${t !== team ? "btn-ghost" : ""}" href="#/sending/${i}">${esc(t)}</a>`).join("");
  const cards = data.requests.map((g) => `
    <div class="req-card">
      <div class="req-head">
        <div><div class="req-seller">${esc(g.seller)}</div>
          <div class="req-count">${g.count} домен(ов)</div></div>
        <div class="req-actions">
          <button class="btn btn-sm btn-ghost copy-btn" data-copy="${esc(g.copy_text)}">⧉ Скопировать</button>
          <button class="btn btn-sm btn-sent" data-sent="${esc(JSON.stringify(g.ids))}"
            data-seller="${esc(g.seller)}" data-count="${g.count}" data-key="${idx}">✓ Отправлено</button>
        </div>
      </div>
      <table class="req-table"><thead><tr><th>Сетка</th><th>ГЕО</th><th>Домен</th></tr></thead>
        <tbody>${g.items.map((it) =>
          `<tr><td>${esc(it.source)}</td><td>${esc(it.geo)}</td><td class="mono">${esc(it.domain)}</td></tr>`).join("")}</tbody>
      </table></div>`).join("");
  $("view").innerHTML = `
    <div class="sec-head"><div><h1>На отправку — ${esc(team)}</h1>
      <div class="sub">Домены сгруппированы в заявки по селлеру. Всего доменов: ${data.total}.</div></div>
      <div class="head-actions">${tabs}</div></div>
    ${data.requests.length ? `<div class="req-grid">${cards}</div>` :
      `<div class="table-wrap"><div class="empty">Нет заявок для «${esc(team)}». Домены появляются после указания селлера в «Сортировке».</div></div>`}`;

  document.querySelectorAll(".copy-btn").forEach((b) => b.onclick = () => {
    const text = b.dataset.copy;
    const done = () => { const o = b.textContent; b.textContent = "✓ Скопировано";
      b.classList.add("copied"); setTimeout(() => { b.textContent = o; b.classList.remove("copied"); }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  });
  document.querySelectorAll("[data-sent]").forEach((b) => b.onclick = async () => {
    if (!confirm(`Отметить ${b.dataset.count} домен(ов) селлера «${b.dataset.seller}» как отправленные?\nИм будет проставлена сегодняшняя дата и статус «Модерация».`)) return;
    await api("sending/mark_sent", { method: "POST", body: { ids: JSON.parse(b.dataset.sent) } });
    flash("Отправлено: статус «Модерация», сегодняшняя дата"); route();
  });
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta); done();
}

// ---------- view: Модерация / Ожидаемое ----------
// kind: "moderation" -> входной статус "Модерация", в выпадашке смена статуса
// kind: "expected"   -> входной статус "Принят",    одна кнопка "Выдан"
async function viewStatusQueue(kind) {
  const config = {
    moderation: {
      title: "В процессе модерации",
      sub: "Все домены со статусом «Модерация». Розовым подсвечены те, что висят больше 30 дней.",
      inStatus: "Модерация",
      nextStatuses: ["На стоп", "Принят", "Отказ", "Правки"],
      hl: true,
    },
    expected: {
      title: "Ожидаемое",
      sub: "Домены со статусом «Принят». Нажмите «Выдан», когда домен передан.",
      inStatus: "Принят",
      nextStatuses: null,
      hl: false,
    },
  }[kind];

  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const filters = [["team", "Команда"], ["source", "Сетка"], ["taker", "Участник"]];
  const sel = {}; filters.forEach(([f]) => sel[f] = qs.get(f) || "");

  // тянем все записи с нужным статусом одним запросом
  const params = new URLSearchParams({ section: "domains" });   // временно
  // используем общий endpoint /api/records, но без раздела —
  // фильтруем по статусу на клиенте уже отдадим всех; сервер требует section.
  // Делаем два запроса (domains+reused) и склеиваем — это редкий запрос, ок.
  const [d1, d2] = await Promise.all([
    api("records?section=domains&status=" + encodeURIComponent(config.inStatus)),
    api("records?section=reused&status=" + encodeURIComponent(config.inStatus)),
  ]);
  let rows = [...d1.rows, ...d2.rows];

  // применяем фильтры
  for (const [f] of filters) {
    if (sel[f]) rows = rows.filter((r) => (r[f] || "") === sel[f]);
  }
  rows.sort((a, b) => (a.date_taken || "").localeCompare(b.date_taken || ""));

  // опции фильтров — только из видимого набора (до фильтрации тех же полей)
  const baseRows = [...d1.rows, ...d2.rows];
  const optsFor = (f) => [...new Set(baseRows.map((r) => r[f]).filter(Boolean))].sort();
  const filterSelects = filters.map(([f, label]) => {
    const opts = optsFor(f).map((o) =>
      `<option value="${esc(o)}" ${sel[f] === o ? "selected" : ""}>${esc(o)}</option>`).join("");
    return `<select class="filter-sel" data-qfilter="${f}">
      <option value="">${esc(label)}: все</option>${opts}</select>`;
  }).join("");
  const anyFilter = Object.values(sel).some(Boolean);

  // подсчёт дней «висит» — от date_taken до сегодня
  const today = new Date();
  const daysAgo = (s) => {
    if (!s) return null;
    const d = new Date(s + "T00:00:00Z"); if (isNaN(d)) return null;
    return Math.floor((today - d) / 86400000);
  };

  const body = rows.map((r) => {
    const age = daysAgo(r.date_taken);
    const stale = config.hl && age !== null && age > 30;
    const ageBadge = age == null ? `<span class="dim">—</span>`
      : (stale ? `<span class="pill pill-stale">${age} дн.</span>`
               : `<span class="dim">${age} дн.</span>`);
    let actionCell;
    if (config.nextStatuses) {
      const opts = config.nextStatuses.map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`).join("");
      actionCell = `<select class="filter-sel" data-setstatus="${r.id}">
        <option value="">— сменить статус —</option>${opts}</select>`;
    } else {
      actionCell = `<button class="btn btn-sm btn-sent" data-issue="${r.id}" data-dom="${esc(r.domain)}">✓ Выдан</button>`;
    }
    return `<tr class="${stale ? "row-stale" : ""}">
      <td class="mono">${esc(r.domain)}</td>
      <td>${esc(r.team)}</td>
      <td>${esc(r.source)}</td>
      <td>${esc(r.seller)}</td>
      <td>${esc(r.taker)}</td>
      <td class="mono dim">${esc(r.date_taken || "")}</td>
      <td>${ageBadge}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join("");

  $("view").innerHTML = `
    <div class="sec-head">
      <div><h1>${esc(config.title)}</h1>
        <div class="sub">${esc(config.sub)} ${anyFilter ? "Найдено" : "Всего"}: ${rows.length}.</div>
      </div>
    </div>
    <div class="filter-bar">
      ${filterSelects}
      ${anyFilter ? `<a class="reset-link" id="q-reset">Сбросить</a>` : ""}
    </div>
    <div class="table-wrap">${rows.length ? `<table>
      <thead><tr><th>Домен</th><th>Команда</th><th>Сетка</th><th>Селлер</th>
        <th>Участник</th><th>Дата</th><th>На модерации</th><th>Действие</th></tr></thead>
      <tbody>${body}</tbody></table>` :
      `<div class="empty">Нет доменов в этом списке.</div>`}</div>`;

  // фильтры
  const applyFilter = () => {
    const p = new URLSearchParams();
    document.querySelectorAll("[data-qfilter]").forEach((s) => {
      if (s.value) p.set(s.dataset.qfilter, s.value);
    });
    location.hash = `#/${kind}${p.toString() ? "?" + p.toString() : ""}`;
  };
  document.querySelectorAll("[data-qfilter]").forEach((s) => s.onchange = applyFilter);
  if ($("q-reset")) $("q-reset").onclick = (e) => { e.preventDefault(); location.hash = "#/" + kind; };

  // смена статуса (раздел Модерация)
  document.querySelectorAll("[data-setstatus]").forEach((s) => s.onchange = async (e) => {
    const newStatus = e.target.value; if (!newStatus) return;
    try {
      await api("record/set_status", {
        method: "POST", body: { id: s.dataset.setstatus, status: newStatus },
      });
      flash(`Статус изменён на «${newStatus}»`); route();
    } catch (err) { alert("Ошибка: " + err.message); }
  });

  // выдача (раздел Ожидаемое)
  document.querySelectorAll("[data-issue]").forEach((b) => b.onclick = async () => {
    if (!confirm(`Поставить домену «${b.dataset.dom}» статус «Выдан»?`)) return;
    try {
      await api("record/set_status", {
        method: "POST", body: { id: b.dataset.issue, status: "Выдан" },
      });
      flash("Домен выдан"); route();
    } catch (err) { alert("Ошибка: " + err.message); }
  });
}

// ---------- view: stats ----------
async function viewStats() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const period = qs.get("period") || "all", value = qs.get("value") || "";
  const s = await api(`stats?period=${period}&value=${encodeURIComponent(value)}`);
  const cell = (v) => v ? `<span>${v}</span>` : `<span class="zero">0</span>`;

  const monthSel = `<select class="filter-sel" id="month-sel" style="${s.period === "month" ? "" : "display:none"}">
    <option value="">— выберите месяц —</option>
    ${s.month_options.map((o) => `<option value="${esc(o.value)}" ${s.period === "month" && s.value === o.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  const weekSel = `<select class="filter-sel" id="week-sel" style="${s.period === "week" ? "" : "display:none"}">
    <option value="">— выберите неделю —</option>
    ${s.week_options.map((o) => `<option value="${esc(o.value)}" ${s.period === "week" && s.value === o.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;

  const kpis = `<div class="kpis">
    <div class="kpi"><div class="label">Всего доменов</div><div class="value amber">${s.grand_total}</div></div>
    ${s.block1.map((b) => `<div class="kpi"><div class="label">Команда ${esc(b.team)}</div><div class="value">${b.total}</div></div>`).join("")}
    <div class="kpi"><div class="label">Первичные / Б/у</div><div class="value green">${s.block1_total.domains}<span style="color:var(--muted);font-size:20px"> / </span><span class="blue">${s.block1_total.reused}</span></div></div>
  </div>`;

  const t1 = `<div class="stat-block"><h2><span class="badge">1</span> Всего доменов по командам</h2>
    <div class="table-wrap"><table class="stats-table">
    <thead><tr><th>Команда</th><th>Домены</th><th>Б/у</th><th>Итого</th></tr></thead><tbody>
    ${s.block1.map((b) => `<tr><td class="label-cell">${esc(b.team)}</td><td class="num">${cell(b.domains)}</td><td class="num">${cell(b.reused)}</td><td class="num tot-col">${b.total}</td></tr>`).join("")}
    </tbody><tfoot><tr><td>Всего</td><td class="num">${s.block1_total.domains}</td><td class="num">${s.block1_total.reused}</td><td class="num">${s.block1_total.total}</td></tr></tfoot></table></div></div>`;

  const t2 = `<div class="stat-block"><h2><span class="badge">2</span> Домены в разрезе по сеткам</h2>
    <div class="table-wrap"><table class="stats-table"><thead><tr><th>Команда</th>
    ${s.sources.map((x) => `<th>${esc(x)}</th>`).join("")}<th>Итого</th></tr></thead><tbody>
    ${s.block2.map((b) => `<tr><td class="label-cell">${esc(b.team)}</td>${s.sources.map((x) => `<td class="num">${cell(b.cells[x])}</td>`).join("")}<td class="num tot-col">${b.total}</td></tr>`).join("")}
    </tbody></table></div></div>`;

  const t3 = `<div class="stat-block"><h2><span class="badge">3</span> Статусы в Сетке 1 (раздел «Домены»)</h2>
    <div class="table-wrap"><table class="stats-table"><thead><tr><th>Статус</th>
    ${s.teams.map((t) => `<th>${esc(t)}</th>`).join("")}<th>Итого</th></tr></thead><tbody>
    ${s.block3.map((b) => `<tr><td class="label-cell">${esc(b.status)}</td>${s.teams.map((t) => `<td class="num">${cell(b.per[t])}</td>`).join("")}<td class="num tot-col">${b.total}</td></tr>`).join("")}
    </tbody></table></div></div>`;

  const t4 = `<div class="stat-block"><h2><span class="badge">4</span> Статусы по селлерам и сеткам</h2>
    <div class="table-wrap"><table class="stats-table"><thead><tr><th>Селлер</th><th>Сетка</th>
    ${s.statuses.map((x) => `<th>${esc(x)}</th>`).join("")}<th>Итого</th></tr></thead><tbody>
    ${s.block4.length ? s.block4.map((b) => `<tr><td class="label-cell">${esc(b.seller)}</td><td>${esc(b.source)}</td>${s.statuses.map((x) => `<td class="num">${cell(b.counts[x])}</td>`).join("")}<td class="num tot-col">${b.total}</td></tr>`).join("") : `<tr><td colspan="20" class="empty">Нет данных</td></tr>`}
    </tbody></table></div></div>`;

  const t5 = `<div class="stat-block"><h2><span class="badge">5</span> Статусы по «Кто взял в работу»</h2>
    <div class="table-wrap"><table class="stats-table"><thead><tr><th>Участник</th>
    ${s.statuses.map((x) => `<th>${esc(x)}</th>`).join("")}<th>Итого</th></tr></thead><tbody>
    ${s.block5.length ? s.block5.map((b) => `<tr><td class="label-cell">${esc(b.taker)}</td>${s.statuses.map((x) => `<td class="num">${cell(b.counts[x])}</td>`).join("")}<td class="num tot-col">${b.total}</td></tr>`).join("") : `<tr><td colspan="20" class="empty">Нет данных</td></tr>`}
    </tbody></table></div></div>`;

  const monthCols = (mapObj, keys) => `<div class="table-wrap"><table class="stats-table">
    <thead><tr><th></th>${s.months.map((m) => `<th>${esc(m)}</th>`).join("")}<th>Итого</th></tr></thead><tbody>
    ${keys.map((k) => { let tot = 0; const cells = s.months.map((m) => { const v = mapObj[k][m] || 0; tot += v; return `<td class="num">${cell(v)}</td>`; }).join(""); return `<tr><td class="label-cell">${esc(k)}</td>${cells}<td class="num tot-col">${tot}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  const t6a = `<div class="stat-block"><h2><span class="badge">6</span> Домены по месяцам × команда</h2>${monthCols(s.by_team_month, s.teams)}</div>`;
  const t6b = `<div class="stat-block"><h2><span class="badge">6</span> Домены по месяцам × участник</h2>${monthCols(s.by_member_month, s.members)}</div>`;

  $("view").innerHTML = `
    <div class="sec-head"><div><h1>Статистика</h1>
      <div class="sub">Считается автоматически из «Домены» и «Б/у».</div></div></div>
    <div class="filter-bar">
      <span class="filter-label">Период:</span>
      <div class="seg">
        <button class="seg-btn ${s.period === "all" ? "on" : ""}" data-p="all">За всё время</button>
        <button class="seg-btn ${s.period === "month" ? "on" : ""}" data-p="month">Месяц</button>
        <button class="seg-btn ${s.period === "week" ? "on" : ""}" data-p="week">Неделя</button>
      </div>${monthSel}${weekSel}
      <span class="filter-applied">Показано: <b>${esc(s.applied)}</b> · записей: <b>${s.grand_total}</b></span>
    </div>
    ${kpis}${t1}${t2}${t3}${t4}${t5}${t6a}${t6b}`;

  document.querySelectorAll(".seg-btn").forEach((b) => b.onclick = () => {
    const p = b.dataset.p;
    if (p === "all") location.hash = "#/stats";
    else {
      $("month-sel").style.display = p === "month" ? "" : "none";
      $("week-sel").style.display = p === "week" ? "" : "none";
    }
  });
  if ($("month-sel")) $("month-sel").onchange = (e) => { if (e.target.value) location.hash = `#/stats?period=month&value=${encodeURIComponent(e.target.value)}`; };
  if ($("week-sel")) $("week-sel").onchange = (e) => { if (e.target.value) location.hash = `#/stats?period=week&value=${encodeURIComponent(e.target.value)}`; };
}

// ---------- view: settings ----------
const REF_LABELS = { teams:"Команды", members:"Участники (кто взял в работу)",
  servers:"Сервера", sources:"Источники / Сетки", sellers:"Селлеры",
  statuses:"Статусы", geos:"ГЕО" };

async function viewSettings() {
  REFS = await api("refs");          // refresh
  renderNav();
  const teams = names("teams");
  const cards = Object.keys(REF_LABELS).map((table) => {
    const items = REFS[table] || [];
    const list = items.map((it) => `
      <div class="ref-item">
        <input class="name-edit" value="${esc(it.name)}" data-ren="${it.id}" data-table="${table}">
        ${table === "members" && it.team ? `<span class="team-tag">${esc(it.team)}</span>` : ""}
        <button class="icon-btn save" data-saveren="${it.id}" data-table="${table}" title="Сохранить">✓</button>
        <button class="icon-btn" data-del="${it.id}" data-table="${table}" data-name="${esc(it.name)}" title="Удалить">✕</button>
      </div>`).join("") || `<div class="dim">Пусто</div>`;
    const teamSel = table === "members"
      ? `<select id="addteam-${table}"><option value="">— команда —</option>${teams.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select>` : "";
    return `<div class="ref-card"><h3>${REF_LABELS[table]} <span class="dim" style="font-weight:400">· ${items.length}</span></h3>
      <div class="ref-list">${list}</div>
      <div class="ref-add"><input id="addname-${table}" placeholder="Добавить…">${teamSel}
        <button class="btn btn-sm" data-add="${table}">+</button></div></div>`;
  }).join("");
  $("view").innerHTML = `
    <div class="sec-head"><div><h1>Справочники</h1>
      <div class="sub">Команды, участники, сервера, источники, селлеры, статусы и ГЕО. Подставляются в выпадающие списки.</div></div></div>
    <div class="ref-grid">${cards}</div>`;

  document.querySelectorAll("[data-add]").forEach((b) => b.onclick = async () => {
    const table = b.dataset.add;
    const name = $("addname-" + table).value.trim(); if (!name) return;
    const team = table === "members" ? $("addteam-" + table).value : undefined;
    try { await api("ref", { method: "POST", body: { action: "add", table, name, team } });
      flash("Добавлено"); route(); }
    catch (e) { alert(e.message); }
  });
  document.querySelectorAll("[data-saveren]").forEach((b) => b.onclick = async () => {
    const inp = document.querySelector(`[data-ren="${b.dataset.saveren}"][data-table="${b.dataset.table}"]`);
    await api("ref", { method: "POST", body: { action: "rename", table: b.dataset.table, id: b.dataset.saveren, name: inp.value.trim() } });
    flash("Переименовано"); route();
  });
  document.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm(`Удалить «${b.dataset.name}» из справочника?`)) return;
    await api("ref", { method: "POST", body: { action: "delete", table: b.dataset.table, id: b.dataset.del } });
    flash("Удалено"); route();
  });
}

// ---------- boot ----------
async function boot() {
  try { await api("me"); }
  catch (e) { showLogin(); return; }
  showApp();
  REFS = await api("refs");
  renderNav();
  if (!location.hash) location.hash = "#/domains";
  route();
}

$("login-btn").onclick = doLogin;
$("login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
$("logout").onclick = async (e) => { e.preventDefault();
  await fetch("/api/logout", { method: "POST" }); showLogin(); };
window.addEventListener("hashchange", route);
boot();
