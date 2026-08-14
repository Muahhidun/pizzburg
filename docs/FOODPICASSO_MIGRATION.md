# FoodPicasso customer migration

## What is confirmed

- `POST /client/getByParams` returns the complete customer profile list page by page.
- Full export on 12.08.2026: **15 003 unique profiles, 151 pages, zero duplicate ids**.
- This response contains names, registration and activity dates, order count, loyalty balance, platform and average receipt.
- **Phone masking rule (measured, not guessed):** the endpoint returns a phone
  only for customers whose last order is at most ~4 days old; everything from
  7 days and older comes back empty. In the full export only **462 of 15 003
  profiles (3%) carried a phone**. The two groups do not overlap at all, and
  platform, device token and order count have no influence. This is FoodPicasso's
  anti-scraping measure (the admin UI shows a «скрыт» link instead), not stale
  data and not a customer preference — so `suggest` is mandatory, not optional.
- `POST /client/suggest` takes `params.q` (a phone substring) and returns
  `result: [{id, name, email}]` where `name` is the phone. **The id matches the
  profile id** — verified on three known customers — so the datasets join
  exactly, without any name-based guessing.
- `suggest` returns **at most 50 records per query**, so the traversal must
  deepen adaptively (see below).

## Measured data quality (full export, 12.08.2026)

| Metric | Value |
|---|---|
| Profiles | 15 003 (no duplicate ids) |
| Loyalty balance total | 3 211 211,07 ₸ |
| Customers with non-zero balance | 10 140 |
| Fractional balances | 6 668 |
| Largest single balance | 5 792,60 ₸ |
| With birthday | 3 696 |
| Blacklisted | 6 |
| Platforms | iOS 7 410 · Android 5 785 · none 1 736 · Telegram 72 |

**Rounding decision (owner, 12.08.2026): round fractional balances UP.**
Total cost across the whole base is about **3 374 ₸** — negligible — and no
customer loses a single point during the switch. Implemented in
`parsePoints()` in `prisma/import-loyalty-balances.ts`, covered by tests in
`test/loyalty-import-points.test.ts`. The importer also accepts the Russian
decimal comma («224,11») and treats «—» as zero.

Screenshots are not required. The export must be performed while the owner is logged in to the FoodPicasso admin panel and must use only data available to that account.

## Safe export of full profiles

1. Open **Clients** in FoodPicasso in Safari.
2. Clear the phone filter so the full list is visible.
3. Open Safari Web Inspector → **Network**.
4. Reload the client list and select the latest `getByParams` request.
5. Right-click the request and choose **Copy as cURL**.
6. Save the clipboard locally without sending its contents anywhere:

   ```bash
   pbpaste > /tmp/foodpicasso-getByParams.curl
   ```

7. Run a one-page test:

   ```bash
   cd "/Users/Dom/Приложение доставки/pizzburg/backend"
   npm run foodpicasso:export -- \
     --curl /tmp/foodpicasso-getByParams.curl \
     --max-pages 1
   ```

8. If the test succeeds, run the full export:

   ```bash
   npm run foodpicasso:export -- \
     --curl /tmp/foodpicasso-getByParams.curl
   ```

The files are saved under `pizzburg/private/foodpicasso/<timestamp>/`. The entire `private/` directory is ignored by Git.

## Phone numbers (phase two)

Capture a `client/suggest` request from Safari after typing several digits into
the phone filter, then save it locally. Never paste its cURL text into chat or
commit it: it contains an authenticated session cookie.

```bash
pbpaste > /tmp/foodpicasso-suggest.curl && chmod 600 /tmp/foodpicasso-suggest.curl

cd "/Users/Dom/Приложение доставки/pizzburg/backend"
npm run foodpicasso:phones -- \
  --curl /tmp/foodpicasso-suggest.curl \
  --clients ../private/foodpicasso/<folder>/clients-rich.json
```

### How the traversal works

`suggest` matches a substring of the phone and caps every answer at 50 records,
so a blind sweep of all 4-digit combinations would both take an hour and still
lose customers behind saturated queries. Instead the exporter walks adaptively:

1. Start from single digits `0`…`9`.
2. Whenever a query comes back with exactly 50 records it is *saturated* —
   more customers may hide behind it — so the query is deepened by appending
   **and prepending** a digit. Prepending matters: without it every phone that
   *ends* with the current substring would be lost.
3. Queries returning fewer than 50 records are complete and are not deepened.
4. Stop early once every profile id has a phone.

The exporter reuses the cURL parsing and checksum signing from
`scripts/lib/foodpicasso-curl.ts`, paces requests (300 ms by default), retries
transient failures three times, checkpoints `phones.json` every 200 queries and
saves whatever it has if it is interrupted. A 401/403 is treated as an expired
session and stops immediately with instructions instead of retrying.

