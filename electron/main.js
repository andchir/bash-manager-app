'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, screen } = require('electron');
const ipc = require('./ipc');
const settingsStore = require('./core/settings');
const { mt } = require('./core/i18n-main');

const SMOKE = process.argv.includes('--smoke');
const SELFTEST = process.argv.includes('--selftest');

// Защита от второго экземпляра
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void bootstrap();
}

/** Виден ли хотя бы кусок окна на каком-нибудь мониторе (защита от смены конфигурации дисплеев). */
function boundsVisible(b) {
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') return false;
  const MIN_OVERLAP = 80;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const ox = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const oy = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    return ox >= MIN_OVERLAP && oy >= MIN_OVERLAP;
  });
}

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

async function bootstrap() {
  await app.whenReady();

  // Восстановление размера/положения окна из прошлого запуска
  const initialSettings = settingsStore.load(app);
  const savedBounds = initialSettings.windowBounds || null;
  const winOpts = {
    width: 1320,
    height: 840,
    minWidth: 400,
    minHeight: 300,
    title: 'Bash Manager',
    backgroundColor: '#0b1120',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
  if (savedBounds && boundsVisible(savedBounds)) {
    Object.assign(winOpts, {
      x: savedBounds.x,
      y: savedBounds.y,
      width: Math.max(400, savedBounds.width),
      height: Math.max(300, savedBounds.height),
    });
  }
  const win = new BrowserWindow(winOpts);
  if (savedBounds?.maximized) win.maximize();

  win.once('ready-to-show', () => { if (!SMOKE && !SELFTEST) win.show(); });

  await ipc.init(win);

  buildMenu(win, ipc.currentLang());
  ipc.setOnLangChange((lang) => buildMenu(win, lang));

  // Запоминаем геометрию окна (обычные границы, не развёрнутые) для следующих запусков
  const persistBounds = () => {
    try {
      if (win.isDestroyed()) return;
      const s = ipc.state.settings;
      const maximized = win.isMaximized();
      const next = { ...(s.windowBounds || {}), maximized };
      if (!maximized) Object.assign(next, win.getNormalBounds());
      s.windowBounds = next;
      settingsStore.save(app, s);
    } catch { /* некритично */ }
  };
  const persistBoundsSoon = debounce(persistBounds, 400);
  win.on('resize', persistBoundsSoon);
  win.on('move', persistBoundsSoon);
  win.on('maximize', persistBounds);
  win.on('unmaximize', persistBounds);
  win.on('close', persistBounds);

  if (SELFTEST) {
    const { run } = require('./selftest');
    win.webContents.on('did-finish-load', async () => {
      const passed = await run(win);
      app.exit(passed ? 0 : 1);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('SELFTEST_FAIL renderer:', details.reason);
      app.exit(1);
    });
  }

  if (SMOKE) {
    win.webContents.on('console-message', (details) => {
      const msg = details?.message || String(details);
      console.log(`[renderer:${details?.level || '?'}]`, msg);
    });
    win.webContents.on('did-finish-load', () => {
      console.log('SMOKE_OK');
      setTimeout(async () => {
        try {
          const r = await win.webContents.executeJavaScript(
            "({api: typeof window.api, screen: (document.querySelector('h1')||{}).textContent || (document.querySelector('h2')||{}).textContent || '', len: (document.getElementById('root')||{}).innerHTML?.length||0, locale: window.getLocale && window.getLocale(), i18nMissing: window.__i18nMissing ? Array.from(window.__i18nMissing) : ['<no collector>'], ctrls: (() => { const c = document.createElement('input'); c.type = 'checkbox'; document.body.appendChild(c); const s = document.createElement('select'); s.className = 'inp'; document.body.appendChild(s); const cc = getComputedStyle(c); const sc = getComputedStyle(s); const out = { cbx: cc.appearance === 'none', cbxSize: cc.width, sel: sc.appearance === 'none', selChevron: (sc.backgroundImage || '').includes('svg') }; c.remove(); s.remove(); return out; })()})",
          );
          console.log('SMOKE_DETAILS', JSON.stringify(r));
        } catch (e) {
          console.log('SMOKE_DETAILS_FAIL', e.message);
        }
        app.exit(0);
      }, 800);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('SMOKE_FAIL', details.reason);
      app.exit(1);
    });
  }

  win.on('closed', () => {
    app.quit();
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void bootstrap();
  });
}

function buildMenu(win, lang) {
  const t = (key) => mt(lang, key);
  const template = [
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.chooseRoot'),
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:choose-root'),
        },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit') },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        { role: 'reload', label: t('menu.reload') },
        { role: 'togglefullscreen', label: t('menu.fullscreen') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('menu.zoom100') },
        { role: 'zoomIn', label: t('menu.zoomIn') },
        { role: 'zoomOut', label: t('menu.zoomOut') },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools', label: t('menu.devtools') }]),
      ],
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.about'),
          click: () => win.webContents.send('menu:about'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
