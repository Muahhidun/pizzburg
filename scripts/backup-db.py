#!/usr/bin/env python3
"""Резервная копия боевой базы.

Дамп снимается ВНУТРИ контейнера Railway, а не с ноутбука: сервер там
Postgres 18, а локальный pg_dump обычно старее и с таким сервером
работать отказывается. Публичного адреса у базы нет и заводить его
незачем — `railway ssh` уже даёт нужный доступ.

Файл кладётся в ~/PizzBurg-backups с правами 600. Это личный каталог,
а не репозиторий: в дампе персональные данные всех клиентов.

    python3 scripts/backup-db.py            # снять копию
    python3 scripts/backup-db.py --keep 30  # и оставить 30 последних

Проверка восстановления — отдельная процедура, см. docs/BACKUP.md.
Копия, которую ни разу не разворачивали, копией не считается.
"""
import argparse
import base64
import datetime
import os
import pathlib
import subprocess
import sys

DEST = pathlib.Path(os.path.expanduser('~/PizzBurg-backups'))
SERVICE = 'Postgres'
DUMP_CMD = 'pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL" </dev/null | base64 -w0'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--keep', type=int, default=14,
                    help='сколько последних копий оставить (по умолчанию 14)')
    args = ap.parse_args()

    DEST.mkdir(mode=0o700, exist_ok=True)

    print('снимаю дамп…', flush=True)
    try:
        p = subprocess.run(['railway', 'ssh', '--service', SERVICE, DUMP_CMD],
                           capture_output=True, text=True, timeout=1800)
    except subprocess.TimeoutExpired:
        print('не дождался ответа за 30 минут', file=sys.stderr)
        return 1

    payload = ''.join(p.stdout.split())
    if not payload:
        print('пустой ответ:', p.stderr[-500:], file=sys.stderr)
        return 1

    raw = base64.b64decode(payload)

    # Подпись формата: без неё это не архив, а обрывок вывода.
    if raw[:5] != b'PGDMP':
        print(f'получено {len(raw)} байт, но это не дамп pg_dump', file=sys.stderr)
        return 1

    name = 'pizzburg-' + datetime.datetime.now().strftime('%Y%m%d-%H%M') + '.dump'
    path = DEST / name
    path.write_bytes(raw)
    os.chmod(path, 0o600)
    print(f'{path}  ({len(raw) / 1024 / 1024:.1f} МБ)')

    copies = sorted(DEST.glob('pizzburg-*.dump'))
    for old in copies[:-args.keep] if args.keep > 0 else []:
        old.unlink()
        print('удалил старую копию:', old.name)

    print(f'копий в каталоге: {len(sorted(DEST.glob("pizzburg-*.dump")))}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