Output in `phones-<timestamp>/`: `phones.json` (id → phone),
`clients-merged.json` / `.csv` (profiles joined with normalised `+7…` numbers)
and `summary.json` with coverage and duplicate-phone counts.

## Результат выгрузки телефонов (13.08.2026)

| Показатель | Значение |
|---|---|
| Телефонов собрано | **14 971** |
| Уникальных номеров | 14 971 (**повторов нет**) |
| Покрытие профилей | 14 965 из 15 003 (**99,7%**) |
| Профилей без телефона | 38 |
| Запросов к `suggest` | ~18 800 |

**38 профилей без телефона — «пустые» записи, мигрировать нечего:** у 36 из них
вообще нет платформы, суммарно у всех **ноль заказов и ноль баллов**. Это
брошенные регистрации, а не потерянные клиенты.

Отдельно: 79 номеров не начинаются с `+77` — это городские номера Павлодарской
области, формат корректный, длина та же.

Прогон занял около 20 часов: сервер FoodPicasso отвечает медленно, а не
ограничивает нас — ошибок и разрывов сессии не было ни разу.

## Пробный импорт: план без записи (13.08.2026)

Импортёр `backend/prisma/import-loyalty-balances.ts` без `--apply` только
читает БД и раскладывает отчёт на диск. Команда:

```bash
cd "/Users/Dom/Приложение доставки/pizzburg/backend"
npm run loyalty:import -- \
  ../private/foodpicasso/2026-08-12T20-22-06-073Z/phones-2026-08-12T20-35-59-417Z/clients-merged.csv
```

Флаги: `--apply` (запись), `--tenant=`, `--batch=` (обязателен при `--apply`),
`--report=<dir>`, `--sample=n`, `--no-birthday`.

### Результат прогона

| Показатель | Значение |
|---|---|
| Строк данных | 15 003 |
| Пройдут импорт | **14 965** |
| Отклонено | 38 — все по причине «телефон отсутствует» |
| Дублей номеров после нормализации | **0** |
| Будет создано | 14 964 |
| Будет обновлено | 1 (тестовый аккаунт владельца) |
| Баллов после импорта | **3 214 585 ₸** |
| Клиентов с ненулевым балансом | 10 140 |
| Клиентов с нулевым балансом | 4 825 |
| Кому баланс уменьшится | **0** |
| Дат рождения разобрано | 3 696 |
| Время прогона | 0,8 с |

**Контрольная сходимость.** Сумму пересчитали независимо, прямо из
`clients-rich.json`: 3 211 211,07 ₸ в FoodPicasso, округление вверх стоит
3 373,93 ₸, итог 3 214 585 ₸ — ровно то, что показал импортёр. Отдельно
сошлись число клиентов с ненулевым балансом (10 140) и число дат рождения
(3 696) с таблицей качества выгрузки выше.

**38 отклонённых профилей проверены поимённо:** у них суммарно ноль баллов,
ноль заказов, ни одного имени. Терять нечего.

### Файлы отчёта

Каталог `private/foodpicasso/import-plan-local-2026-08-13/`, права 600:

| Файл | Содержимое |
|---|---|
| `summary.json` | агрегаты, хост БД, арендатор, метка, время |
| `plan.csv` | построчно: legacyId, телефон, действие, было → станет, дельта |
| `rejected.csv` | отклонённые строки с причиной |
| `sample-check.csv` | 30 клиентов равномерным шагом для ручной сверки |
| `duplicates.csv` | создаётся только если дубли есть |

`sample-check.csv` — рабочий лист для шага «сверить 20–30 клиентов»: в нём
есть `legacyId` (по нему клиент ищется в админке FoodPicasso) и пустая
колонка `балансФП_вручную` под фактическое значение с экрана.

### Что проверено в самом импортёре

Путь записи прогонялся на одноразовой БД `pizzburg_import_check`
(создана, проверена, удалена) на синтетических данных — рабочие БД не
затрагивались:

- `87074445566` нормализуется в `+77074445566`, дубль с `+7707…` ловится
  **до** записи и валит прогон;
- дробные балансы округляются вверх (1006,67 → 1007; 5 792,60 → 5793),
  «—» → 0, високосная дата 29.02.2000 разбирается;
- в журнал лояльности пишется **дельта**, а не абсолютный баланс;
- имя и дата рождения уже существующего клиента не перезаписываются: то, что
  человек указал в нашем приложении, старая база не перебивает (баланс —
  исключение, ради него импорт и делается);
- повтор той же метки `--batch` даёт только skip и не задваивает баланс;
- `--apply` без явного `--batch` отказывается работать.

### Что НЕ переносится

| Данные | Состояние |
|---|---|
| `isBlacklist` (6 клиентов) | поля в схеме нет; если нужен — отдельная задача с полем и экраном в админке |
| `platform`, число заказов, средний чек | полей в схеме нет; это агрегаты старого приложения |

