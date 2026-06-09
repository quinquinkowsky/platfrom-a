"use strict";

const FIELDS = ["domain","server","geo","seller","source","team","rating",
                "comment","date_taken","taker","status"];
const LABELS = {domain:"Домен",server:"Сервер",geo:"ГЕО",seller:"Селлер",
  source:"Сетка / источник",team:"Команда",rating:"Рейтинг",
  comment:"Почта",date_taken:"Дата взятия в работу",
  taker:"Кто взял в работу",status:"Статус"};
const OPT_FIELDS = ["server","geo","seller","source","team","taker","status","rating"];
// поля, которые обязательно заполнять при создании/редактировании
const REQUIRED_FIELDS = ["domain","server","team","rating"];
// фиксированные варианты для Рейтинга
const RATING_OPTIONS = ["0", "60-79", "80+"];
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
    <a href="#/all" data-v="all">Сводный</a>
    <a href="#/sorting" data-v="sorting">Сортировка</a>
    <div class="tab-drop"><a data-v="sending">На отправку ▾</a>
      <div class="tab-menu">${sendMenu}</div></div>
    <a href="#/moderation" data-v="moderation">Модерация</a>
    <a href="#/expected" data-v="expected">Ожидаемое</a>
    <a href="#/picker" data-v="picker">Подбор доменов</a>
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
    else if (view === "all") await viewRecords("all");
    else if (view === "sorting") await viewSorting();
    else if (view === "sending") await viewSending(parts[1] || "0");
    else if (view === "moderation") await viewStatusQueue("moderation");
    else if (view === "expected") await viewStatusQueue("expected");
    else if (view === "picker") await viewPicker(parts[1]);
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
  ["q", "avail", "page", ...LIST_FILTERS.map((f) => f[0])].forEach((k) => {
    if (qs.get(k)) params.set(k, qs.get(k));
  });
  const data = await api("records?" + params.toString());
  const rows = data.rows;
  const total = data.total || rows.length;
  const pageSize = data.page_size || 250;
  const curPage = data.page || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isAll = section === "all";
  const title = isAll ? "Сводный лист"
    : (section === "reused" ? "Б/у (повторное использование)" : "Домены");
  const subtitle = isAll
    ? "Все домены из «Домены» и «Б/у». Только просмотр, фильтрация и редактирование."
    : null;
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
  // дополнительный фильтр «раздел» для сводного листа
  const secVal = qs.get("sec") || "";
  const secSelect = isAll ? `<select class="filter-sel" data-filter="sec">
    <option value="">Раздел: все</option>
    <option value="domains" ${secVal === "domains" ? "selected" : ""}>Домены</option>
    <option value="reused"  ${secVal === "reused"  ? "selected" : ""}>Б/у</option>
  </select>` : "";

  // в «all» фильтр по секции применяем на клиенте, потому что бэкенд не знает «sec»
  const visibleRows = (isAll && secVal)
    ? rows.filter((r) => r.section === secVal) : rows;

  const anyFilter = q || Object.values(sel).some(Boolean) || availVal || secVal;

  const body = visibleRows.map((r) => {
    const busy = (r.taker || "").trim() !== "";
    const availPill = busy
      ? `<span class="pill pill-busy">● занят</span>`
      : `<span class="pill pill-free">○ свободен</span>`;
    const sectionCell = isAll
      ? `<td><span class="pill ${r.section === "reused" ? "pill-Правки" : "pill-Принят"}" style="font-size:10px">${r.section === "reused" ? "Б/у" : "Домены"}</span></td>`
      : "";
    return `
    <tr>
      ${sectionCell}
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

  const sectionHeader = isAll ? `<th>Раздел</th>` : "";
  // в сводном — без кнопок добавления
  const headActions = isAll ? "" : `
      <div class="head-actions">
        <button class="btn btn-ghost" id="bulk-open">⊞ Оптом</button>
        <button class="btn" id="add-open">+ Добавить</button>
      </div>`;

  // блок пагинации (показываем, только если страниц больше одной)
  const fromN = total === 0 ? 0 : curPage * pageSize + 1;
  const toN = Math.min(total, curPage * pageSize + visibleRows.length);
  const pagerBlock = totalPages > 1 ? `
    <div class="pager">
      <button class="btn btn-sm btn-ghost" id="page-prev" ${curPage === 0 ? "disabled" : ""}>← Назад</button>
      <span class="pager-info">Страница <b>${curPage + 1}</b> из <b>${totalPages}</b> · показано ${fromN}–${toN} из ${total}</span>
      <button class="btn btn-sm btn-ghost" id="page-next" ${curPage >= totalPages - 1 ? "disabled" : ""}>Вперёд →</button>
    </div>` : "";

  $("view").innerHTML = `
    <div class="sec-head">
      <div><h1>${esc(title)}</h1>
        <div class="sub">${subtitle ? esc(subtitle) + " · " : ""}${anyFilter ? "Найдено" : "Всего записей"}: ${total}${totalPages > 1 ? ` · показано ${visibleRows.length} (стр. ${curPage + 1}/${totalPages})` : ""}</div></div>
      ${headActions}
    </div>
    <div class="filter-bar">
      <input class="search" id="f-q" value="${esc(q)}" placeholder="Поиск: домен, селлер…">
      ${secSelect}${filterSelects}${availSelect}
      <button class="btn btn-sm" id="apply-filter">Применить</button>
      ${anyFilter ? `<a class="reset-link" id="reset-filter">Сбросить</a>` : ""}
    </div>
    <div class="table-wrap">${visibleRows.length ? `<table class="records-table">
      <thead><tr>${sectionHeader}<th>Домен</th><th>Сервер</th><th>ГЕО</th><th>Селлер</th><th>Сетка</th>
        <th>Команда</th><th>Рейтинг</th><th>Занятость</th><th>Дата</th><th>Кто взял</th>
        <th>Статус</th><th>Почта</th><th>Действия</th></tr></thead>
      <tbody>${body}</tbody></table>` :
      `<div class="empty">Нет записей.</div>`}</div>
    ${pagerBlock}`;

  // wire filters
  // фильтр сбрасывает страницу на первую
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
  if ($("add-open")) $("add-open").onclick = () => openRecordModal(section, null);
  if ($("bulk-open")) $("bulk-open").onclick = () => openBulkModal(section);
  document.querySelectorAll("[data-edit]").forEach((b) =>
    b.onclick = () => {
      const r = JSON.parse(b.dataset.edit);
      // в Сводном редактируем сохраняя оригинальную секцию записи,
      // чтобы случайно не «перенести» её при сохранении
      openRecordModal(r.section || section, r);
    });
  document.querySelectorAll("[data-del]").forEach((b) =>
    b.onclick = async () => {
      if (!confirm("Удалить запись " + b.dataset.dom + "?")) return;
      await api("record/delete", { method: "POST", body: { id: b.dataset.del } });
      flash("Запись удалена"); route();
    });
  // пагинация: меняем только параметр page в текущем URL
  const gotoPage = (p) => {
    const cur = new URLSearchParams(location.hash.split("?")[1] || "");
    if (p === 0) cur.delete("page"); else cur.set("page", String(p));
    location.hash = `#/${section}?${cur.toString()}`;
  };
  if ($("page-prev")) $("page-prev").onclick = () => { if (curPage > 0) gotoPage(curPage - 1); };
  if ($("page-next")) $("page-next").onclick = () => { if (curPage < totalPages - 1) gotoPage(curPage + 1); };
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
  else if (field === "rating") {
    // фиксированный список + любое уже сохранённое значение, если оно нестандартное
    const set = new Set(RATING_OPTIONS);
    if (current) set.add(current);
    return [...set];   // не сортируем, чтобы порядок 0 / 60-79 / 80+ сохранялся
  }
  const set = new Set(vals); if (current) set.add(current);
  return [...set].sort();
}

