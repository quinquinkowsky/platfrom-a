-- ============================================================
-- ОБНОВЛЕНИЕ v7 — выполнить в Supabase ОДИН РАЗ
-- Supabase → SQL Editor → New query → вставить → Run
--
-- Что добавляется:
--   scam_cache — кэш проверок ScamDoc. При новом подборе Worker сначала
--                смотрит сюда: если домен уже проверялся в последние
--                30 дней — не дёргаем API, берём балл из кэша.
--   vt_cache   — то же самое для VirusTotal.
--
-- Цель — экономия квоты API и сильное ускорение подбора при повторных
-- запусках. domain_blacklist по-прежнему используется только для
-- «Принять» (никогда не показывать в подборке).
-- ============================================================

CREATE TABLE IF NOT EXISTS scam_cache (
    domain      TEXT PRIMARY KEY,
    trust       INTEGER NOT NULL,         -- 0..100, как в нашем коде
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scam_cache_checked ON scam_cache(checked_at);
ALTER TABLE scam_cache ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS vt_cache (
    domain      TEXT PRIMARY KEY,
    malicious   INTEGER NOT NULL DEFAULT 0,
    suspicious  INTEGER NOT NULL DEFAULT 0,
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vt_cache_checked ON vt_cache(checked_at);
ALTER TABLE vt_cache ENABLE ROW LEVEL SECURITY;
