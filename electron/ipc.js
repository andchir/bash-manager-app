'use strict';

/**
 * IPC-слой: все каналы общения renderer <-> main.
 * Секреты (дешифрованные SSH-доступы) НИКОГДА не покидают main-процесс.
 */

const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog, safeStorage, BrowserWindow } = require('electron');
const vault = require('./crypto/vault');
const settingsStore = require('./core/settings');
const repo = require('./core/repo');
const history = require('./core/history');
const runner = require('./core/runner');
const ssh = require('./core/ssh');
const { resolveLang, mt } = require('./core/i18n-main');

const state = {
  settings: null,
  rootDir: null,
  vault: null, // содержимое .bash-manager/vault.json
  key: null, // Buffer — производный ключ (только в памяти)
  masterPassword: null, // String — только если включено «запомнить на устройстве»
  win: null,
};

// ---------- авто-блокировка ----------

let autoLockTimer = null;

function resetAutoLock() {
  const minutes = Number(state.settings?.autoLockMin) || 0;
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = null;
  if (minutes > 0 && state.key) {
    autoLockTimer = setTimeout(() => lockVault('auto'), minutes * 60 * 1000);
    autoLockTimer.unref?.();
  }
}

function send(event, payload) {
  if (state.win && !state.win.isDestroyed()) {
    state.win.webContents.send(event, payload);
  }
}

// ---------- хранилище мастер-пароля на устройстве (safeStorage) ----------

function rememberedFile() {
  const dir = path.join(app.getPath('userData'), 'secure');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = state.rootDir ? vault.sha256hex(state.rootDir) : 'none';
  return path.join(dir, id + '.bin');
}

