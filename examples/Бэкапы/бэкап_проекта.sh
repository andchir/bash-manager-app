#!/usr/bin/env bash
set -euo pipefail

# Архивация каталога (пример удалённого запуска по SSH)
# Аргументы: --dir <путь>

DIR="${2:-/etc}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT="/tmp/backup-${STAMP}.tar.gz"

echo "=== Бэкап ${DIR} ==="
echo "Хост: $(hostname)"
echo "Архив: ${OUT}"
echo

if [ ! -d "${DIR}" ]; then
  echo "Ошибка: каталог ${DIR} не найден" >&2
  exit 1
fi

tar -czf "${OUT}" -C "$(dirname "${DIR}")" "$(basename "${DIR}")"
echo "Размер: $(du -h "${OUT}" | cut -f1)"
echo "Хранить дней (env KEEP_DAYS): ${KEEP_DAYS:-7}"
echo "Готово: ${OUT}"
