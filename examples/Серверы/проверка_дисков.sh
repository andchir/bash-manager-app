#!/usr/bin/env bash
set -euo pipefail

echo "=== Состояние дисков ==="
df -h -x tmpfs -x devtmpfs 2>/dev/null || df -h
echo
echo "=== Самые большие каталоги в /var (топ-5) ==="
du -x -h -d1 /var 2>/dev/null | sort -rh | head -n 6 || echo "du недоступен"
