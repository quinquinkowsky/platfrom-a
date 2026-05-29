-- ============================================================
-- ОБНОВЛЕНИЕ v4 — выполнить в Supabase ОДИН РАЗ до деплоя кода
-- Supabase → SQL Editor → New query → вставить всё → Run
--
-- Что делает:
--   1) Добавляет в таблицу records колонку status_changed_at
--      (дата, когда последний раз менялся статус).
--   2) Заполняет её у уже накопленных записей: берёт date_taken,
--      а где её нет — ставит сегодня.
--
-- Запуск повторно безопасен — IF NOT EXISTS и IS NULL защищают
-- от повторного выполнения.
-- ============================================================

ALTER TABLE records ADD COLUMN IF NOT EXISTS status_changed_at DATE;

UPDATE records
SET status_changed_at = COALESCE(date_taken, CURRENT_DATE)
WHERE status_changed_at IS NULL;
