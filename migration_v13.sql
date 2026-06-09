-- ============================================================
-- ОБНОВЛЕНИЕ v13 — выполнить в Supabase ОДИН РАЗ до деплоя кода
-- Supabase → SQL Editor → New query → вставить → Run
--
-- Что меняется:
--   1. Старая таблица seller_source_telegram удаляется (мы переходим
--      на новую модель: переопределения теперь привязаны к команде).
--   2. Базовые Telegram-настройки у всех селлеров СБРАСЫВАЮТСЯ
--      (chat_id, message_template, domain_template) — настройки
--      будут заведены заново по новой логике.
--   3. Создаётся таблица seller_overrides: переопределения по тройке
--      (селлер, команда, сетка). Поле source может быть пустым:
--        team != '' AND source = ''   → переопределение по команде
--        team != '' AND source != ''  → по паре (команда + сетка)
--      team всегда заполнен — без привязки к команде хранится в sellers.
-- ============================================================

-- 1) удалить старую таблицу
DROP TABLE IF EXISTS seller_source_telegram;

-- 2) сбросить базовые настройки селлеров
UPDATE sellers SET chat_id = '', message_template = '', domain_template = '';

-- 3) новая таблица
CREATE TABLE IF NOT EXISTS seller_overrides (
    id               BIGSERIAL PRIMARY KEY,
    seller_id        BIGINT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    team             TEXT NOT NULL,                 -- всегда заполнено
    source           TEXT NOT NULL DEFAULT '',      -- пусто = только команда
    chat_id          TEXT DEFAULT '',
    message_template TEXT DEFAULT '',
    domain_template  TEXT DEFAULT '',
    UNIQUE (seller_id, team, source)
);
CREATE INDEX IF NOT EXISTS idx_so_seller ON seller_overrides(seller_id);
ALTER TABLE seller_overrides ENABLE ROW LEVEL SECURITY;
