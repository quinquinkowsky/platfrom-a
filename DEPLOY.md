# Domain Tracker — деплой на Supabase + Cloudflare Pages

Веб-интерфейс (статика + serverless-функции) хостится на **Cloudflare Pages**,
данные — в **Supabase (PostgreSQL)**. Доступ закрыт логином и паролем.

```
Логин:  admin
Пароль: JohnSnow
```
(можно поменять в переменных окружения — см. ниже)

---

## Что в архиве

```
public/            ← статический фронтенд (раздаётся Cloudflare Pages)
  index.html
  app.js
  style.css
functions/         ← серверный API (Pages Functions, среда Workers)
  api/
    [[path]].js        — все эндпоинты (CRUD, сортировка, отправка, статистика)
    _middleware.js     — проверка логина для /api/*
    _supabase.js       — доступ к Supabase + аутентификация
schema.sql         ← структура БД (выполнить в Supabase первым)
seed.sql           ← ваши 833 записи + справочники (выполнить вторым)
```

Важно: секретный ключ Supabase лежит **только** в переменных окружения функции
(на сервере). Фронтенд ходит в Supabase не напрямую, а через эту функцию,
закрытую паролем. Поэтому данные защищены.

---

## Шаг 1. Supabase — создать БД

1. Зайдите на <https://supabase.com>, создайте проект (Free tier подходит).
   Запомните пароль БД (он не понадобится для приложения, но нужен Supabase).
2. В проекте откройте **SQL Editor → New query**.
3. Вставьте полностью содержимое **`schema.sql`** → **Run**.
4. Новый запрос → вставьте содержимое **`seed.sql`** → **Run**.
   Должно вставиться 833 строки в `records` и справочники.
5. Откройте **Project Settings → API** и скопируйте:
   - **Project URL** — вида `https://abcdxyz.supabase.co`
   - **service_role** ключ (раздел Project API keys, секретный — НЕ anon!).
     Нажмите «Reveal» и скопируйте его.

> service_role-ключ даёт полный доступ к БД и обходит RLS. Он секретный —
> храните только в переменных Cloudflare, никогда не кладите во фронтенд.

---

## Шаг 2. Cloudflare Pages — выложить интерфейс

### Вариант А — через Git (рекомендуется)

1. Залейте содержимое архива в репозиторий GitHub/GitLab
   (чтобы `functions/` и `public/` лежали в корне репозитория).
2. На <https://dash.cloudflare.com> → **Workers & Pages → Create →
   Pages → Connect to Git** → выберите репозиторий.
3. Настройки сборки:
   - **Framework preset:** None
   - **Build command:** оставьте пустым
   - **Build output directory:** `public`
   - (папка `functions/` подхватится автоматически)
4. Разверните раздел **Environment variables** и добавьте (Production):

   | Имя | Значение |
   |-----|----------|
   | `SUPABASE_URL` | ваш Project URL из шага 1 |
   | `SUPABASE_SERVICE_KEY` | service_role ключ из шага 1 |
   | `APP_USER` | `admin` |
   | `APP_PASS` | `JohnSnow` |
   | `SESSION_SECRET` | любая длинная случайная строка (например, из менеджера паролей) |

5. **Save and Deploy.** Через минуту получите адрес вида
   `https://ваш-проект.pages.dev`.

### Вариант Б — прямая загрузка через Wrangler (без Git)

```bash
npm install -g wrangler
wrangler login
# из корня проекта (где лежат public/ и functions/):
wrangler pages deploy public --project-name domain-tracker
```
Затем в дашборде Cloudflare → ваш проект → **Settings → Environment variables**
добавьте те же 5 переменных и нажмите **Retry deployment** (или задеплойте снова).

---

## Шаг 3. Проверка

1. Откройте адрес `*.pages.dev`.
2. Должна появиться форма входа. Введите `admin` / `JohnSnow`.
3. Внутри — все разделы: Домены, Б/у, Сортировка, На отправку, Статистика,
   Справочники. Данные подтянутся из Supabase.

---

## Как поменять логин/пароль

В Cloudflare → проект → **Settings → Environment variables** измените
`APP_USER` / `APP_PASS`, при необходимости обновите `SESSION_SECRET`
(смена секрета разлогинит текущие сессии). После изменения сделайте **Retry
deployment**, чтобы переменные применились.

---

## Частые вопросы

**Данные не грузятся / 500 на /api/**: проверьте `SUPABASE_URL`
(со `https://`, без слэша в конце не обязательно) и `SUPABASE_SERVICE_KEY`
(именно service_role, не anon).

**Постоянно просит логин**: задан ли `SESSION_SECRET`? Совпадают ли
`APP_USER`/`APP_PASS` с тем, что вводите.

**Резервная копия**: в Supabase → Database → Backups. Либо экспорт таблицы
`records` в CSV через Table Editor.

**Локальный запуск для разработки**:
```bash
npm install -g wrangler
wrangler pages dev public   # поднимет и статику, и functions локально
```
(переменные окружения для локали можно положить в файл `.dev.vars`).
