-- ============================================================
-- ОБНОВЛЕНИЕ v12 — выполнить в Supabase ОДИН РАЗ до деплоя кода
-- Supabase → SQL Editor → New query → вставить → Run
--
-- Добавляет три поля:
--   records.ad_type                          — «Type of ADS» для домена
--                                              (вводится инлайн в Сортировке
--                                              и «На отправку»)
--   sellers.domain_template                  — шаблон одной строки в блоке
--                                              {domains} для данного селлера
--   seller_source_telegram.domain_template   — то же для пары «селлер + сетка»
-- ============================================================

ALTER TABLE records              ADD COLUMN IF NOT EXISTS ad_type         TEXT DEFAULT '';
ALTER TABLE sellers              ADD COLUMN IF NOT EXISTS domain_template TEXT DEFAULT '';
ALTER TABLE seller_source_telegram ADD COLUMN IF NOT EXISTS domain_template TEXT DEFAULT '';
