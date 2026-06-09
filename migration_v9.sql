-- ============================================================
-- ОБНОВЛЕНИЕ v9 — выполнить в Supabase ОДИН РАЗ до деплоя кода
-- Supabase → SQL Editor → New query → вставить → Run
--
-- Добавляет таблицу seller_source_telegram — переопределения
-- chat_id и шаблона для пары «селлер + сетка». Если для пары
-- ничего не задано, используются базовые поля из sellers (как в v8).
-- ============================================================

CREATE TABLE IF NOT EXISTS seller_source_telegram (
    id               BIGSERIAL PRIMARY KEY,
    seller_id        BIGINT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    source           TEXT NOT NULL,
    chat_id          TEXT DEFAULT '',
    message_template TEXT DEFAULT '',
    UNIQUE (seller_id, source)
);
CREATE INDEX IF NOT EXISTS idx_sst_seller ON seller_source_telegram(seller_id);
ALTER TABLE seller_source_telegram ENABLE ROW LEVEL SECURITY;
