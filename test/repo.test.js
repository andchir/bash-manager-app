'use strict';

/** Функциональный тест репозитория и локального раннера: node test/repo.test.js */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const repo = require('../electron/core/repo');
const runner = require('../electron/core/runner');
const history = require('../electron/core/history');

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok  - ${name}`))
    .catch((err) => {
      console.error(`FAIL - ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-test-'));

  await test('createGroup создаёт папку группы', async () => {
    await repo.createGroup(root, 'Тестовая_группа');
    assert.ok(fs.statSync(path.join(root, 'Тестовая_группа')).isDirectory());
  });

  await test('createGroup отклоняет дубль', async () => {
    await assert.rejects(() => repo.createGroup(root, 'Тестовая_группа'), /существует/);
  });

  await test('createGroup отклоняет path traversal', async () => {
    await assert.rejects(() => repo.createGroup(root, '../evil'), /Недопустимое имя/);
    assert.ok(!fs.existsSync(path.join(root, '..', 'evil')));
  });

  await test('createScript создаёт скрипт с русским именем', async () => {
    const { file } = await repo.createScript(root, 'Тестовая_группа', 'мой скрипт', { title: 'Мой скрипт' });
    assert.strictEqual(file, 'мой_скрипт.sh');
    const content = fs.readFileSync(path.join(root, 'Тестовая_группа', file), 'utf8');
    assert.ok(content.startsWith('#!/usr/bin/env bash'));
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'Тестовая_группа', file + '.meta.json'), 'utf8'));
    assert.strictEqual(meta.title, 'Мой скрипт');
    assert.ok(meta.id.length > 10);
  });

  await test('createScript добавляет .sh автоматически и уникализирует имя', async () => {
    const a = await repo.createScript(root, 'Тестовая_группа', 'deploy');
    assert.strictEqual(a.file, 'deploy.sh');
    const b = await repo.createScript(root, 'Тестовая_группа', 'deploy');
    assert.strictEqual(b.file, 'deploy-2.sh');
  });

  await test('saveScriptContent атомарно перезаписывает файл', async () => {
    await repo.saveScriptContent(root, 'Тестовая_группа', 'deploy.sh', 'echo hi\n');
    const content = fs.readFileSync(path.join(root, 'Тестовая_группа', 'deploy.sh'), 'utf8');
    assert.strictEqual(content, 'echo hi\n');
  });

  await test('listGroups/listScripts читают структуру', async () => {
    const groups = await repo.listGroups(root);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].scriptCount, 3);
    const scripts = await repo.listScripts(root, 'Тестовая_группа');
    assert.strictEqual(scripts.length, 3);
    const titles = scripts.map((s) => s.title).join('|');
    assert.ok(titles.includes('Мой скрипт'));
  });

  await test('protectGitignore добавляет служебные пути без дублей', async () => {
    const r1 = await repo.protectGitignore(root);
    assert.ok(r1.added.includes('.bash-manager/runs/'));
    const r2 = await repo.protectGitignore(root);
    assert.strictEqual(r2.added.length, 0);
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.ok(gi.includes('.bash-manager/runs/'));
  });

  await test('runner выполняет скрипт локально и пишет историю', async () => {
    const events = [];
    runner.init((ev, payload) => events.push({ ev, payload }));
    await repo.saveScriptContent(root, 'Тестовая_группа', 'deploy.sh', 'echo "привет"\nexit 0\n');
    const runId = 'test-run-1';
    await runner.runLocal(root, {
      runId,
      group: 'Тестовая_группа',
      file: 'deploy.sh',
      args: [],
      env: {},
      timeoutMs: 10000,
    });
    const outputs = events.filter((e) => e.ev === 'run:output').map((e) => e.payload.chunk).join('');
    assert.ok(outputs.includes('привет'), 'ожидался вывод скрипта');
    const exit = events.find((e) => e.ev === 'run:exit');
    assert.strictEqual(exit.payload.code, 0);
    const runs = await history.list(root);
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].code, 0);
    assert.strictEqual(runs[0].target, 'local');
  });

  await test('runner передаёт аргументы и ловит ненулевой код', async () => {
    const events = [];
    runner.init((ev, payload) => events.push({ ev, payload }));
    await repo.saveScriptContent(root, 'Тестовая_группа', 'deploy.sh', 'echo "arg=$2"\nexit 3\n');
    await runner.runLocal(root, {
      runId: 'test-run-2',
      group: 'Тестовая_группа',
      file: 'deploy.sh',
      args: ['--name', 'значение'],
      env: {},
      timeoutMs: 10000,
    });
    const outputs = events.filter((e) => e.ev === 'run:output').map((e) => e.payload.chunk).join('');
    assert.ok(outputs.includes('arg=значение'));
    const exit = events.find((e) => e.ev === 'run:exit');
    assert.strictEqual(exit.payload.code, 3);
  });

  await test('renameGroup переименовывает папку вместе с метой и скриптами', async () => {
    await repo.createGroup(root, 'Временная');
    await repo.createScript(root, 'Временная', 's1', { title: 'S1' });
    await repo.saveGroupMeta(root, 'Временная', { title: 'Вр', ssh: {} });
    await repo.renameGroup(root, 'Временная', 'Постоянная');
    assert.ok(fs.statSync(path.join(root, 'Постоянная')).isDirectory());
    assert.ok(!fs.existsSync(path.join(root, 'Временная')));
    const gm = await repo.readGroupMeta(root, 'Постоянная');
    assert.strictEqual(gm.title, 'Вр');
    const scripts = await repo.listScripts(root, 'Постоянная');
    assert.strictEqual(scripts.length, 1);
    assert.strictEqual(scripts[0].title, 'S1');
  });

  await test('renameGroup отклоняет существующее, служебное и небезопасное имя', async () => {
    await assert.rejects(() => repo.renameGroup(root, 'Постоянная', 'Тестовая_группа'), /существует/);
    await assert.rejects(() => repo.renameGroup(root, 'Постоянная', '.git'), /Недопустимое имя/);
    await assert.rejects(() => repo.renameGroup(root, 'Постоянная', '../evil'), /Недопустимое имя/);
    await assert.rejects(() => repo.renameGroup(root, 'Нет такой', 'Что-то'), /не найдена/);
  });

  await test('пробелы в именах групп и скриптов заменяются на подчёркивания', async () => {
    await repo.createGroup(root, 'Группа с пробелами');
    assert.ok(fs.statSync(path.join(root, 'Группа_с_пробелами')).isDirectory());
    const { file } = await repo.createScript(root, 'Группа_с_пробелами', 'мой скрипт 2');
    assert.strictEqual(file, 'мой_скрипт_2.sh');
    await repo.renameGroup(root, 'Группа_с_пробелами', 'Итоговое имя группы');
    assert.ok(fs.statSync(path.join(root, 'Итоговое_имя_группы')).isDirectory());
    assert.ok(!fs.existsSync(path.join(root, 'Группа_с_пробелами')));
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log('\nГотово.');
})();