function openRecordModal(section, rec) {
  const isEdit = !!rec;
  const v = (f) => rec ? (rec[f] == null ? "" : rec[f]) : "";
  const grid = FIELDS.map((f) => {
    const required = REQUIRED_FIELDS.includes(f);
    const reqMark = required ? `<span class="req">*</span>` : "";
    let inner;
    if (OPT_FIELDS.includes(f)) {
      const opts = optionsFor(f, v(f)).map((o) =>
        `<option value="${esc(o)}" ${v(f) === o ? "selected" : ""}>${esc(o)}</option>`).join("");
      inner = `<select id="m-${f}" data-field="${f}" ${f === "status" ? 'onchange="window.__toggleSort()"' : ""}>
        <option value=""></option>${opts}</select>`;
    } else if (f === "date_taken") {
      inner = `<input type="date" id="m-${f}" data-field="${f}" value="${esc(v(f) || "")}">`;
    } else {
      inner = `<input type="text" id="m-${f}" data-field="${f}" value="${esc(v(f))}">`;
    }
    return `<div class="field ${f === "comment" ? "full" : ""}">
      <label>${LABELS[f]}${reqMark}</label>${inner}</div>`;
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
    <div class="form-err" id="m-err"></div>
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
    // валидация обязательных полей
    const missing = [];
    REQUIRED_FIELDS.forEach((f) => {
      const el = $("m-" + f);
      const ok = el && el.value.trim() !== "";
      if (el) el.classList.toggle("invalid", !ok);
      if (!ok) missing.push(LABELS[f]);
    });
    if (missing.length) {
      $("m-err").textContent = "Заполните: " + missing.join(", ");
      return;
    }
    $("m-err").textContent = "";

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
    const required = REQUIRED_FIELDS.includes(f);
    const reqMark = required ? `<span class="req">*</span>` : "";
    let inner;
    if (OPT_FIELDS.includes(f)) {
      const opts = optionsFor(f, "").map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
      inner = `<select id="b-${f}" data-field="${f}"><option value=""></option>${opts}</select>`;
    } else if (f === "date_taken") inner = `<input type="date" id="b-${f}" data-field="${f}">`;
    else inner = `<input type="text" id="b-${f}" data-field="${f}">`;
    return `<div class="field ${f === "comment" ? "full" : ""}"><label>${LABELS[f]}${reqMark}</label>${inner}</div>`;
  }).join("");

  showModal(`
    <h2>Оптовое добавление доменов</h2>
    <div class="field full"><label>Список доменов — по одному в строке<span class="req">*</span></label>
      <textarea id="b-domains" rows="9" class="bulk-area"
        placeholder="example1.com&#10;example2.com&#10;…&#10;&#10;Можно с селлером: example.com, Бинго"></textarea>
      <span class="hint">После домена через запятую/Tab можно указать селлера для строки.</span>
    </div>
    <div class="bulk-shared-title">Общие поля — применятся ко всем (* — обязательные)</div>
    <div class="form-grid">${grid}</div>
    <div class="form-err" id="b-err"></div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="b-cancel">Отмена</button>
      <button class="btn" id="b-save">Добавить все</button>
    </div>`);
  $("b-cancel").onclick = closeModal;
  $("b-save").onclick = async () => {
    // валидация: список + обязательные общие поля (domain исключён — он из textarea)
    const missing = [];
    const textarea = $("b-domains");
    const hasDomains = textarea.value.trim() !== "";
    textarea.classList.toggle("invalid", !hasDomains);
    if (!hasDomains) missing.push("Список доменов");
    REQUIRED_FIELDS.filter((f) => f !== "domain").forEach((f) => {
      const el = $("b-" + f);
      const ok = el && el.value.trim() !== "";
      if (el) el.classList.toggle("invalid", !ok);
      if (!ok) missing.push(LABELS[f]);
    });
    if (missing.length) {
      $("b-err").textContent = "Заполните: " + missing.join(", ");
      return;
    }
    $("b-err").textContent = "";

    const body = { section, domains_bulk: textarea.value };
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
  // фильтры передаются через хэш ?status=...&source=...
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const fStatus = qs.get("status") || "all";   // all | sorted | unsorted
  const fSource = qs.get("source") || "";

  const { rows: allRows } = await api("sorting");
  const sellers = names("sellers");

  // применяем фильтры на клиенте
  const rows = allRows.filter((r) => {
    if (fStatus === "sorted" && !r.seller) return false;
    if (fStatus === "unsorted" && r.seller) return false;
    if (fSource && r.source !== fSource) return false;
    return true;
  });

  // динамический список сеток — из того, что реально есть в Сортировке
  const sourcesPresent = [...new Set(allRows.map((r) => r.source).filter(Boolean))].sort();

  // помощник для URL фильтра
  const link = (patch) => {
    const p = new URLSearchParams({ status: fStatus, source: fSource });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k); else p.set(k, v);
    }
    return "#/sorting?" + p.toString();
  };

  const body = rows.map((r) => {
    const prev = (r.prev_seller || "").trim();
    // в выпадашке подсвечиваем предыдущего селлера (был — не дублируем)
    const opts = sellers.map((s) => {
      const mark = (s === prev) ? " ⚠" : "";
      return `<option value="${esc(s)}" ${r.seller === s ? "selected" : ""}>${esc(s)}${mark}${s === prev ? " (был)" : ""}</option>`;
    }).join("");
    return `<tr${prev ? ' class="row-with-prev"' : ""}>
      <td class="mono">${esc(r.domain)}</td><td>${esc(r.geo)}</td><td>${esc(r.team)}</td>
      <td>${esc(r.source)}</td><td>${esc(r.taker)}</td>
      <td>${prev ? `<span class="pill pill-Правки" title="Этот домен ранее был у этого селлера — не назначайте его снова">⚠ был у ${esc(prev)}</span>` : `<span class="dim">—</span>`}</td>
      <td><select class="filter-sel" data-seller="${r.id}" data-prev="${esc(prev)}">
        <option value="">— выбрать селлера —</option>${opts}</select></td>
      <td><input class="email-input" data-email="${r.id}" value="${esc(r.comment || "")}" placeholder="почта"></td>
      <td><input class="email-input" data-adtype="${r.id}" value="${esc(r.ad_type || "")}" placeholder="type of ads"></td>
      <td>${r.seller ? `<span class="pill pill-Принят">✓ готово</span>` : `<span class="dim">ожидает</span>`}</td>
    </tr>`;
  }).join("");

  // фильтр-бар
  const sourceOpts = `<option value="">Все сетки</option>` +
    sourcesPresent.map((s) => `<option value="${esc(s)}" ${fSource === s ? "selected" : ""}>${esc(s)}</option>`).join("");

  const countAll = allRows.length;
  const countSorted = allRows.filter((r) => r.seller).length;
  const countUnsorted = countAll - countSorted;

  $("view").innerHTML = `
    <div class="sec-head"><div><h1>Сортировка</h1>
      <div class="sub">Домены со статусом «На сортировку». Укажите селлера и (по желанию) почту — она попадёт в карточку заявки и в Telegram-сообщение.</div></div></div>
    <div class="filter-bar">
      <div class="seg">
        <a class="seg-btn ${fStatus === "all" ? "on" : ""}" href="${link({ status: "all" })}">Все · ${countAll}</a>
        <a class="seg-btn ${fStatus === "unsorted" ? "on" : ""}" href="${link({ status: "unsorted" })}">Не отсортированные · ${countUnsorted}</a>
        <a class="seg-btn ${fStatus === "sorted" ? "on" : ""}" href="${link({ status: "sorted" })}">Отсортированные · ${countSorted}</a>
      </div>
      <select class="filter-sel" id="src-sel">${sourceOpts}</select>
      <span class="filter-applied">Показано: <b>${rows.length}</b> из <b>${allRows.length}</b></span>
    </div>
    <div class="table-wrap">${rows.length ? `<table>
      <thead><tr><th>Домен</th><th>ГЕО</th><th>Команда</th><th>Сетка</th><th>Кто взял</th><th>Был у</th><th>Селлер</th><th>Почта</th><th>Type of ADS</th><th></th></tr></thead>
      <tbody>${body}</tbody></table>` : `<div class="empty">Нет доменов под фильтр.</div>`}</div>`;

  // фильтр по сетке — переход по ссылке
  $("src-sel").onchange = (e) => { location.hash = link({ source: e.target.value }); };

  // выбор селлера: если совпадает с prev — подтверждение
  document.querySelectorAll("[data-seller]").forEach((s) =>
    s.onchange = async () => {
      const prev = (s.dataset.prev || "").trim();
      const picked = s.value;
      if (picked && prev && picked === prev) {
        if (!confirm(`Вы выбираете «${picked}», у которого этот домен уже был раньше. Точно назначить снова?`)) {
          // вернуть предыдущее значение, не сохранять
          s.value = "";
          return;
        }
      }
      await api("sorting/set_seller", { method: "POST", body: { id: s.dataset.seller, seller: picked } });
      flash("Селлер указан и перенесён в Домены/Б-У"); route();
    });

  // инлайн-сохранение почты / Type of ADS при blur / Enter
  const inlineSave = async (inp, apiPath, fieldKey, datasetKey) => {
    if (inp.dataset.last === inp.value) return;
    try {
      await api(apiPath, { method: "POST",
        body: { id: inp.dataset[datasetKey], [fieldKey]: inp.value } });
      inp.dataset.last = inp.value;
      inp.classList.add("saved");
      setTimeout(() => inp.classList.remove("saved"), 800);
    } catch (e) { alert("Ошибка: " + e.message); }
  };
  const wireInline = (selector, apiPath, fieldKey, datasetKey) => {
    document.querySelectorAll(selector).forEach((inp) => {
      inp.dataset.last = inp.value;
      inp.addEventListener("blur", () => inlineSave(inp, apiPath, fieldKey, datasetKey));
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      });
    });
  };
  wireInline("[data-email]",  "record/set_email",   "email",   "email");
  wireInline("[data-adtype]", "record/set_ad_type", "ad_type", "adtype");
}