async function canRemember() {
  try {
    // В Electron 45+ isAsyncEncryptionAvailable() может возвращать Promise
    if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
      return !!(await safeStorage.isAsyncEncryptionAvailable());
    }
    return !!safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function saveRemembered(password) {
  if (!canRemember()) return false;
  const enc = safeStorage.encryptString(String(password));
  fs.writeFileSync(rememberedFile(), enc, { mode: 0o600 });
  return true;
}

function loadRemembered() {
  try {
    const enc = fs.readFileSync(rememberedFile());
    return safeStorage.decryptString(enc);
  } catch {
    return null;
  }
}

function clearRemembered() {
  try { fs.unlinkSync(rememberedFile()); } catch { /* файла нет */ }
}

// ---------- сессия хранилища ----------

async function vaultStatus() {
  return {
    hasVault: !!state.vault,
    unlocked: !!state.key,
    remembered: (await canRemember()) && fs.existsSync(rememberedFile()),
    canRemember: await canRemember(),
    rootDir: state.rootDir,
  };
}

async function refreshVault() {
  state.vault = state.rootDir ? await repo.readJson(repo.vaultFile(state.rootDir)) : null;
  state.key = null;
  state.masterPassword = null;
}

function requireUnlocked() {
  if (!state.key) {
    const err = new Error('Хранилище заблокировано — введите мастер-пароль');
    err.code = 'LOCKED';
    throw err;
  }
  return state.key;
}

function lockVault(reason) {
  state.key = null;
  state.masterPassword = null;
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = null;
  send('vault:locked', { reason });
}

async function unlockWithPassword(password) {
  if (!state.vault) throw Object.assign(new Error('Хранилище не создано'), { code: 'NO_VAULT' });
  if (!vault.verifyVault(state.vault, password)) {
    throw Object.assign(new Error('Неверный мастер-пароль'), { code: 'WRONG_PASSWORD' });
  }
  state.key = vault.keyFromPassword(state.vault, password);
  resetAutoLock();
  return true;
}

// ---------- эффективные SSH-настройки скрипта ----------

function effectiveSsh(meta, groupMeta) {
  const groupSsh = groupMeta?.ssh || {};
  const scriptSsh = meta?.ssh || {};
  const merged = { ...groupSsh, ...scriptSsh };
  if (meta?.inheritSsh === false && meta.ssh) return { ...meta.ssh };
  return merged;
}

async function persistHostKey(group, file, fp) {
  try {
    if (!state.rootDir) return;
    const { meta, groupMeta } = await repo.readScript(state.rootDir, group, file);
    const scriptHasSsh = !!meta?.ssh && Object.keys(meta.ssh).length > 0;
    if (scriptHasSsh) {
      const m = meta;
      m.ssh = { ...m.ssh, hostKey: fp };
      await repo.saveMeta(state.rootDir, group, file, m);
    } else {
      const g = groupMeta || {};
      g.ssh = { ...(g.ssh || {}), hostKey: fp };
      await repo.saveGroupMeta(state.rootDir, group, g);
    }
  } catch (e) {
    console.error('persistHostKey:', e.message);
  }
}

// ---------- регистрация IPC ----------

function register(win) {
  state.win = win;
  state.settings = settingsStore.load(app);
  state.rootDir = state.settings.lastRoot || null;

  runner.init(send);
  ssh.setHostKeyConfirm(async (info) => {
    // Спрашиваем пользователя через renderer; ждём ответ
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      pendingHostKey.set(id, resolve);
      send('ssh:hostkey', { id, ...info });
    });
  });

  // Обёртка: логирует активность (сброс авто-блокировки) и ловит ошибки
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      resetAutoLock();
      try {
        return { ok: true, data: await fn(...args) };
      } catch (e) {
        return { ok: false, error: { code: e.code || 'ERROR', message: e.message } };
      }
    });
  };

  ipcMain.on('ssh:hostkey:reply', (_e, { id, accepted }) => {
    const resolve = pendingHostKey.get(id);
    if (resolve) {
      pendingHostKey.delete(id);
      resolve(!!accepted);
    }
  });

  // ---------- приложение / настройки ----------

  handle('app:state', async () => ({
    vault: await vaultStatus(),
    settings: state.settings,
    locale: currentLang(),
    version: app.getVersion(),
  }));

  handle('app:chooseRoot', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: mt(currentLang(), 'dialog.chooseRoot'),
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: state.rootDir || app.getPath('home'),
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    await setRoot(res.filePaths[0]);
    return { canceled: false, rootDir: state.rootDir, vault: await vaultStatus() };
  });

  handle('app:setRoot', async (dir) => {
    await setRoot(dir);
    return { rootDir: state.rootDir, vault: await vaultStatus() };
  });

  handle('settings:update', async (patch) => {
    state.settings = { ...state.settings, ...patch };
    settingsStore.save(app, state.settings);
    resetAutoLock();
    if (Object.prototype.hasOwnProperty.call(patch, 'lang') && onLangChange) {
      onLangChange(currentLang());
    }
    return state.settings;
  });

  // ---------- хранилище ----------

  handle('vault:setup', async ({ password, remember }) => {
    if (!state.rootDir) throw Object.assign(new Error('Сначала выберите папку со скриптами'), { code: 'NO_ROOT' });
    if (String(password).length < 8) {
      throw Object.assign(new Error('Мастер-пароль должен быть не короче 8 символов'), { code: 'WEAK_PASSWORD' });
    }
    if (state.vault) throw Object.assign(new Error('Хранилище уже создано'), { code: 'VAULT_EXISTS' });
    state.vault = vault.createVault(password);
    await repo.writeJsonAtomic(repo.vaultFile(state.rootDir), state.vault);
    state.key = vault.keyFromPassword(state.vault, password);
    if (remember) {
      state.masterPassword = String(password);
      saveRemembered(password);
    }
    resetAutoLock();
    return vaultStatus();
  });

  handle('vault:unlock', async ({ password }) => {
    let pw = password;
    if (!pw) {
      pw = loadRemembered();
      if (!pw) throw Object.assign(new Error('Нет сохранённого пароля для автоматической разблокировки'), { code: 'NO_REMEMBERED' });
    }
    await unlockWithPassword(pw);
    if (fs.existsSync(rememberedFile())) state.masterPassword = pw;
    return vaultStatus();
  });

  handle('vault:tryAutoUnlock', async () => {
    if (state.key || !state.vault) return vaultStatus();
    const pw = loadRemembered();
    if (pw) {
      try { await unlockWithPassword(pw); } catch { /* неверный сохранённый пароль */ }
    }
    return vaultStatus();
  });

  handle('vault:lock', async () => { lockVault('manual'); return vaultStatus(); });

  handle('vault:setRemember', async ({ remember }) => {
    if (remember) {
      if (!state.masterPassword) {
        throw Object.assign(new Error('Пароль доступен только сразу после ввода — введите его ещё раз с включённой опцией'), { code: 'NEED_PASSWORD' });
      }
      saveRemembered(state.masterPassword);
    } else {
      clearRemembered();
      state.masterPassword = null;
    }
    return vaultStatus();
  });

  handle('vault:forget', async () => {
    clearRemembered();
    state.masterPassword = null;
    return vaultStatus();
  });

  handle('vault:changePassword', async ({ oldPassword, newPassword }) => {
    if (!state.vault) throw Object.assign(new Error('Хранилище не создано'), { code: 'NO_VAULT' });
    if (!vault.verifyVault(state.vault, oldPassword)) {
      throw Object.assign(new Error('Неверный текущий мастер-пароль'), { code: 'WRONG_PASSWORD' });
    }
    if (String(newPassword).length < 8) {
      throw Object.assign(new Error('Новый пароль должен быть не короче 8 символов'), { code: 'WEAK_PASSWORD' });
    }
    const oldKey = vault.keyFromPassword(state.vault, oldPassword);
    const newVault = vault.createVault(newPassword);
    const newKey = vault.keyFromPassword(newVault, newPassword);

    // Перешифровываем все SSH-блоки (группы + скрипты)
    const groups = await repo.listGroups(state.rootDir);
    let reencrypted = 0;
    const rotate = (block) => {
      if (!block) return block;
      const out = { ...block };
      for (const f of vault.SENSITIVE_FIELDS) {
        if (vault.isEncrypted(out[f])) {
          out[f] = vault.encryptField(newKey, vault.decryptField(oldKey, out[f]));
          reencrypted++;
        }
      }
      return out;
    };
    for (const g of groups) {
      const gm = await repo.readGroupMeta(state.rootDir, g.name);
      if (gm?.ssh && vault.sshBlockHasPlaintext(gm.ssh) === false) {
        gm.ssh = rotate(gm.ssh);
        await repo.saveGroupMeta(state.rootDir, g.name, gm);
      }
      for (const s of await repo.listScripts(state.rootDir, g.name)) {
        const m = await repo.readMeta(state.rootDir, g.name, s.file);
        if (m?.ssh) {
          m.ssh = rotate(m.ssh);
          await repo.saveMeta(state.rootDir, g.name, s.file, m);
        }
      }
    }
    state.vault = newVault;
    await repo.writeJsonAtomic(repo.vaultFile(state.rootDir), newVault);
    state.key = newKey;
    if (state.masterPassword || fs.existsSync(rememberedFile())) {
      state.masterPassword = String(newPassword);
      saveRemembered(newPassword);
    }
    resetAutoLock();
    return { status: await vaultStatus(), reencrypted };
  });

  // ---------- репозиторий ----------

  handle('repo:listGroups', async () => repo.listGroups(requireRoot()));
  handle('repo:listScripts', async (group) => repo.listScripts(requireRoot(), group));

  handle('repo:readScript', async ({ group, file }) => {
    const data = await repo.readScript(requireRoot(), group, file);
    // Не отдаём дешифрованные поля — отдаём как есть (enc1:...)
    return data;
  });

  handle('repo:saveScript', async ({ group, file, content }) => {
    await repo.saveScriptContent(requireRoot(), group, file, content);
    return { savedAt: new Date().toISOString() };
  });

  handle('repo:createScript', async ({ group, name, meta }) => {
    const result = await repo.createScript(requireRoot(), group, name, meta);
    return result;
  });

  handle('repo:deleteScript', async ({ group, file }) => {
    await repo.deleteScript(requireRoot(), group, file);
    return true;
  });

  handle('repo:saveMeta', async ({ group, file, meta }) => {
    const key = state.key;
    const hadPlain = vault.sshBlockHasPlaintext(meta?.ssh);
    if (hadPlain && !key) {
      throw Object.assign(new Error('Для сохранения SSH-доступа разблокируйте хранилище'), { code: 'LOCKED' });
    }
    if (meta?.ssh && key) meta = { ...meta, ssh: vault.encryptSshBlock(key, meta.ssh) };
    await repo.saveMeta(requireRoot(), group, file, meta);
    return { savedAt: new Date().toISOString() };
  });

  handle('repo:readGroupMeta', async (group) => repo.readGroupMeta(requireRoot(), group));

  handle('repo:saveGroupMeta', async ({ group, meta }) => {
    const key = state.key;
    if (vault.sshBlockHasPlaintext(meta?.ssh) && !key) {
      throw Object.assign(new Error('Для сохранения SSH-доступа разблокируйте хранилище'), { code: 'LOCKED' });
    }
    if (meta?.ssh && key) meta = { ...meta, ssh: vault.encryptSshBlock(key, meta.ssh) };
    await repo.saveGroupMeta(requireRoot(), group, meta);
    return { savedAt: new Date().toISOString() };
  });

  handle('repo:createGroup', async (name) => { await repo.createGroup(requireRoot(), name); return true; });

  handle('repo:deleteGroup', async (name) => { await repo.deleteGroup(requireRoot(), name); return true; });

  handle('repo:protectGitignore', async () => repo.protectGitignore(requireRoot()));

  // ---------- запуск ----------

  handle('run:script', async ({ group, file, args, env }) => {
    const root = requireRoot();
    const { content, meta, groupMeta } = await repo.readScript(root, group, file);
    const runOn = meta?.runOn === 'remote' ? 'remote' : 'local';
    const timeoutSec = Number(meta?.timeoutSec) || Number(groupMeta?.defaults?.timeoutSec) || 300;
    const timeoutMs = timeoutSec * 1000;
    const fullEnv = { ...(groupMeta?.env || {}), ...(meta?.env || {}), ...(env || {}) };
    const runId = vault.sha256hex(`${Date.now()}-${Math.random()}`).slice(0, 16);

    if (runOn === 'remote') {
      const sshBlock = effectiveSsh(meta, groupMeta);
      if (!sshBlock.host) {
        throw Object.assign(new Error('Для удалённого запуска укажите SSH-доступ (скрипт или группа)'), { code: 'NO_SSH' });
      }
      const key = requireUnlocked();
      const plain = vault.decryptSshBlock(key, sshBlock);
      runner.runRemote(root, {
        runId, group, file, content,
        args: args || [],
        env: fullEnv,
        sshCfg: plain,
        timeoutMs,
        persistHostKey: (fp) => persistHostKey(group, file, fp),
      });
      return { runId, target: `${plain.login}@${plain.host}:${plain.port || 22}`, timeoutMs };
    }

    runner.runLocal(root, { runId, group, file, args: args || [], env: fullEnv, timeoutMs });
    return { runId, target: 'local', timeoutMs };
  });

  handle('run:kill', async (runId) => { runner.kill(runId); return true; });

  handle('runs:list', async () => history.list(requireRoot()));
  handle('runs:read', async (id) => history.read(requireRoot(), id));

  // ---------- SSH ----------

  handle('ssh:test', async ({ group, file, ssh }) => {
    requireRoot();
    let block = ssh;
    if (group && file) {
      const { meta, groupMeta } = await repo.readScript(state.rootDir, group, file);
      block = effectiveSsh(meta, groupMeta);
    }
    if (!block?.host) throw Object.assign(new Error('Не указан хост'), { code: 'NO_HOST' });
    const key = requireUnlocked();
    const plain = vault.decryptSshBlock(key, block);
    const result = await ssh.testConnection(plain);
    // TOFU: при первом успешном подключении сохраняем отпечаток ключа хоста
    if (result.ok && result.newHostKey && !block.hostKey && group && file) {
      await persistHostKey(group, file, result.newHostKey);
      result.hostKeySaved = true;
    }
    return result;
  });

  // ---------- утилиты ----------

  handle('app:pickFile', async ({ title, filters }) => {
    const res = await dialog.showOpenDialog(win, {
      title: title || mt(currentLang(), 'dialog.pickFile'),
      filters: filters || [{ name: mt(currentLang(), 'dialog.pickFile'), extensions: ['*'] }],
      properties: ['openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
}

const pendingHostKey = new Map();

/** Эффективный язык интерфейса (авто → язык ОС). */
function currentLang() {
  return resolveLang(state.settings?.lang, app.getLocale());
}

let onLangChange = null;
function setOnLangChange(fn) {
  onLangChange = fn;
}

function requireRoot() {
  if (!state.rootDir) throw Object.assign(new Error('Сначала выберите папку со скриптами'), { code: 'NO_ROOT' });
  return state.rootDir;
}

async function setRoot(dir) {
  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    throw Object.assign(new Error(`Папка не найдена: ${dir}`), { code: 'ROOT_NOT_FOUND' });
  }
  if (!st.isDirectory()) throw Object.assign(new Error('Указанный путь не является папкой'), { code: 'ROOT_NOT_DIR' });
  state.rootDir = dir;
  state.settings.lastRoot = dir;
  state.settings.recentRoots = [dir, ...(state.settings.recentRoots || []).filter((d) => d !== dir)].slice(0, 5);
  settingsStore.save(app, state.settings);
  await refreshVault();
  // Авто-разблокировка, если на этом устройстве пароль сохранён
  const pw = loadRemembered();
  if (pw && state.vault) {
    try { await unlockWithPassword(pw); state.masterPassword = pw; } catch { /* сохранённый пароль не подошёл */ }
  }
}

async function init(win) {
  register(win);
  await refreshVault();
  const pw = loadRemembered();
  if (pw && state.vault) {
    try { await unlockWithPassword(pw); state.masterPassword = pw; } catch { /* игнорируем */ }
  }
}

module.exports = { init, register, state, send, lockVault, resetAutoLock, vaultStatus, currentLang, setOnLangChange };
