-- Ссылки на приложение в сторах для страницы /app/pizzburg.
-- Только добавляем ключ appLinks, остальные настройки не трогаем;
-- если ключ уже задан вручную, не перезаписываем.
UPDATE "Tenant"
SET "settings" = jsonb_set(
  COALESCE("settings", '{}'::jsonb),
  '{appLinks}',
  '{"ios": "https://apps.apple.com/kz/app/id6806758471", "android": "https://play.google.com/store/apps/details?id=kz.pizzburg.pizzburg"}'::jsonb,
  true
)
WHERE "slug" = 'pizzburg'
  AND NOT (COALESCE("settings", '{}'::jsonb) ? 'appLinks');