// ---------- view: sending ----------
async function viewSending(key) {
  const teams = names("teams");
  const idx = parseInt(key, 10);
  const team = teams[idx] !== undefined ? teams[idx] : key;
  const data = await api("sending?team=" + encodeURIComponent(team));

  // map seller name -> {base chat_id, overrides[]} для оценки доступности TG по паре
  const sellerMap = Object.fromEntries((REFS.sellers || []).map((s) => [s.name, {
    chat_id: s.chat_id || "",
    overrides: s.overrides || [],
  }]));
  // даёт effective chat_id для тройки (seller, team, source).
  // Приоритет: (team+source) > team > база.
  const effectiveChat = (seller, source) => {
    const info = sellerMap[seller];
    if (!info) return "";
    const ovs = info.overrides.filter((o) => o.team === team);
    // (team + source)
    if (source) {
      const ov = ovs.find((o) => o.source === source);
      if (ov && (ov.chat_id || "").trim()) return ov.chat_id.trim();
    }
    // (team) — без сетки
    const ovT = ovs.find((o) => !o.source);
    if (ovT && (ovT.chat_id || "").trim()) return ovT.chat_id.trim();
    return (info.chat_id || "").trim();
  };

  const tabs = teams.map((t, i) =>
    `<a class="btn ${t !== team ? "btn-ghost" : ""}" href="#/sending/${i}">${esc(t)}</a>`).join("");

  const cards = data.requests.map((g) => {
    const hasTg = !!effectiveChat(g.seller, g.source);
    const tgBtn = hasTg
      ? `<button class="btn btn-sm btn-tg" data-tg="${esc(JSON.stringify(g.ids))}" data-seller="${esc(g.seller)}" data-source="${esc(g.source)}" data-count="${g.count}">📨 Telegram</button>`
      : `<button class="btn btn-sm btn-ghost" disabled title="Не задан chat_id для «${esc(g.seller)}» (сетка: ${esc(g.source) || "—"}). См. Справочники → Селлеры">📨 не настроен</button>`;
    return `
    <div class="req-card">
      <div class="req-head">
        <div>
          <div class="req-seller">${esc(g.seller)}${g.source ? ` <span class="req-source">· ${esc(g.source)}</span>` : ""}</div>
          <div class="req-count">${g.count} домен(ов)</div></div>
        <div class="req-actions">
          <button class="btn btn-sm btn-ghost copy-btn" data-copy="${esc(g.copy_text)}">⧉ Скопировать</button>
          ${tgBtn}
          <button class="btn btn-sm btn-sent" data-sent="${esc(JSON.stringify(g.ids))}"
            data-seller="${esc(g.seller)}" data-count="${g.count}" data-key="${idx}">✓ Отправлено</button>
        </div>
      </div>
      <table class="req-table"><thead><tr><th>ГЕО</th><th>Домен</th><th>Почта</th><th>Type of ADS</th></tr></thead>
        <tbody>${g.items.map((it) =>
          `<tr><td>${esc(it.geo)}</td><td class="mono">${esc(it.domain)}</td>
            <td><input class="email-input" data-email="${it.id}" value="${esc(it.email || "")}" placeholder="почта"></td>
            <td><input class="email-input" data-adtype="${it.id}" value="${esc(it.ad_type || "")}" placeholder="type of ads"></td>
          </tr>`).join("")}</tbody>
      </table></div>`;
  }).join("");

  // кнопка «Отправить всё» в шапке — только если есть заявки с настроенным TG
  const anyTg = data.requests.some((g) => !!effectiveChat(g.seller, g.source));
  const sendAllBtn = anyTg
    ? `<button class="btn btn-tg" id="tg-all" data-team="${esc(team)}">📨 Отправить всё в Telegram</button>`
    : "";

  $("view").innerHTML = `
    <div class="sec-head"><div><h1>На отправку — ${esc(team)}</h1>
      <div class="sub">Домены сгруппированы в заявки по селлеру. Всего доменов: ${data.total}.</div></div>
      <div class="head-actions">${sendAllBtn}${tabs}</div></div>
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
  // Telegram: одна заявка
  document.querySelectorAll("[data-tg]").forEach((b) => b.onclick = async () => {
    const src = b.dataset.source || "";
    const label = b.dataset.seller + (src ? ` · ${src}` : "");
    if (!confirm(`Отправить ${b.dataset.count} домен(ов) — ${label} — в Telegram?\nЗаявка НЕ будет автоматически помечена как «Отправлено» — это вы решаете руками.`)) return;
    const orig = b.textContent;
    b.disabled = true; b.textContent = "Отправка…";
    try {
      const r = await api("sending/send_tg", { method: "POST",
        body: { ids: JSON.parse(b.dataset.tg), seller: b.dataset.seller, source: src, team } });
      if (r.ok) {
        b.textContent = "✓ Отправлено в TG";
        b.classList.add("copied");
        flash("Сообщение отправлено в Telegram");
      } else {
        b.textContent = orig; b.disabled = false;
        alert("Ошибка Telegram: " + (r.error || "неизвестно"));
      }
    } catch (e) { b.textContent = orig; b.disabled = false; alert("Ошибка: " + e.message); }
  });
  // Telegram: всё разом
  const allBtn = $("tg-all");
  if (allBtn) allBtn.onclick = async () => {
    const tgCards = data.requests.filter((g) => !!effectiveChat(g.seller, g.source));
    if (!tgCards.length) return;
    if (!confirm(`Отправить в Telegram ${tgCards.length} заявок (${tgCards.reduce((a,g)=>a+g.count,0)} доменов)?\nЗаявки НЕ будут автоматически помечены как «Отправлено».`)) return;
    allBtn.disabled = true; allBtn.textContent = "Отправка…";
    try {
      const r = await api("sending/send_tg_all", { method: "POST", body: { team } });
      const failed = (r.failed || []);
      if (failed.length === 0) {
        flash(`Отправлено заявок: ${r.sent}`);
      } else {
        const msg = failed.map(f => `«${f.seller}${f.source ? " · " + f.source : ""}»: ${f.error}`).join("\n");
        alert(`Отправлено: ${r.sent} из ${r.total}.\nНе удалось:\n${msg}`);
      }
      route();
    } catch (e) { alert("Ошибка: " + e.message); allBtn.disabled = false; }
  };
  // инлайн-сохранение почты / Type of ADS в строках таблицы заявки
  const sendingInline = (selector, apiPath, fieldKey, datasetKey) => {
    document.querySelectorAll(`.req-card ${selector}`).forEach((inp) => {
      inp.dataset.last = inp.value;
      const save = async () => {
        if (inp.dataset.last === inp.value) return;
        try {
          await api(apiPath, { method: "POST",
            body: { id: inp.dataset[datasetKey], [fieldKey]: inp.value } });
          inp.dataset.last = inp.value;
          inp.classList.add("saved");
          setTimeout(() => inp.classList.remove("saved"), 800);
        } catch (e) { alert("Ошибка: " + e.message); }
      };
      inp.addEventListener("blur", save);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      });
    });
  };
  sendingInline("[data-email]",  "record/set_email",   "email",   "email");
  sendingInline("[data-adtype]", "record/set_ad_type", "ad_type", "adtype");
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
      const longBtn = stale
        ? `<button class="btn btn-sm btn-long" data-long="${r.id}" data-dom="${esc(r.domain)}">⏳ Долго!</button>`
        : "";
      actionCell = `<div class="row-actions">
        <select class="filter-sel" data-setstatus="${r.id}">
          <option value="">— сменить статус —</option>${opts}
        </select>${longBtn}</div>`;
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

  // «Долго!» (раздел Модерация, только просроченные)
  document.querySelectorAll("[data-long]").forEach((b) => b.onclick = async () => {
    if (!confirm(
      `Домен «${b.dataset.dom}»: исходной записи поставить статус «На стоп», ` +
      `создать копию в «Б/у» (без селлера и даты) со статусом «На сортировку»?`
    )) return;
    try {
      await api("record/long_clone", {
        method: "POST", body: { id: b.dataset.long },
      });
      flash("Учтено: «На стоп» + копия отправлена в Сортировку"); route();
    } catch (err) { alert("Ошибка: " + err.message); }
  });
}

// ---------- view: Подбор доменов ----------
async function viewPicker(jobId) {
  // если указан id — показываем результаты задачи; иначе общий экран
  if (jobId) return viewPickerJob(jobId);

  const ov = await api("scan/overview");
  const j = await api("scan/jobs");

  const meta = ov.meta || {};
  const last = meta.last_fetch_at ? new Date(meta.last_fetch_at).toLocaleString("ru-RU") : "—";
  const lastOk = meta.last_fetch_ok;
  const err = meta.last_error || "";

  const statusPill = (st) => {
    const cls = { pending: "pill-default", running: "pill-Модерация",
      done: "pill-Принят", error: "pill-Отказ", cancelled: "pill-default" }[st] || "pill-default";
    const label = { pending: "в очереди", running: "выполняется",
      done: "готово", error: "ошибка", cancelled: "отменено" }[st] || st;
    return `<span class="pill ${cls}">${label}</span>`;
  };

  const jobsRows = (j.jobs || []).map((job) => {
    const greatN = (job.results_great || []).length;
    const goodN = (job.results_good || []).length;
    const flaggedN = (job.flagged || []).length;
    const created = new Date(job.created_at).toLocaleString("ru-RU");
    const prog = job.total ? `${job.progress}/${job.total}` : "—";
    return `<tr>
      <td class="mono dim">#${job.id}</td>
      <td>${statusPill(job.status)} <span class="dim">${esc(job.step || "")}</span></td>
      <td class="num">${job.want_great} / ${job.want_good}</td>
      <td class="num">${greatN} / ${goodN}${flaggedN ? ` <span class="dim">(+${flaggedN} flagged)</span>` : ""}</td>
      <td class="mono dim">${prog}</td>
      <td class="mono dim">${created}</td>
      <td>
        <a class="btn btn-sm btn-ghost" href="#/picker/${job.id}">Открыть</a>
        ${job.status === "pending" || job.status === "running"
          ? `<button class="btn btn-sm btn-danger" data-cancel="${job.id}">Отменить</button>` : ""}
      </td>
    </tr>`;
  }).join("");

  $("view").innerHTML = `
    <div class="sec-head">
      <div><h1>Подбор доменов</h1>
        <div class="sub">База обновляется автоматически каждые 3 часа. Сканирование выполняется в облаке партиями (несколько минут).</div></div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="label">Доменов в базе</div>
        <div class="value amber">${ov.auction_total || 0}</div></div>
      <div class="kpi"><div class="label">В чёрном списке</div>
        <div class="value">${ov.blacklist_total || 0}</div></div>
      <div class="kpi"><div class="label">Последнее обновление</div>
        <div class="value" style="font-size:14px;font-family:'Spline Sans'">${esc(last)}
          ${lastOk === false ? `<div class="dim" style="color:var(--red);font-size:12px;margin-top:6px">${esc(err)}</div>` : ""}
        </div></div>
    </div>

    <div class="stat-block">
      <h2><span class="badge">1</span> Запустить новый подбор</h2>
      <div class="filter-bar" style="flex-wrap:wrap;gap:10px">
        <div class="field"><label>Сколько great</label>
          <input type="number" id="p-great" value="2" min="0" max="50" style="width:80px"></div>
        <div class="field"><label>Сколько good</label>
          <input type="number" id="p-good" value="10" min="0" max="50" style="width:80px"></div>
        <div class="field"><label>Часов до ауцк. (от)</label>
          <input type="number" id="p-minh" value="3" min="0" style="width:80px"></div>
        <div class="field"><label>Часов до ауцк. (до)</label>
          <input type="number" id="p-maxh" value="24" min="1" style="width:80px"></div>
        <div class="field"><label>Макс. цена ($)</label>
          <input type="number" id="p-price" value="20" min="0" style="width:90px"></div>
        <div class="field"><label>Мин. ScamDoc</label>
          <input type="number" id="p-min-sd" value="70" min="0" max="100" style="width:80px"></div>
        <div class="field"><label>Порог great</label>
          <input type="number" id="p-max-sd" value="80" min="0" max="100" style="width:80px"></div>
        <button class="btn" id="p-go">Запустить</button>
      </div>
    </div>

    <div class="stat-block">
      <h2><span class="badge">2</span> История задач</h2>
      <div class="table-wrap">${jobsRows ? `<table>
        <thead><tr><th>#</th><th>Статус</th><th>Цель great/good</th>
          <th>Получено great/good</th><th>Прогресс</th><th>Создано</th><th></th></tr></thead>
        <tbody>${jobsRows}</tbody></table>` : `<div class="empty">Задач пока нет</div>`}</div>
    </div>`;

  $("p-go").onclick = async () => {
    const body = {
      want_great: parseInt($("p-great").value, 10) || 0,
      want_good: parseInt($("p-good").value, 10) || 0,
      min_hours: parseInt($("p-minh").value, 10) || 3,
      max_hours: parseInt($("p-maxh").value, 10) || 24,
      max_price: parseFloat($("p-price").value) || 0,
      min_sd_score: parseInt($("p-min-sd").value, 10) || 70,
      max_sd_score: parseInt($("p-max-sd").value, 10) || 80,
    };
    try {
      const r = await api("scan/start", { method: "POST", body });
      flash("Задача создана. Будет выполнена в течение нескольких минут.");
      location.hash = `#/picker/${r.job.id}`;
    } catch (e) { alert("Ошибка: " + e.message); }
  };
  document.querySelectorAll("[data-cancel]").forEach((b) => b.onclick = async () => {
    if (!confirm("Отменить задачу?")) return;
    await api("scan/cancel", { method: "POST", body: { id: b.dataset.cancel } });
    flash("Отменено"); route();
  });
}

