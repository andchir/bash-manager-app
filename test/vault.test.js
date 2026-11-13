'use strict';

/** Юнит-тест криптоядра: node test/vault.test.js */

const assert = require('assert');
const vault = require('../electron/crypto/vault');

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

const PASSWORD = 'Str0ng!Мастер-Пароль';
const WRONG = 'Str0ng!Мастер-Пароль2';

test('createVault возвращает структуру с солью и верификатором', () => {
  const v = vault.createVault(PASSWORD);
  assert.strictEqual(v.version, 1);
  assert.ok(v.params.salt.length >= 16);
  assert.ok(v.verifier.length > 20);
});

test('verifyVault принимает правильный пароль', () => {
  const v = vault.createVault(PASSWORD);
  assert.strictEqual(vault.verifyVault(v, PASSWORD), true);
});

test('verifyVault отклоняет неправильный пароль', () => {
  const v = vault.createVault(PASSWORD);
  assert.strictEqual(vault.verifyVault(v, WRONG), false);
  assert.strictEqual(vault.verifyVault(v, ''), false);
});

test('verifyVault не падает на битых данных', () => {
  assert.strictEqual(vault.verifyVault({}, PASSWORD), false);
  assert.strictEqual(vault.verifyVault(null, PASSWORD), false);
});

test('шифрование поля: roundtrip', () => {
  const v = vault.createVault(PASSWORD);
  const key = vault.keyFromPassword(v, PASSWORD);
  const secret = 'логин: аdmin, пароль: p@ss w0rd!"№;';
  const enc = vault.encryptField(key, secret);
  assert.ok(enc.startsWith('enc1:'));
  assert.ok(!enc.includes(secret));
  assert.strictEqual(vault.decryptField(key, enc), secret);
});

test('каждое шифрование даёт разный шифртекст (случайный IV)', () => {
  const v = vault.createVault(PASSWORD);
  const key = vault.keyFromPassword(v, PASSWORD);
  const a = vault.encryptField(key, 'same');
  const b = vault.encryptField(key, 'same');
  assert.notStrictEqual(a, b);
});

test('расшифровка неверным ключом падает (GCM)', () => {
  const v = vault.createVault(PASSWORD);
  const key = vault.keyFromPassword(v, PASSWORD);
  const enc = vault.encryptField(key, 'secret');
  const v2 = vault.createVault(WRONG);
  const key2 = vault.keyFromPassword(v2, WRONG);
  assert.throws(() => vault.decryptField(key2, enc));
});

test('подмена шифртекста обнаруживается (целостность GCM)', () => {
  const v = vault.createVault(PASSWORD);
  const key = vault.keyFromPassword(v, PASSWORD);
  const enc = vault.encryptField(key, 'secret');
  const raw = Buffer.from(enc.slice(5), 'base64');
  raw[raw.length - 1] ^= 0xff;
  const tampered = 'enc1:' + raw.toString('base64');
  assert.throws(() => vault.decryptField(key, tampered));
});

test('encryptSshBlock шифрует только чувствительные поля', () => {
  const v = vault.createVault(PASSWORD);
  const key = vault.keyFromPassword(v, PASSWORD);
  const ssh = { host: 'srv.local', port: 22, login: 'root', password: 'pw', passphrase: '' };
  const enc = vault.encryptSshBlock(key, ssh);
  assert.strictEqual(enc.host, 'srv.local');
  assert.strictEqual(enc.port, 22);
  assert.ok(vault.isEncrypted(enc.login));
  assert.ok(vault.isEncrypted(enc.password));
  assert.strictEqual(enc.passphrase, '');
  const dec = vault.decryptSshBlock(key, enc);
  assert.strictEqual(dec.login, 'root');
  assert.strictEqual(dec.password, 'pw');
});

test('encryptSshBlock не трогает уже зашифрованные значения', () => {
  const v = vault.createVault(PASSWORD);
  const key = vault.keyFromPassword(v, PASSWORD);
  const once = vault.encryptSshBlock(key, { login: 'root' });
  const twice = vault.encryptSshBlock(key, once);
  assert.strictEqual(once.login, twice.login);
});

test('sshBlockHasPlaintext корректно детектит открытые секреты', () => {
  assert.strictEqual(vault.sshBlockHasPlaintext({ login: 'root' }), true);
  assert.strictEqual(vault.sshBlockHasPlaintext({ host: 'h' }), false);
  assert.strictEqual(vault.sshBlockHasPlaintext(null), false);
});

test('passwordStrength: шкала 0..4', () => {
  assert.strictEqual(vault.passwordStrength(''), 0);
  assert.ok(vault.passwordStrength('short') <= 1);
  assert.ok(vault.passwordStrength('Abcdef12!xyz') >= 3);
  assert.ok(vault.passwordStrength('Длинный!Пароль123') >= 3);
});

console.log('\nГотово.');
