'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  theme: 'dark',
  fontSize: 13,
  autoLockMin: 10,
  lastRoot: null,
  recentRoots: [],
  confirmDelete: true,
  lang: 'auto', // 'auto' | 'en' | 'ru'
  windowBounds: null, // {x, y, width, height, maximized}
};

function settingsPath(app) {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load(app) {
  try {
    const raw = fs.readFileSync(settingsPath(app), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(app, settings) {
  const file = settingsPath(app);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

module.exports = { load, save, DEFAULTS };