async function viewPickerJob(jobId) {
  const r = await api("scan/job?id=" + encodeURIComponent(jobId));
  const job = r.job;
  if (!job) { $("view").innerHTML = `<div class="empty">Задача не найдена</div>`; return; }

  const renderTable = (rows, kind) => {
    if (!rows.length) return `<div class="empty">Пока пусто</div>`;
    return `<table>
      <thead><tr><th>Домен</th><th>ScamDoc</th><th>Часов</th><th>Цена</th>
        <th>Ставки</th><th>Рег.</th><th>DR</th><th>VT</th><th></th></tr></thead>
      <tbody>${rows.map((d) => {
        const sc = d.scamdoc_score || 0;
        const cls = sc >= 80 ? "pill-Принят" : "pill-Правки";
        const vtOk = (d.vt_malicious || 0) === 0;
        return `<tr>
          <td class="mono">${esc(d.domain)} ${d.url ? `<a class="dim" target="_blank" rel="noopener" href="${esc(d.url)}">↗</a>` : ""}</td>
          <td><span class="pill ${cls}">${sc}%</span></td>
          <td class="mono">${d.hours_left ?? "—"}h</td>
          <td class="mono">${d.price > 0 ? "$" + d.price : "—"}</td>
          <td class="num">${d.bid_count || 0}</td>
          <td class="mono dim">${esc(d.reg_date || "")}</td>
          <td class="num">${d.ahrefs_dr ? Math.round(d.ahrefs_dr) : "—"}</td>
          <td class="${vtOk ? "" : "dim"}" style="color:${vtOk ? "var(--green)" : "var(--red)"}">${vtOk ? "clean" : `${d.vt_malicious} flags`}</td>
          <td><button class="btn btn-sm" data-accept='${esc(JSON.stringify(d))}'>Принять</button></td>
        </tr>`;
      }).join("")}</tbody></table>`;
  };

  const logs = (job.logs || []).slice(-50).map((l) =>
    `<div class="log-line"><span class="log-time">${esc(l.time || "")}</span> ${esc(l.msg)}</div>`
  ).join("");

  const progressPct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
  const stepLabel = { scamdoc: "ScamDoc", virustotal: "VirusTotal", done: "Готово" }[job.step] || job.step || "—";

  $("view").innerHTML = `
    <div class="sec-head">
      <div><h1>Задача #${job.id}</h1>
        <div class="sub">Цель: ${job.want_great} great + ${job.want_good} good · Окно: ${job.min_hours}-${job.max_hours}ч · Макс. цена: $${job.max_price}</div></div>
      <div class="head-actions">
        <a class="btn btn-ghost" href="#/picker">← К списку</a>
        ${(job.results_great || []).length || (job.results_good || []).length
          ? `<button class="btn" id="accept-all">Принять все</button>` : ""}
      </div>
    </div>

    <div class="stat-block">
      <h2>Прогресс — ${esc(stepLabel)}</h2>
      <div class="progress-row">
        <div class="progress-bar"><div class="progress-fill" style="width:${progressPct}%"></div></div>
        <div class="dim mono">${job.progress}/${job.total} · ${progressPct}%</div>
      </div>
      ${job.status !== "done" && job.status !== "error" && job.status !== "cancelled"
        ? `<div class="dim" style="margin-top:6px">Страница обновляется автоматически каждые 5 секунд.</div>` : ""}
      ${job.error_msg ? `<div class="flash flash-err" style="margin-top:10px">${esc(job.error_msg)}</div>` : ""}
    </div>

    <div class="stat-block">
      <h2><span class="badge">G</span> Great</h2>
      <div class="table-wrap">${renderTable(job.results_great || [], "great")}</div>
    </div>
    <div class="stat-block">
      <h2><span class="badge">g</span> Good</h2>
      <div class="table-wrap">${renderTable(job.results_good || [], "good")}</div>
    </div>
    ${(job.flagged || []).length ? `<div class="stat-block">
      <h2><span class="badge" style="background:var(--red)">!</span> Flagged (VirusTotal)</h2>
      <div class="table-wrap">${renderTable(job.flagged, "flagged")}</div>
    </div>` : ""}

    <div class="stat-block">
      <h2>Лог</h2>
      <div class="console-box">${logs || `<div class="dim">пусто</div>`}</div>
    </div>`;

  document.querySelectorAll("[data-accept]").forEach((b) => b.onclick = async () => {
    const item = JSON.parse(b.dataset.accept);
    if (!confirm(`Принять «${item.domain}»? Будет добавлен в чёрный список и создан в «Домены» со статусом «На сортировку».`)) return;
    try {
      await api("scan/accept", { method: "POST", body: { item } });
      flash("Принят: добавлен в Домены/Сортировку");
      b.closest("tr").style.opacity = "0.4";
      b.disabled = true;
      b.textContent = "✓ принят";
    } catch (e) { alert("Ошибка: " + e.message); }
  });
  const aa = $("accept-all");
  if (aa) aa.onclick = async () => {
    const items = [...(job.results_great || []), ...(job.results_good || [])];
    if (!items.length) return;
    if (!confirm(`Принять все ${items.length} доменов?`)) return;
    try {
      const r = await api("scan/accept_all", { method: "POST", body: { items } });
      flash(`Принято: ${r.added}`);
      route();
    } catch (e) { alert("Ошибка: " + e.message); }
  };

  // авто-обновление, пока задача не завершилась
  if (job.status === "pending" || job.status === "running") {
    setTimeout(() => {
      if (location.hash.startsWith(`#/picker/${jobId}`)) route();
    }, 5000);
  }
}

