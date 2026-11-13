# Сборка Bash Manager

Инструкция по сборке установочных пакетов для **Linux** и **Windows** с помощью [electron-builder](https://www.electron.build/).

## Что получится на выходе

| Платформа | Форматы | Куда попадёт |
|---|---|---|
| Linux | AppImage, deb | `dist/` |
| Windows | NSIS-установщик (.exe), portable (.exe) | `dist/` |

Важно: у приложения **нет нативных модулей** (ssh2 — чистый JavaScript), поэтому `electron-rebuild` не нужен, а кросс-сборка значительно проще, чем обычно.

---

## Требования

Общие:

- **Node.js ≥ 20** и npm ≥ 10
- Интернет-соединение — electron-builder скачивает дистрибутив Electron, NSIS и вспомогательные утилиты в кеш (`~/.cache/electron`, `~/.cache/electron-builder`)

Дополнительно для сборки **Windows на Linux**: **Wine** ( wine64 ≥ 6) — нужен утилите rcedit для прописывания иконки, версии и метаданных в `.exe`:

```bash
# Debian/Ubuntu/Mint
sudo apt install wine64
```

Сборка Windows **на Windows** дополнительных инструментов не требует.

---

## Подготовка

```bash
git clone <репозиторий> && cd bash-manager-app
npm install          # зависимости
npm run build:css    # собрать стили Tailwind (файл src/renderer/tailwind.css уже вкоммитлен,
                     # шаг нужен только если меняли src/input.css)
```

Проверка, что приложение работает до сборки:

```bash
npm start            # запуск из исходников
npm test             # 30 юнит-тестов: крипто, репозиторий, локализация
npm run smoke        # headless-запуск окна (нужен Xvfb на Linux без дисплея)
npm run selftest     # сквозной E2E-сценарий через IPC
```

---

## Сборка под Linux

На машине с Linux (нативно):

```bash
npm run pack:linux
```

Результат в `dist/` (имена зависят от `version` в `package.json`):

- `Bash Manager-1.0.0.AppImage` — портабельный запуск:
  ```bash
  chmod +x "dist/Bash Manager-1.0.0.AppImage"
  ./dist/Bash\ Manager-1.0.0.AppImage
  ```
- `bash-manager_1.0.0_amd64.deb` — пакет для Debian/Ubuntu/Mint:
  ```bash
  sudo apt install ./dist/bash-manager_1.0.0_amd64.deb
  ```

Сборка Linux-пакетов на Windows/macOS тоже возможна (`npx electron-builder --linux` на соответствующей машине), AppImage и deb собираются без эмуляторов.

---

## Сборка под Windows

### Вариант 1. На Windows (рекомендуется)

```bat
npm install
npm run build:css
npm run pack:win
```

Результат в `dist/`:

- `Bash Manager-1.0.0-x64-setup.exe` — установщик (можно выбрать каталог установки, создаёт ярлыки)
- `Bash Manager-1.0.0-x64-portable.exe` — портабельная версия, установка не требуется

> **SmartScreen.** Без сертификата код-подписи Windows покажет защитное предупреждение «Неизвестный издатель» — это штатно для open-source сборок. Чтобы подписывать: положите сертификат (PFX) и задайте в `package.json` → `build.win.certificateFile` / `certificatePassword` либо переменные окружения `WIN_CSC_LINK` и `WIN_CSC_KEY_PASSWORD`.

### Вариант 2. Кросс-сборка на Linux

```bash
sudo apt install wine64
npm run pack:win
```

Wine используется только на этапе пропатчивания `.exe` (иконка, версия, название продукта). NSIS и остальное electron-builder скачивает сам. Если Wine не установлен, сборка прервётся с ошибкой rcedit — в этом случае собирайте на Windows или в CI.

---

## Сборка обеих платформ сразу

На Linux при установленном Wine:

```bash
npm run pack         # electron-builder --linux --win по умолчанию? нет —
                     # собирает для текущей ОС; для явного перечисления:
npx electron-builder --linux --win
```

---

## CI: пример GitHub Actions

```yaml
name: build
on:
  push:
    tags: ['v*']

jobs:
  linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build:css
      - run: npm run pack:linux
      - uses: actions/upload-artifact@v4
        with:
          name: linux-packages
          path: dist/

  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build:css
      - run: npm run pack:win
      - uses: actions/upload-artifact@v4
        with:
          name: windows-packages
          path: dist/
```

---

## Прочее

- **Версия** задаётся полем `version` в `package.json` — она попадает и в имена файлов, и в метаданные установщиков.
- **Иконка** — `build/icon.png` (512×512 с прозрачным фоном), используется для Linux и Windows (electron-builder сам конвертирует в нужные форматы). Пересоздать:
  ```bash
  xvfb-run -a npm run make-icon   # Linux без дисплея
  npm run make-icon               # на машине с дисплеем
  ```
- **Конфигурация electron-builder** живёт в секции `build` файла `package.json`.
- **Куда приложение складывает данные после установки:**
  - Linux: `~/.config/Bash Manager/` (настройки, «запомненный» мастер-пароль в зашифрованном виде safeStorage)
  - Windows: `%APPDATA%\Bash Manager\`
  - Папка со скриптами и журнал запусков выбирается/лежит отдельно и в установку не входит.
- **Кеши** (если нужно перенести/очистить): `~/.cache/electron`, `~/.cache/electron-builder`; переменные `ELECTRON_CACHE` и `ELECTRON_BUILDER_CACHE` позволяют задать другой путь.

## Устранение проблем

| Проблема | Решение |
|---|---|
| `Error: Cannot find module 'app-builder-bin'` | `npm install` выполнен частично — переустановите зависимости |
| Сборка Windows на Linux падает на rcedit | Установите `wine64`; либо собирайте на Windows/в CI |
| SmartScreen блокирует установщик | Ожидаемо без кода-подписи → «Подробнее» → «Выполнить в любом случае», либо купите сертификат |
| AppImage не запускается | `chmod +x`; на некоторых системах нужен пакет `libfuse2` (`sudo apt install libfuse2`) |
| Долгий первый запуск сборки | Идёт загрузка Electron/NSIS в кеш — последующие сборки быстрые |