Даты рождения **переносятся** (решение владельца 13.08.2026): 3 696 штук,
включено по умолчанию, отключается флагом `--no-birthday`. Умолчание такое,
потому что метка `--batch` делает пропуск необратимым — прогон без дат
пометит клиентов импортированными, и повтор будет пропущен.

## Подключение к staging Railway

Внутреннее имя `postgres.railway.internal` резолвится **только изнутри сети
Railway** — с ноутбука оно даёт NXDOMAIN. Публичного доступа у базы нет и
включать его не нужно: Railway умеет SSH-туннель.

**Требования, каждое из которых стоило времени:**

1. **Railway CLI не ниже 5.x.** В 4.x нет флага `--tunnel-only`, и
   `railway connect` отвечает `Connection URL should point to the Railway TCP
   proxy`. На этой машине в `PATH` стоит npm-версия 4.11.0, она перекрывает
   brew-версию, поэтому вызывать нужно по прямому пути:
   `/opt/homebrew/Cellar/railway/<версия>/bin/railway`.
2. **SSH-ключ, зарегистрированный в аккаунте Railway.** Локального ключа мало:
   `ssh-keygen -t ed25519`, затем `railway ssh keys add`. Без регистрации
   туннель отвечает `No registered SSH keys found`.
3. **Проект должен быть привязан:** `railway link -p pizzburg-staging-production`.

Туннель (держать открытым, закрывается по Ctrl+C):

```bash
cd "/Users/Dom/Приложение доставки/pizzburg" && /opt/homebrew/Cellar/railway/5.40.0/bin/railway connect Postgres --tunnel-only -P 55432
```

Он печатает пароль на экран. Пароль кладётся в `backend/.env.staging`
(шаблон `.env.*` уже в `.gitignore`), в переписку не передаётся:

```bash
DATABASE_URL="postgresql://postgres:ПАРОЛЬ@127.0.0.1:55432/railway"
```

**Туннель рвётся.** За сессию он обрывался трижды, причём порт остаётся
занятым мёртвым процессом, и симптом выглядит как «база не отвечает», а не
как «туннель упал». Лечение:

```bash
lsof -ti :55432 | xargs kill
```

Прогон с этим файлом:

```bash
cd "/Users/Dom/Приложение доставки/pizzburg/backend"
set -a && . ./.env.staging && set +a
npm run loyalty:import -- \
  ../private/foodpicasso/2026-08-12T20-22-06-073Z/phones-2026-08-12T20-35-59-417Z/clients-merged.csv \
  --report=../private/foodpicasso/import-plan-staging
```

В шапке вывода печатается хост базы — по нему видно, что прогон ушёл именно
на staging, а не на локальную БД.

### Схема staging отставала

Импорт упал на `The column legalVersions does not exist`: на Railway была
развёрнута схема до Спринтов 1–2. Разница оказалась чисто аддитивной (новый
enum, 6 nullable-колонок, 2 таблицы, индексы, один FK — ни одного `DROP`),
поэтому применялась не через `db push`, а явным SQL в одной транзакции:

```bash
./node_modules/.bin/prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --script > /tmp/migrate.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f /tmp/migrate.sql
```

Перед следующим прогоном на staging стоит сразу проверять
`prisma migrate diff` — расхождение схемы обнаруживается только на первой
пачке записи, когда транзакция уже откатывается.

## Импорт в staging выполнен (14.08.2026)

Метка `legacy-2026-08`, отчёт в
`private/foodpicasso/import-apply-staging-2026-08-14/`.

| Показатель | План | Факт в БД |
|---|---|---|
| Импортировано | 14 965 | **14 965** |
| Создано / обновлено | 14 964 / 1 | 14 964 / 1 |
| Баллов | 3 214 585 ₸ | **3 214 585 ₸** |
| Клиентов с ненулевым балансом | 10 140 | **10 140** |
| Дат рождения | 3 696 | **3 696** |
| Баланс уменьшился | 0 | **0** |

Проверки после записи: 9 существующих заказов staging не затронуты; повторный
прогон той же метки дал 14 965 skip, баланс и журнал не изменились; 25
случайных клиентов из `plan.csv` сверены с БД по баллам и дате рождения —
расхождений нет.

**Дельта-выгрузку перед переходом нужно гнать НОВОЙ меткой** (`legacy-<дата>`):
при повторе `legacy-2026-08` все прежние клиенты уйдут в skip, и обновления
балансов не применятся.

## Security after export

- Delete the temporary cURL file: `rm /tmp/foodpicasso-getByParams.curl`.
- Sign out of FoodPicasso and sign in again to invalidate the session cookie used in the copied request.
- Keep the export folder private because it contains personal data.
