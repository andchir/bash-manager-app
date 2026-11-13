'use strict';

/** Тест локализации: парность ключей en/ru, интерполяция. node test/i18n.test.js */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Заглушки браузерного окружения для i18n.js
global.window = globalThis;
global.document = { documentElement: {}, title: '' };
require('../src/renderer/i18n.js');

function test(name, fn) {
  try {
    fn();
    console.log(`ok  - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const { __LOCALES: L } = globalThis;

test('словари en и ru содержат одинаковый набор ключей', () => {
  const en = Object.keys(L.en).sort();
  const ru = Object.keys(L.ru).sort();
  const onlyEn = en.filter((k) => !ru.includes(k));
  const onlyRu = ru.filter((k) => !en.includes(k));
  assert.deepStrictEqual(onlyEn, [], `ключи только в en: ${onlyEn.join(', ')}`);
  assert.deepStrictEqual(onlyRu, [], `ключи только в ru: ${onlyRu.join(', ')}`);
});

test('нет пустых строк в словарях', () => {
  for (const lang of ['en', 'ru']) {
    for (const [k, v] of Object.entries(L[lang])) {
      assert.ok(String(v).trim().length > 0, `${lang}:${k} пустое`);
    }
  }
});

test('t() возвращает перевод текущей локали', () => {
  setLocale('en');
  assert.strictEqual(t('common.save'), 'Save');
  setLocale('ru');
  assert.strictEqual(t('common.save'), 'Сохранить');
});

test('интерполяция {var}', () => {
  setLocale('ru');
  assert.strictEqual(t('run.finishedErr', { code: 3 }), 'Скрипт завершился с кодом 3');
  setLocale('en');
  assert.strictEqual(t('output.errorCode', { code: 7 }), 'Error (code 7)');
});

test('недостающий ключ попадает в __i18nMissing и возвращает ключ', () => {
  setLocale('en');
  const before = __i18nMissing.size;
  const v = t('no.such.key');
  assert.strictEqual(v, 'no.such.key');
  assert.strictEqual(__i18nMissing.size, before + 1);
});

test('ru-ключи не должны остаться непереведёнными в en (кириллица в en-словаре)', () => {
  const cyrillic = /[\u0400-\u04FF]/;
  const leaks = Object.entries(L.en)
    .filter(([, v]) => cyrillic.test(String(v)))
    .map(([k]) => k);
  // Допустимо: имена собственные (Русский) — проверяем, что кириллица только в langRu
  const allowed = ['settings.langRu'];
  const bad = leaks.filter((k) => !allowed.includes(k));
  assert.deepStrictEqual(bad, [], `непереведённые en-ключи: ${bad.join(', ')}`);
});

test('латиница в ru-словаре допустима только для технических строк', () => {
  const tech = /^[A-Za-z0-9 .,:;()•~\/\\_{}·-]+$/;
  const suspicious = Object.entries(L.ru)
    .filter(([k, v]) => !tech.test(String(v)) && !/[\u0400-\u04FF«»—…]/.test(String(v)))
    .map(([k]) => k);
  assert.deepStrictEqual(suspicious, []);
});

test('все ключи t() из app.js существуют в словаре', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/\bt\(\s*'([a-z]+[a-zA-Z0-9.]*?)'/g)) {
    keys.add(m[1]);
  }
  const missing = [];
  for (const k of keys) {
    if (k.endsWith('.')) {
      // динамические ключи вида 'vault.strength.' + score / 'error.' + code
      if (L.en[k + '0'] === undefined && L.en[k + 'LOCKED'] === undefined) missing.push(k + '*');
    } else if (L.en[k] === undefined) {
      missing.push(k);
    }
  }
  assert.deepStrictEqual(missing, [], `отсутствуют ключи: ${missing.join(', ')}`);
  console.log(`     проверено ключей: ${keys.size}`);
});

console.log('\nГотово.');
