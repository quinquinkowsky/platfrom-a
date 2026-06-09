-- ============================================================
-- ОБНОВЛЕНИЕ v8 — выполнить в Supabase ОДИН РАЗ до деплоя кода
-- Supabase → SQL Editor → New query → вставить → Run
--
-- Добавляет полям таблицы sellers:
--   chat_id          — id чата Telegram, куда отправлять заявки
--                     (для группы — отрицательное число, для личного — положительное)
--   message_template — шаблон сообщения с подстановками:
--                     {seller}, {count}, {date}, {domains}
-- ============================================================

ALTER TABLE sellers ADD COLUMN IF NOT EXISTS chat_id TEXT DEFAULT '';
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS message_template TEXT DEFAULT '{seller}
{domains}';

-- Заполняем шаблон по умолчанию у тех, у кого он пустой
UPDATE sellers SET message_template = '{seller}
{domains}'
WHERE message_template IS NULL OR message_template = '';
