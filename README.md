# PizzBurg Delivery

Собственная платформа доставки для PizzBurg (Экибастуз) — замена
арендного white-label приложения FoodPicasso/SmartPicasso.
Мультитенантная с прицелом на SaaS для других заведений.

**Начните отсюда:**

- [docs/PROJECT.md](docs/PROJECT.md) — контекст, решения, дорожная карта,
  журнал сессий. Обязательное чтение для человека или ИИ-агента,
  продолжающего работу.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — стек, схема данных,
  интеграции (Poster POS, Kaspi), фазы.

- [docs/ADMIN_SPEC.md](docs/ADMIN_SPEC.md) — ТЗ на админку.
- [docs/SMARTPICASSO_AUDIT.md](docs/SMARTPICASSO_AUDIT.md) — разбор
  админки конкурента: что забрать, с каким приоритетом, что не нужно.
- [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md) — актуальное «готово /
  частично / нужно / не берём» по всем функциям SmartPicasso.
- [docs/DEPLOY_STAGING.md](docs/DEPLOY_STAGING.md) — пошаговая настройка
  Cloudflare R2 и Railway staging.
- [docs/LOYALTY.md](docs/LOYALTY.md) — правила собственного кэшбэка,
  staging-проверка и импорт старых балансов.
- [docs/HANDOFF.md](docs/HANDOFF.md) — пакет передачи проекта.

## Запуск

```bash
backend/dev.sh                  # API :3210 (Postgres pizzburg локально)
npm --prefix admin run dev      # админка :3211
```

Приложение (оно же сайт заказов):

```bash
cd mobile && flutter run -d web-server --web-hostname 0.0.0.0 --web-port 3212 --dart-define=API_URL=http://localhost:3210
```

Вход в админку — токен из `backend/.env` (`ADMIN_TOKEN`).
Режим отправки заказов в Poster печатается при старте API.
