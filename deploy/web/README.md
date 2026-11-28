# Сайт new.pizzburg.kz (Railway, проект pizzburg-staging-production, сервис web)

Сайт не выкладывается push'ем — только вручную:

```bash
cd mobile && flutter build web --release --dart-define=API_URL=https://api.pizzburg.kz --dart-define=KASPI_BRAND_ASSETS_READY=true
D=$(mktemp -d) && cp ../deploy/web/Caddyfile ../deploy/web/Dockerfile $D/ && cp -R build/web $D/site
cd $D && railway link   # проект pizzburg-staging-production, окружение production, сервис web
railway up --service web --environment production --ci
```

Без `Dockerfile` и `Caddyfile` рядом с `site/` Railpack падает
(«Railpack failed to prepare the build») — так было 28.11.2026.