// ---------- view: stats ----------
async function viewStats() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  if (qs.get("mode") === "simple") return viewStatsSimple(qs);
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
      <div class="sub">Считается автоматически из «Домены» и «Б/у».</div></div>
      <div class="head-actions">
        <div class="seg">
          <button class="seg-btn on">Полный</button>
          <a class="seg-btn" href="#/stats?mode=simple">Упрощённый отчёт</a>
        </div>
      </div>
    </div>
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

// ---------- view: stats (упрощённый отчёт) ----------
async function viewStatsSimple(qs) {
  const period = qs.get("period") || "all";
  const value = qs.get("value") || "";
  const team = qs.get("team") || "";
  const params = new URLSearchParams({ period, value, team });
  const s = await api("stats_simple?" + params.toString());
  const cell = (v) => v ? `<span>${v}</span>` : `<span class="zero">0</span>`;

  // helper to rebuild URL with patched params
  const linkWith = (patch) => {
    const p = new URLSearchParams({ mode: "simple", period, value, team });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k); else p.set(k, v);
    }
    return "#/stats?" + p.toString();
  };

  const monthSel = `<select class="filter-sel" id="month-sel" style="${s.period === "month" ? "" : "display:none"}">
    <option value="">— выберите месяц —</option>
    ${s.month_options.map((o) => `<option value="${esc(o.value)}" ${s.period === "month" && s.value === o.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  const weekSel = `<select class="filter-sel" id="week-sel" style="${s.period === "week" ? "" : "display:none"}">
    <option value="">— выберите неделю —</option>
    ${s.week_options.map((o) => `<option value="${esc(o.value)}" ${s.period === "week" && s.value === o.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;

  // блок 1 — по сеткам (по date_taken) — табличка: строки=сетки, столбцы=статусы
  const NET_LABELS = { "Принят":"Принято", "Выдан":"Выдано", "Модерация":"Модерация",
    "Отказ":"Отказ", "На стоп":"На стоп", "Правки":"Правки" };
  const netTable = s.net_block.length ? `
    <div class="table-wrap"><table class="stats-table">
      <thead><tr><th>Сетка</th>
        ${s.net_statuses.map((st) => `<th>${esc(NET_LABELS[st] || st)}</th>`).join("")}
        <th>Итого</th></tr></thead>
      <tbody>${s.net_block.map((row) => `
        <tr><td class="label-cell">${esc(row.source)}</td>
        ${s.net_statuses.map((st) => `<td class="num">${cell(row.counts[st])}</td>`).join("")}
        <td class="num tot-col">${row.total}</td></tr>`).join("")}
      </tbody>
    </table></div>` : `<div class="empty">Нет данных за выбранный период</div>`;

  // блок 2 — аккаунты (по status_changed_at) — табличка: сетки × получено/ожидаем
  const accTable = s.acc_block.length ? `
    <div class="table-wrap"><table class="stats-table">
      <thead><tr><th>Сетка</th><th>Получено</th><th>Ожидаем</th><th>Итого</th></tr></thead>
      <tbody>${s.acc_block.map((row) => `
        <tr><td class="label-cell">${esc(row.source)}</td>
        <td class="num">${cell(row.got)}</td>
        <td class="num">${cell(row.wait)}</td>
        <td class="num tot-col">${row.total}</td></tr>`).join("")}
      </tbody>
    </table></div>` : `<div class="empty">Нет данных за выбранный период</div>`;

  // выпадашка команд
  const teamOptions = `<option value="">Все команды</option>` +
    s.teams.map((t) => `<option value="${esc(t)}" ${team === t ? "selected" : ""}>${esc(t)}</option>`).join("");

  $("view").innerHTML = `
    <div class="sec-head"><div><h1>Упрощённый отчёт</h1>
      <div class="sub">Сетки считаются по дате взятия в работу. Аккаунты — по дате смены статуса.</div></div>
      <div class="head-actions">
        <div class="seg">
          <a class="seg-btn" href="#/stats">Полный</a>
          <button class="seg-btn on">Упрощённый отчёт</button>
        </div>
      </div>
    </div>
    <div class="filter-bar">
      <select class="filter-sel" id="team-sel">${teamOptions}</select>
      <span class="filter-label">Период:</span>
      <div class="seg">
        <button class="seg-btn ${s.period === "all" ? "on" : ""}" data-p="all">За всё время</button>
        <button class="seg-btn ${s.period === "month" ? "on" : ""}" data-p="month">Месяц</button>
        <button class="seg-btn ${s.period === "week" ? "on" : ""}" data-p="week">Неделя</button>
      </div>${monthSel}${weekSel}
      <span class="filter-applied">Показано: <b>${esc(s.applied)}</b>${team ? ` · команда: <b>${esc(team)}</b>` : ""}</span>
    </div>

    <div class="stat-block">
      <h2><span class="badge">1</span> Статистика по сеткам</h2>
      <p class="desc">Учитывается по дате взятия в работу. Записей в выборке: ${s.net_total}.</p>
      ${netTable}
    </div>

    <div class="stat-block">
      <h2><span class="badge">2</span> Аккаунты</h2>
      <p class="desc">Учитывается по дате смены статуса. Записей в выборке: ${s.acc_total}.</p>
      ${accTable}
    </div>`;

  $("team-sel").onchange = (e) => { location.hash = linkWith({ team: e.target.value }); };
  document.querySelectorAll(".seg-btn[data-p]").forEach((b) => b.onclick = () => {
    const p = b.dataset.p;
    if (p === "all") location.hash = linkWith({ period: "all", value: "" });
    else {
      $("month-sel").style.display = p === "month" ? "" : "none";
      $("week-sel").style.display = p === "week" ? "" : "none";
    }
  });
  if ($("month-sel")) $("month-sel").onchange = (e) => {
    if (e.target.value) location.hash = linkWith({ period: "month", value: e.target.value });
  };
  if ($("week-sel")) $("week-sel").onchange = (e) => {
    if (e.target.value) location.hash = linkWith({ period: "week", value: e.target.value });
  };
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
    const list = items.map((it) => {
      const overrides = (table === "sellers") ? (it.overrides || []) : [];
      const hasAny = (table === "sellers") && (!!it.chat_id || overrides.length > 0);
      const tgBlock = (table === "sellers") ? `
        <button class="tg-toggle ${hasAny ? "tg-on" : ""}" data-tg-open="${it.id}" title="${hasAny ? "Telegram настроен" : "Настроить Telegram"}">
          ${hasAny ? `✓ TG${overrides.length ? " +" + overrides.length : ""}` : "TG"}
        </button>` : "";
      return `
      <div class="ref-item">
        <input class="name-edit" value="${esc(it.name)}" data-ren="${it.id}" data-table="${table}">
        ${table === "members" && it.team ? `<span class="team-tag">${esc(it.team)}</span>` : ""}
        ${tgBlock}
        <button class="icon-btn save" data-saveren="${it.id}" data-table="${table}" title="Сохранить имя">✓</button>
        <button class="icon-btn" data-del="${it.id}" data-table="${table}" data-name="${esc(it.name)}" title="Удалить">✕</button>
      </div>`;
    }).join("") || `<div class="dim">Пусто</div>`;
    const teamSel = table === "members"
      ? `<select id="addteam-${table}"><option value="">— команда —</option>${teams.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select>` : "";
    return `<div class="ref-card"><h3>${REF_LABELS[table]} <span class="dim" style="font-weight:400">· ${items.length}</span></h3>
      <div class="ref-list">${list}</div>
      <div class="ref-add"><input id="addname-${table}" placeholder="Добавить…">${teamSel}
        <button class="btn btn-sm" data-add="${table}">+</button></div></div>`;
  }).join("");
  $("view").innerHTML = `
    <div class="sec-head"><div><h1>Справочники</h1>
      <div class="sub">Команды, участники, сервера, источники, селлеры, статусы и ГЕО. У селлеров можно настроить Telegram chat_id и шаблон сообщения.</div></div></div>
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
  // Кнопка TG у селлера — открывает полноэкранный редактор настроек Telegram
  document.querySelectorAll("[data-tg-open]").forEach((b) => b.onclick = () => {
    openTgModal(parseInt(b.dataset.tgOpen, 10));
  });
}

// ---------- модалка настроек Telegram для одного селлера ----------
// Иерархия настроек:
//   База селлера → Переопределение по команде → Переопределение по (команда + сетка)
// Резолв при отправке: чем глубже уровень, тем приоритетнее (непустые поля
// перекрывают вышестоящие).
function openTgModal(sellerId) {
  const seller = (REFS.sellers || []).find((s) => s.id === sellerId);
  if (!seller) { alert("Селлер не найден"); return; }
  const teams = names("teams");
  const sources = names("sources");
  const overrides = seller.overrides || [];

  // строим список карточек переопределений: одна на команду (с источниками внутри)
  const teamsUsed = [...new Set(overrides.map((o) => o.team))].sort();
  const availableTeams = teams.filter((t) => !teamsUsed.includes(t));

  const teamCards = teamsUsed.map((tm) => {
    const ovTeam = overrides.find((o) => o.team === tm && !o.source);
    const ovSources = overrides.filter((o) => o.team === tm && o.source);
    const sourcesUsed = ovSources.map((o) => o.source);
    const availableSrc = sources.filter((s) => !sourcesUsed.includes(s));
    const sourceBlocks = ovSources.map((o) => `
      <div class="tg-sub" data-ov-id="${o.id}">
        <div class="tg-sub-head">
          <span class="tg-pill src">${esc(o.source)}</span>
          ${o.chat_id ? `<span class="dim mono small">chat ${esc(o.chat_id)}</span>` : `<span class="dim small">(шаблон без chat_id)</span>`}
          <button class="icon-btn" data-ov-del="${o.id}" data-ov-label="${esc(tm)} · ${esc(o.source)}" title="Удалить">✕</button>
        </div>
        <label>chat_id <span class="hint">пусто → берётся из команды</span></label>
        <input data-tg-field="chat_id" data-ov-id="${o.id}" value="${esc(o.chat_id || "")}" placeholder="наследуется">
        <label>Шаблон сообщения <span class="hint">пусто → из команды</span></label>
        <textarea data-tg-field="message_template" data-ov-id="${o.id}" rows="4" class="tg-tmpl">${esc(o.message_template || "")}</textarea>
        <label>Шаблон одного домена <span class="hint">пусто → из команды</span></label>
        <textarea data-tg-field="domain_template" data-ov-id="${o.id}" rows="4" class="tg-tmpl">${esc(o.domain_template || "")}</textarea>
        <button class="btn btn-sm" data-ov-save="${o.id}" data-team="${esc(tm)}" data-source="${esc(o.source)}">Сохранить</button>
      </div>`).join("");
    const addSrcBlock = availableSrc.length ? `
      <div class="tg-add-row">
        <select id="add-src-${tm}-${seller.id}">${availableSrc.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select>
        <button class="btn btn-sm" data-ov-add-src="${esc(tm)}">+ Сетка</button>
      </div>` : `<div class="dim small">все сетки этой команды уже переопределены</div>`;

    return `
    <div class="tg-team-card">
      <div class="tg-team-head">
        <span class="tg-pill team">${esc(tm)}</span>
        ${ovTeam && ovTeam.chat_id ? `<span class="dim mono small">chat ${esc(ovTeam.chat_id)}</span>` : ""}
        <button class="icon-btn" data-team-remove="${esc(tm)}" title="Удалить все переопределения этой команды">✕ команда</button>
      </div>
      <label>chat_id команды <span class="hint">пусто → базовый селлера</span></label>
      <input id="tm-chat-${tm}" data-team-field="chat_id" data-team="${esc(tm)}" value="${esc(ovTeam?.chat_id || "")}" placeholder="базовый селлера">
      <label>Шаблон сообщения <span class="hint">пусто → базовый. {seller} {team} {source} {count} {date} {domains}</span></label>
      <textarea id="tm-tmpl-${tm}" data-team-field="message_template" data-team="${esc(tm)}" rows="4" class="tg-tmpl">${esc(ovTeam?.message_template || "")}</textarea>
      <label>Шаблон одного домена <span class="hint">пусто → базовый. {domain} {geo} {source} {email} {ad_type}</span></label>
      <textarea id="tm-dtmpl-${tm}" data-team-field="domain_template" data-team="${esc(tm)}" rows="4" class="tg-tmpl">${esc(ovTeam?.domain_template || "")}</textarea>
      <button class="btn btn-sm" data-team-save="${esc(tm)}">Сохранить настройки команды</button>

      <div class="tg-team-subtitle">Уточнения по сеткам внутри «${esc(tm)}»</div>
      ${sourceBlocks || `<div class="dim small">нет уточнений по сеткам — используются настройки команды</div>`}
      ${addSrcBlock}
    </div>`;
  }).join("");

  const addTeamBlock = availableTeams.length ? `
    <div class="tg-add-row">
      <select id="add-team-${seller.id}">${availableTeams.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select>
      <button class="btn" data-team-add>+ Добавить команду</button>
    </div>` : `<div class="dim">все команды уже настроены</div>`;

  const modalHtml = `
    <div class="modal-bg show" id="tg-modal-bg">
      <div class="modal modal-wide">
        <div class="modal-head">
          <h2>Telegram — ${esc(seller.name)}</h2>
          <button class="icon-btn" id="tg-modal-close" title="Закрыть">✕</button>
        </div>
        <div class="modal-body">
          <section class="tg-section">
            <h3>Базовые настройки селлера</h3>
            <div class="dim small">Используются, если для команды не задано переопределение.</div>
            <label>chat_id <span class="hint">например, -1001234567890 для группы</span></label>
            <input id="base-chat" value="${esc(seller.chat_id || "")}" placeholder="-1001234567890">
            <label>Шаблон сообщения <span class="hint">{seller} {team} {source} {count} {date} {domains}</span></label>
            <textarea id="base-tmpl" rows="5" class="tg-tmpl">${esc(seller.message_template || "")}</textarea>
            <label>Шаблон одного домена <span class="hint">{domain} {geo} {source} {email} {ad_type}</span></label>
            <textarea id="base-dtmpl" rows="5" class="tg-tmpl" placeholder="Domain URL: {domain}&#10;GEO: {geo}&#10;Time Zone: UTC+3&#10;Type of ADS: {ad_type}">${esc(seller.domain_template || "")}</textarea>
            <button class="btn" id="base-save">Сохранить базовые</button>
          </section>

          <section class="tg-section">
            <h3>Переопределения по командам</h3>
            <div class="dim small">У каждой команды свой chat и/или шаблон. Внутри команды можно уточнить настройки по сеткам.</div>
            ${teamCards || `<div class="dim" style="padding:10px 0">пока нет переопределений</div>`}
            ${addTeamBlock}
          </section>
        </div>
      </div>
    </div>`;

  // монтируем
  const wrap = document.createElement("div");
  wrap.innerHTML = modalHtml;
  document.body.appendChild(wrap.firstElementChild);
  const bg = $("tg-modal-bg");
  const close = () => bg.remove();
  $("tg-modal-close").onclick = close;
  bg.onclick = (e) => { if (e.target === bg) close(); };

  // ===== обработчики =====
  // Базовые
  $("base-save").onclick = async () => {
    try {
      await api("ref", { method: "POST", body: {
        action: "update_tg", table: "sellers", id: seller.id,
        chat_id: $("base-chat").value.trim(),
        message_template: $("base-tmpl").value,
        domain_template: $("base-dtmpl").value,
      }});
      flash("Базовые настройки сохранены"); close(); viewSettings();
    } catch (e) { alert(e.message); }
  };
  // Сохранение настроек команды
  document.querySelectorAll("[data-team-save]").forEach((b) => b.onclick = async () => {
    const tm = b.dataset.teamSave;
    try {
      await api("ref", { method: "POST", body: {
        action: "update_tg_override", table: "sellers",
        seller_id: seller.id, team: tm, source: "",
        chat_id: document.querySelector(`[data-team-field="chat_id"][data-team="${tm}"]`).value.trim(),
        message_template: document.querySelector(`[data-team-field="message_template"][data-team="${tm}"]`).value,
        domain_template: document.querySelector(`[data-team-field="domain_template"][data-team="${tm}"]`).value,
      }});
      flash(`Команда «${tm}» сохранена`); close(); openTgModal(seller.id);
    } catch (e) { alert(e.message); }
  });
  // Удалить ВСЕ переопределения команды
  document.querySelectorAll("[data-team-remove]").forEach((b) => b.onclick = async () => {
    const tm = b.dataset.teamRemove;
    if (!confirm(`Удалить ВСЕ переопределения команды «${tm}» (включая уточнения по сеткам)?`)) return;
    try {
      const targets = overrides.filter((o) => o.team === tm);
      for (const o of targets) {
        await api("ref", { method: "POST", body: {
          action: "delete_tg_override", table: "sellers", id: o.id }});
      }
      flash("Команда удалена из переопределений"); close(); viewSettings();
    } catch (e) { alert(e.message); }
  });
  // Добавить команду
  const addTeamBtn = document.querySelector("[data-team-add]");
  if (addTeamBtn) addTeamBtn.onclick = async () => {
    const sel = $("add-team-" + seller.id);
    const tm = sel.value;
    if (!tm) return;
    try {
      await api("ref", { method: "POST", body: {
        action: "update_tg_override", table: "sellers",
        seller_id: seller.id, team: tm, source: "",
        chat_id: "", message_template: "", domain_template: "",
      }});
      close(); openTgModal(seller.id);
    } catch (e) { alert(e.message); }
  };
  // Уточнения по сеткам: сохранить
  document.querySelectorAll("[data-ov-save]").forEach((b) => b.onclick = async () => {
    const ovId = b.dataset.ovSave;
    const tm = b.dataset.team;
    const src = b.dataset.source;
    try {
      await api("ref", { method: "POST", body: {
        action: "update_tg_override", table: "sellers",
        seller_id: seller.id, team: tm, source: src,
        chat_id: document.querySelector(`[data-tg-field="chat_id"][data-ov-id="${ovId}"]`).value.trim(),
        message_template: document.querySelector(`[data-tg-field="message_template"][data-ov-id="${ovId}"]`).value,
        domain_template: document.querySelector(`[data-tg-field="domain_template"][data-ov-id="${ovId}"]`).value,
      }});
      flash(`«${tm} · ${src}» сохранено`); close(); openTgModal(seller.id);
    } catch (e) { alert(e.message); }
  });
  // Уточнение по сетке: удалить
  document.querySelectorAll("[data-ov-del]").forEach((b) => b.onclick = async () => {
    if (!confirm(`Удалить уточнение «${b.dataset.ovLabel}»?`)) return;
    try {
      await api("ref", { method: "POST", body: {
        action: "delete_tg_override", table: "sellers", id: b.dataset.ovDel }});
      flash("Уточнение удалено"); close(); openTgModal(seller.id);
    } catch (e) { alert(e.message); }
  });
  // Уточнение по сетке: добавить
  document.querySelectorAll("[data-ov-add-src]").forEach((b) => b.onclick = async () => {
    const tm = b.dataset.ovAddSrc;
    const src = $("add-src-" + tm + "-" + seller.id).value;
    if (!src) return;
    try {
      await api("ref", { method: "POST", body: {
        action: "update_tg_override", table: "sellers",
        seller_id: seller.id, team: tm, source: src,
        chat_id: "", message_template: "", domain_template: "",
      }});
      close(); openTgModal(seller.id);
    } catch (e) { alert(e.message); }
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

// ---------- theme toggle ----------
function applyTheme() {
  const isLight = document.documentElement.classList.contains("theme-light");
  const btn = $("theme-toggle");
  if (btn) {
    btn.textContent = isLight ? "☀️" : "🌙";
    btn.title = isLight ? "Включить тёмную тему" : "Включить светлую тему";
  }
}
$("theme-toggle").onclick = () => {
  const isLight = document.documentElement.classList.toggle("theme-light");
  // cookie на 1 год, доступно JS (не HttpOnly)
  document.cookie = "dt_theme=" + (isLight ? "light" : "dark") +
    "; Path=/; Max-Age=31536000; SameSite=Lax";
  applyTheme();
};
applyTheme();

// ---------- mobile hamburger ----------
function closeMobileNav() { document.body.classList.remove("nav-open"); }
$("hamburger").onclick = (e) => {
  e.stopPropagation();
  document.body.classList.toggle("nav-open");
};
// клик по ссылке навигации — закрываем меню
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.tagName === "A" && t.closest("#nav")) closeMobileNav();
  // клик вне меню (но не по самому меню и не по бургеру) — тоже закрываем
  else if (document.body.classList.contains("nav-open")
        && !t.closest("#nav") && t.id !== "hamburger") closeMobileNav();
});
window.addEventListener("hashchange", () => { closeMobileNav(); route(); });
boot();
