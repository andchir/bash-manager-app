'use strict';

/**
 * SSH-слой поверх ssh2.
 *
 * Безопасность:
 *  - верификация ключа хоста (TOFU): при первом подключении приложение
 *    показывает отпечаток и ждёт явного подтверждения; отпечаток сохраняется
 *    в метаданных; при смене ключа подключение блокируется (возможен MITM);
 *  - секреты (пароль/пароль ключа) живут только в памяти main-процесса;
 *  - аргументы экранируются одинарными кавычками, env передаётся протоколом SSH.
 */

const fs = require('fs');
const { Client } = require('ssh2');

let confirmHostKey = null; // (info) => Promise<boolean>, устанавливается из ipc.js

function setHostKeyConfirm(fn) {
  confirmHostKey = fn;
}

function fingerprintOf(hashedKeyHex) {
  const b64 = Buffer.from(hashedKeyHex, 'hex').toString('base64').replace(/=+$/, '');
  return `SHA256:${b64}`;
}

function quoteShell(value) {
  return "'" + String(value).replace(/'/g, `'\\''`) + "'";
}

function sanitizeEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) out[k] = String(v);
  }
  return out;
}

class SshError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Подключается к серверу и выполняет скрипт через `bash -s` (скрипт передаётся в stdin).
 *
 * @param {object} cfg host, port, login, password?, privateKeyPath?, passphrase?, hostKey?, timeoutMs?
 * @param {object} run   content, args[], env{}
 * @param {object} hooks { onData(buf, isErr), onClose(code, signal), onNewHostKey(fp) }
 * @returns {{ close: () => void }}
 */
async function runScript(cfg, run, hooks) {
  if (!cfg.host) throw new SshError('NO_HOST', 'Не указан хост SSH');
  if (!cfg.login) throw new SshError('NO_LOGIN', 'Не указан логин SSH');
  if (!cfg.password && !cfg.privateKeyPath) {
    throw new SshError('NO_AUTH', 'Не указан ни пароль, ни путь к приватному ключу');
  }

  const conn = new Client();
  let streamRef = null;
  let newHostKey = null;

  const connectPromise = new Promise((resolve, reject) => {
    const opts = {
      host: cfg.host,
      port: Number(cfg.port) || 22,
      username: cfg.login,
      readyTimeout: Math.min(Number(cfg.timeoutMs) || 20000, 60000),
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      hostHash: 'sha256',
      hostVerifier: (hashedKey, cb) => {
        const fp = fingerprintOf(String(hashedKey));
        if (cfg.hostKey) {
          if (cfg.hostKey === fp) {
            if (cb) return cb(true);
            return true;
          }
          const err = new SshError('HOSTKEY_CHANGED', `Ключ хоста изменился!\nОжидался: ${cfg.hostKey}\nПолучен:  ${fp}\n\nВозможна атака «человек посередине». Подключение заблокировано.`);
          if (cb) {
            cb(false);
            reject(err);
          }
          return false;
        }
        // TOFU: спрашиваем пользователя
        const done = (accepted) => {
          if (accepted) {
            newHostKey = fp;
            hooks.onNewHostKey?.(fp);
          }
          if (cb) cb(accepted);
        };
        if (confirmHostKey) {
          confirmHostKey({ host: cfg.host, port: opts.port, fingerprint: fp })
            .then(done)
            .catch(() => done(false));
          return;
        }
        done(false);
      },
    };
    if (cfg.privateKeyPath) {
      try {
        opts.privateKey = fs.readFileSync(cfg.privateKeyPath);
      } catch (e) {
        reject(new SshError('KEY_READ', `Не удалось прочитать ключ ${cfg.privateKeyPath}: ${e.message}`));
        return;
      }
      if (cfg.passphrase) opts.passphrase = cfg.passphrase;
    } else {
      opts.password = cfg.password || undefined;
      opts.tryKeyboard = false;
    }

    conn.on('ready', () => {
      const argsPart = (run.args || []).map(quoteShell).join(' ');
      const cmd = 'bash -s' + (argsPart ? ' -- ' + argsPart : '');
      conn.exec(cmd, { env: sanitizeEnv(run.env) }, (err, stream) => {
        if (err) {
          reject(new SshError('EXEC', err.message));
          return;
        }
        streamRef = stream;
        stream.on('data', (d) => hooks.onData?.(d, false));
        stream.stderr.on('data', (d) => hooks.onData?.(d, true));
        stream.on('close', (code, signal) => {
          hooks.onClose?.(code, signal);
        });
        stream.on('error', () => {});
        stream.end(run.content || '');
        resolve({ close: () => closeAll() });
      });
    });
    conn.on('error', (err) => {
      reject(new SshError('CONNECT', err.message));
    });
    conn.on('close', () => {
      hooks.onClose?.(undefined, 'CLOSED');
    });
    try {
      conn.connect(opts);
    } catch (e) {
      reject(new SshError('CONNECT', e.message));
    }
  });

  function closeAll() {
    try { streamRef?.close(); } catch { /* уже закрыт */ }
    try { conn.end(); } catch { /* уже закрыт */ }
  }

  await connectPromise;
  return {
    close: () => closeAll(),
    get newHostKey() { return newHostKey; },
  };
}

/** Проверка соединения: подключиться и выполнить echo. */
async function testConnection(cfg) {
  let stdout = '';
  let exitCode = null;
  let newHostKey = null;
  const started = Date.now();
  const timeoutMs = Math.min(Number(cfg.timeoutMs) || 15000, 60000);

  let handle;
  try {
    handle = await runScript(
      { ...cfg, timeoutMs },
      { content: 'echo __BM_OK__\n', args: [], env: {} },
      {
        onData: (d, isErr) => { if (!isErr) stdout += d.toString(); },
        onClose: (code) => { exitCode = code; },
        onNewHostKey: (fp) => { newHostKey = fp; },
      },
    );
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e.message, code: e.code };
  }
  // Даём команде шанс завершиться штатно
  const deadline = Date.now() + timeoutMs;
  while (exitCode === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 60));
  }
  handle.close();
  const ok = exitCode === 0 && stdout.includes('__BM_OK__');
  return { ok, ms: Date.now() - started, output: stdout.trim(), exitCode, newHostKey };
}

module.exports = { runScript, testConnection, setHostKeyConfirm, SshError, quoteShell, sanitizeEnv };
