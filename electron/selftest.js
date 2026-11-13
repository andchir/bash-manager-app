'use strict';

/**
 * Сквозной selftest: гоняет реальный сценарий через IPC-границу
 * (renderer -> preload -> ipcMain -> модули) в скрытом окне.
 * Запуск: electron . --selftest
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const settingsStore = require('./core/settings');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(win) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-selftest-'));
  const steps = [];
  const ok = (name, cond, extra) => {
    steps.push({ name, pass: !!cond });
    if (!cond) throw new Error(`STEP_FAIL: ${name}${extra ? ' — ' + extra : ''}`);
    console.log('ok  -', name);
  };

  const SCRIPT = `(async () => {
    const api = window.api;
    const root = ${JSON.stringify(root)};
    const results = [];
    const step = (n) => results.push(n);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    step('setRoot');
    const st = await api.setRoot(root);
    if (!st.rootDir) throw new Error('setRoot failed');

    step('vaultSetup');
    await api.vaultSetup({ password: 'СуперПароль!123', remember: false });

    step('createGroup');
    await api.createGroup('Интеграция');

    step('createScript');
    const { file } = await api.createScript({ group: 'Интеграция', name: 'проверка', meta: { title: 'Проверка' } });
    if (file !== 'проверка.sh') throw new Error('unexpected file ' + file);

    step('saveScript');
    await api.saveScript({ group: 'Интеграция', file, content: 'echo "env=$BM_ENV"\\n' });

    step('saveMeta+env');
    let doc = await api.readScript({ group: 'Интеграция', file });
    doc.meta.env = { BM_ENV: 'значение' };
    await api.saveMeta({ group: 'Интеграция', file, meta: doc.meta });

    step('runLocal');
    const outputs = [];
    api.onRunOutput((p) => outputs.push(p));
    const exits = [];
    api.onRunExit((p) => exits.push(p));
    const { runId } = await api.runScript({ group: 'Интеграция', file, args: [], env: {} });
    let exit = null;
    for (let i = 0; i < 100 && !exit; i++) {
      await sleep(100);
      exit = exits.find((e) => e.runId === runId) || null;
    }
    if (!exit) throw new Error('no run exit event');
    if (exit.code !== 0) throw new Error('exit code ' + exit.code);
    const outText = outputs.filter((o) => o.runId === runId).map((o) => o.chunk).join('');
    if (!outText.includes('env=значение')) throw new Error('env not passed: ' + outText);

    step('history');
    const runs = await api.listRuns();
    if (runs.length !== 1 || runs[0].code !== 0) throw new Error('bad history ' + JSON.stringify(runs));
    const full = await api.readRun(runs[0].id);
    if (!full.output.includes('env=значение')) throw new Error('history output missing');

    step('lock');
    await api.vaultLock();

    step('saveMetaLocked');
    doc = await api.readScript({ group: 'Интеграция', file });
    doc.meta.ssh = { host: 'h', login: 'root', password: 'pw' };
    let lockedCode = null;
    let lockErr = '';
    try { await api.saveMeta({ group: 'Интеграция', file, meta: doc.meta }); }
    catch (e) {
      lockedCode = e && e.code;
      try { lockErr = 'name=' + (e && e.name) + ' msg=' + (e && e.message) + ' str=' + String(e) + ' keys=' + Object.keys(e || {}).join(',') + ' json=' + JSON.stringify(e); }
      catch (_) { lockErr = 'unserializable'; }
    }
    if (lockedCode !== 'LOCKED') throw new Error('expected LOCKED, got ' + lockedCode + ' / ' + lockErr);

    step('wrongPassword');
    let wrongCode = null;
    try { await api.vaultUnlock({ password: 'неверный' }); }
    catch (e) { wrongCode = e.code; }
    if (wrongCode !== 'WRONG_PASSWORD') throw new Error('expected WRONG_PASSWORD, got ' + wrongCode);

    step('unlock');
    await api.vaultUnlock({ password: 'СуперПароль!123' });

    step('encryptOnSave');
    await api.saveMeta({ group: 'Интеграция', file, meta: doc.meta });
    const after = await api.readScript({ group: 'Интеграция', file });
    const ssh = after.meta.ssh || {};
    if (typeof ssh.login !== 'string' || !ssh.login.startsWith('enc1:')) throw new Error('login not encrypted');
    if (typeof ssh.password !== 'string' || !ssh.password.startsWith('enc1:')) throw new Error('password not encrypted');
    const raw = JSON.stringify(after.meta);
    if (raw.includes('"root"') || raw.includes('"pw"')) throw new Error('plaintext leak in meta');

    step('noPlaintextToRenderer');
    // renderer видит только шифртекст
    if (ssh.login === 'root' || ssh.password === 'pw') throw new Error('plaintext to renderer');

    step('changePassword');
    const ch = await api.vaultChangePassword({ oldPassword: 'СуперПароль!123', newPassword: 'Новый!Пароль456' });
    if (!ch.status.unlocked) throw new Error('not unlocked after change');
    const after2 = await api.readScript({ group: 'Интеграция', file });
    if (!String(after2.meta.ssh.login).startsWith('enc1:')) throw new Error('reencrypt broken');

    step('unlockWithNew');
    await api.vaultLock();
    await api.vaultUnlock({ password: 'Новый!Пароль456' });

    step('groupsList');
    const groups = await api.listGroups();
    if (groups.length !== 1 || groups[0].scriptCount !== 1) throw new Error('bad groups ' + JSON.stringify(groups));

    step('protectGitignore');
    const gi = await api.protectGitignore();
    if (!gi || !gi.file) throw new Error('gitignore failed');

    step('vaultFileOnDisk');
    return { root, steps: results };
  })()`;

  try {
    const result = await win.webContents.executeJavaScript(SCRIPT, true);
    // проверки на стороне main: файлы на диске
    const metaRaw = fs.readFileSync(path.join(root, 'Интеграция', 'проверка.sh.meta.json'), 'utf8');
    ok('meta-on-disk-encrypted', metaRaw.includes('enc1:') && !metaRaw.includes('"root"') && !metaRaw.includes('"pw"'));
    const vaultRaw = fs.readFileSync(path.join(root, '.bash-manager', 'vault.json'), 'utf8');
    ok('vaultfile-no-password', !vaultRaw.includes('СуперПароль') && !vaultRaw.includes('Новый!Пароль'));
    ok('runs-dir-exists', fs.existsSync(path.join(root, '.bash-manager', 'runs')));
    ok('gitignore-content', fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('.bash-manager/runs/'));

    // Запоминание геометрии окна: resize -> сохранение в настройки (debounce 400 мс)
    win.setSize(520, 380, false);
    await sleep(800);
    const saved = settingsStore.load(app);
    const wb = saved.windowBounds || {};
    ok('window-bounds-saved', wb.width === 520 && wb.height === 380 && wb.maximized === false, JSON.stringify(wb));

    console.log('SELFTEST_PASS', JSON.stringify({ steps: result.steps.length + 5 }));
    return true;
  } catch (e) {
    console.error('SELFTEST_FAIL:', e.message);
    console.error('completed steps:', JSON.stringify(steps));
    return false;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { run };
