#!/bin/zsh
# Надёжный перезапуск dev-сервера: убивает всё на порту, стартует заново.
cd "$(dirname "$0")"
PORT=${PORT:-3210}
lsof -ti :$PORT | xargs kill 2>/dev/null
sleep 1
if lsof -ti :$PORT > /dev/null; then
  echo "Порт $PORT всё ещё занят" >&2
  exit 1
fi
exec npm run dev
