-- ============================================================
-- ОБНОВЛЕНИЕ v6 — выполнить в Supabase ОДИН РАЗ до деплоя кода
-- Supabase → SQL Editor → New query → вставить всё → Run
-- Создаёт таблицы для модуля «Подбор доменов»:
--   auction_domains — текущий снапшот доменов с Namecheap (обновляется
--                     автоматически каждые 3 часа)
--   domain_blacklist — постоянный список «не показывать в подборке»
--   scan_jobs        — асинхронные задачи сканирования (ScamDoc+VT)
--   scan_state       — служебная таблица (последнее обновление, ошибки)
-- ============================================================

-- Снапшот аукционных доменов (только прошедшие предварительный фильтр:
-- .com, рег 2000-2016, цена и окно аукциона задаются Worker'ом).
CREATE TABLE IF NOT EXISTS auction_domains (
    id           BIGSERIAL PRIMARY KEY,
    domain       TEXT UNIQUE NOT NULL,
    url          TEXT,            -- ссылка на лот Namecheap
    end_date     TIMESTAMPTZ,     -- когда заканчивается аукцион
    reg_date     DATE,            -- дата регистрации
    reg_year     INTEGER,
    price        NUMERIC(10,2),
    bid_count    INTEGER DEFAULT 0,
    ahrefs_dr    NUMERIC(6,2) DEFAULT 0,
    majestic_tf  NUMERIC(6,2) DEFAULT 0,
    backlinks    NUMERIC(12,2) DEFAULT 0,
    fetched_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auction_end_date  ON auction_domains(end_date);
CREATE INDEX IF NOT EXISTS idx_auction_price     ON auction_domains(price);
CREATE INDEX IF NOT EXISTS idx_auction_reg_year  ON auction_domains(reg_year);
ALTER TABLE auction_domains ENABLE ROW LEVEL SECURITY;

-- Чёрный список: «никогда больше не показывать в подборке».
-- Пополняется только при нажатии «Принять» в подборке.
CREATE TABLE IF NOT EXISTS domain_blacklist (
    id         BIGSERIAL PRIMARY KEY,
    domain     TEXT UNIQUE NOT NULL,
    reason     TEXT DEFAULT 'picked',  -- 'picked' / 'manual' (на будущее)
    added_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE domain_blacklist ENABLE ROW LEVEL SECURITY;

-- Асинхронные задачи сканирования. Pages-Function создаёт запись со
-- статусом 'pending', Worker берёт её и прокручивает партиями.
CREATE TABLE IF NOT EXISTS scan_jobs (
    id            BIGSERIAL PRIMARY KEY,
    status        TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|error|cancelled
    -- параметры подбора
    want_good     INTEGER NOT NULL DEFAULT 0,
    want_great    INTEGER NOT NULL DEFAULT 0,
    min_hours     INTEGER NOT NULL DEFAULT 3,
    max_hours     INTEGER NOT NULL DEFAULT 24,
    max_price     NUMERIC(10,2) NOT NULL DEFAULT 0,
    min_sd_score  INTEGER NOT NULL DEFAULT 70,
    max_sd_score  INTEGER NOT NULL DEFAULT 80,
    -- прогресс
    progress      INTEGER DEFAULT 0,
    total         INTEGER DEFAULT 0,
    step          TEXT DEFAULT '',                   -- scamdoc|virustotal|done
    -- результаты (JSON)
    results_great JSONB DEFAULT '[]'::jsonb,
    results_good  JSONB DEFAULT '[]'::jsonb,
    flagged       JSONB DEFAULT '[]'::jsonb,
    logs          JSONB DEFAULT '[]'::jsonb,
    -- что уже отсмотрено в этой задаче (id из auction_domains),
    -- чтобы Worker не повторял
    seen_ids      JSONB DEFAULT '[]'::jsonb,
    error_msg     TEXT DEFAULT '',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON scan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON scan_jobs(created_at DESC);
ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY;

-- Служебная таблица: статус последнего обновления CSV и сообщения об ошибках.
CREATE TABLE IF NOT EXISTS auction_meta (
    id              INTEGER PRIMARY KEY DEFAULT 1,    -- всегда 1 строка
    last_fetch_at   TIMESTAMPTZ,
    last_fetch_ok   BOOLEAN,
    last_error      TEXT DEFAULT '',
    rows_total      INTEGER DEFAULT 0,
    rows_kept       INTEGER DEFAULT 0,
    CONSTRAINT one_row CHECK (id = 1)
);
INSERT INTO auction_meta (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE auction_meta ENABLE ROW LEVEL SECURITY;
