-- ============================================================
-- Domain Tracker — схема базы для Supabase (PostgreSQL)
-- Выполните это ПЕРВЫМ в Supabase → SQL Editor → New query → Run
-- Затем выполните seed.sql (ваши данные).
-- ============================================================

-- справочники
CREATE TABLE IF NOT EXISTS teams    (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS servers  (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS sources  (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS sellers  (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS statuses (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS geos     (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS members  (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, team TEXT DEFAULT '');

-- основная таблица записей
CREATE TABLE IF NOT EXISTS records (
    id          BIGSERIAL PRIMARY KEY,
    section     TEXT NOT NULL DEFAULT 'domains',   -- 'domains' | 'reused'
    domain      TEXT DEFAULT '',
    server      TEXT DEFAULT '',
    geo         TEXT DEFAULT '',
    seller      TEXT DEFAULT '',
    source      TEXT DEFAULT '',
    team        TEXT DEFAULT '',
    rating      TEXT DEFAULT '',
    comment     TEXT DEFAULT '',
    free        TEXT DEFAULT '',
    date_taken  DATE,
    taker       TEXT DEFAULT '',
    status      TEXT DEFAULT '',
    sort_group  TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_records_section    ON records(section);
CREATE INDEX IF NOT EXISTS idx_records_status     ON records(status);
CREATE INDEX IF NOT EXISTS idx_records_team       ON records(team);
CREATE INDEX IF NOT EXISTS idx_records_sort_group ON records(sort_group);

-- гарантируем системные статусы
INSERT INTO statuses(name) VALUES ('На сортировку'), ('На отправку'), ('Модерация')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- Доступ к данным идёт ТОЛЬКО через серверную Pages Function
-- (с service_role-ключом), которая закрыта логином/паролем.
-- Поэтому таблицы не публикуются для анонимного доступа.
-- Включаем RLS и НЕ создаём разрешающих политик для anon —
-- значит, с публичным anon-ключом данные недоступны.
-- service_role-ключ обходит RLS (он секретный, лежит в env Function).
-- ============================================================
ALTER TABLE records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams    ENABLE ROW LEVEL SECURITY;
ALTER TABLE members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE servers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sellers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE geos     ENABLE ROW LEVEL SECURITY;
