'use strict';

/**
 * Ядро безопасности приложения.
 *
 * Мастер-пароль никогда не сохраняется в открытом виде.
 * Из него через scrypt выводится ключ (32 байта), которым
 * чувствительные поля (логин/пароль SSH, пароль ключа) шифруются
 * по AES-256-GCM. Каждое поле шифруется со своим случайным IV.
 *
 * Проверка мастер-пароля — через HMAC-верификатор (сравнение
 * в constant-time), сам пароль/ключ на диске не хранятся.
 */

const crypto = require('crypto');

const ENC_PREFIX = 'enc1:';
const MAGIC = 'bash-manager/vault/v1';

// Параметры scrypt: ~32 МиБ памяти, комфортная скорость разблокировки.
const KDF_DEFAULTS = { N: 32768, r: 8, p: 1, keylen: 32 };

const SENSITIVE_FIELDS = ['login', 'password', 'passphrase'];

function b64(buf) {
  return Buffer.from(buf).toString('base64');
}

function unb64(str) {
  return Buffer.from(String(str), 'base64');
}

function deriveKey(password, salt, params = KDF_DEFAULTS) {
  return crypto.scryptSync(String(password), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 256 * 1024 * 1024,
  });
}

function computeVerifier(key) {
  return crypto.createHmac('sha256', key).update(MAGIC).digest('base64');
}

/** Создаёт дескриптор хранилища для нового мастер-пароля. */
function createVault(password) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  return {
    version: 1,
    kdf: 'scrypt',
    params: { ...KDF_DEFAULTS, salt: b64(salt) },
    verifier: computeVerifier(key),
    createdAt: new Date().toISOString(),
  };
}

/** Проверяет мастер-пароль против верификатора (constant-time). */
function verifyVault(vault, password) {
  try {
    const salt = unb64(vault.params.salt);
    const key = deriveKey(password, salt, { ...KDF_DEFAULTS, ...vault.params });
    const expected = Buffer.from(vault.verifier, 'base64');
    const actual = Buffer.from(computeVerifier(key), 'base64');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Возвращает ключ из мастер-пароля (вызывать после verifyVault). */
function keyFromPassword(vault, password) {
  const salt = unb64(vault.params.salt);
  return deriveKey(password, salt, { ...KDF_DEFAULTS, ...vault.params });
}

function encryptField(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + b64(Buffer.concat([iv, tag, ct]));
}

function decryptField(key, payload) {
  if (!isEncrypted(payload)) {
    throw new Error('FIELD_NOT_ENCRYPTED');
  }
  const raw = unb64(payload.slice(ENC_PREFIX.length));
  if (raw.length < 29) {
    throw new Error('FIELD_CORRUPT');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/**
 * Шифрует чувствительные поля SSH-блока, если они переданы открытым текстом.
 * Уже зашифрованные значения (enc1:...) оставляет как есть.
 */
function encryptSshBlock(key, ssh) {
  if (!ssh || typeof ssh !== 'object') return ssh;
  const out = { ...ssh };
  for (const field of SENSITIVE_FIELDS) {
    const v = out[field];
    if (typeof v === 'string' && v.length > 0 && !isEncrypted(v)) {
      out[field] = encryptField(key, v);
    }
  }
  return out;
}

/** Дешифрует чувствительные поля SSH-блока (в память, только main-процесс). */
function decryptSshBlock(key, ssh) {
  if (!ssh || typeof ssh !== 'object') return ssh;
  const out = { ...ssh };
  for (const field of SENSITIVE_FIELDS) {
    const v = out[field];
    if (isEncrypted(v)) {
      out[field] = decryptField(key, v);
    }
  }
  return out;
}

function sshBlockHasPlaintext(ssh) {
  if (!ssh || typeof ssh !== 'object') return false;
  return SENSITIVE_FIELDS.some((f) => typeof ssh[f] === 'string' && ssh[f].length > 0 && !isEncrypted(ssh[f]));
}

/** Простая оценка стойкости пароля: 0..4. */
function passwordStrength(pw) {
  const s = String(pw || '');
  if (!s) return 0;
  let score = 0;
  if (s.length >= 8) score++;
  if (s.length >= 12) score++;
  if (/[a-zа-яё]/.test(s) && /[A-ZА-ЯЁ]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^a-zA-Zа-яА-ЯёЁ0-9\s]/.test(s)) score++;
  return Math.min(4, score);
}

/** Устойчивый к таймингам хэш для имён файлов/идентификаторов. */
function sha256hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

module.exports = {
  ENC_PREFIX,
  SENSITIVE_FIELDS,
  createVault,
  verifyVault,
  keyFromPassword,
  deriveKey,
  computeVerifier,
  encryptField,
  decryptField,
  isEncrypted,
  encryptSshBlock,
  decryptSshBlock,
  sshBlockHasPlaintext,
  passwordStrength,
  sha256hex,
};
