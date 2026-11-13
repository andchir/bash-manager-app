#!/usr/bin/env bash
set -euo pipefail

# Обновление системы (пример для Bash Manager)
# Аргументы: --channel <stable|beta>

CHANNEL="${2:-stable}"

echo "=== Обновление системы ==="
echo "Хост: $(hostname)"
echo "Время: $(date '+%d.%m.%Y %H:%M:%S')"
echo "Канал обновлений: ${CHANNEL}"
echo

if command -v apt-get >/dev/null 2>&1; then
  echo "Обновление индексов пакетов (apt)…"
  sudo apt-get update -qq
  echo "Индексы обновлены."
elif command -v dnf >/dev/null 2>&1; then
  echo "Проверка обновлений (dnf)…"
  sudo dnf check-update -q || true
else
  echo "Не найден ни apt-get, ни dnf — пропускаем."
fi

echo
echo "Готово."
