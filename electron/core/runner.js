'use strict';

/**
 * Исполнитель скриптов: локально (child_process) и по SSH.
 * Ведёт реестр запущенных процессов, журналирует вывод.
 */

const { spawn } = require('child_process');
const path = require('path');
const ssh = require('./ssh');
const history = require('./history');

const MAX_LOG_BYTES = 2 * 1024 * 1024; // храним в журнале максимум 2 МиБ вывода

const runs = new Map(); // runId -> { kill() }
let emit = null; // (event, payload) => void, устанавливается из ipc.js

function init(emitFn) {
  emit = emitFn;
}

function isRunning(runId) {
  return runs.has(runId);
}

function kill(runId) {
  const run = runs.get(runId);
  if (run) run.kill();
}

function makeKillTimer(proc, conn, timeoutMs, onTimeout) {
  let t = null;
  if (timeoutMs > 0) {
    t = setTimeout(() => {
      onTimeout();
      try { proc?.kill('SIGTERM'); } catch { /* нет процесса */ }
      setTimeout(() => { try { proc?.kill('SIGKILL'); } catch { /* нет процесса */ } }, 4000).unref();
      conn?.close();
    }, timeoutMs);
    t.unref?.();
  }
  return {
    clear: () => { if (t) clearTimeout(t); },
  };
}

async function runLocal(root, { runId, group, file, args, env, timeoutMs }) {
  const scriptPath = path.join(root, group, file);
  const cwd = path.join(root, group);
  const fullEnv = { ...process.env, ...(env || {}) };
  const startedAt = new Date();

  return new Promise((resolve) => {
    let proc;
    let buf = Buffer.alloc(0);
    let finished = false;
    let timer = null;

    const finish = async (code, signal) => {
      if (finished) return;
      finished = true;
      timer?.clear();
      runs.delete(runId);
      const durationMs = Date.now() - startedAt.getTime();
      const truncated = buf.length >= MAX_LOG_BYTES;
      await history.save(root, {
        startedAt: startedAt.toISOString(),
        durationMs,
        code,
        signal: signal || null,
        script: file,
        group,
        target: 'local',
        output: buf.toString('utf8'),
        truncated,
      }).catch(() => {});
      emit('run:exit', { runId, code, signal: signal || null, durationMs, truncated });
      resolve();
    };

    try {
      proc = spawn('bash', [scriptPath, ...(args || [])], { cwd, env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      emit('run:output', { runId, chunk: `Не удалось запустить: ${e.message}\n`, isErr: true });
      finish(127, null);
      return;
    }

    const onData = (d, isErr) => {
      if (buf.length < MAX_LOG_BYTES) buf = Buffer.concat([buf, d]);
      emit('run:output', { runId, chunk: d.toString('utf8'), isErr });
    };
    proc.stdout.on('data', (d) => onData(d, false));
    proc.stderr.on('data', (d) => onData(d, true));
    proc.on('error', (e) => {
      emit('run:output', { runId, chunk: `Ошибка запуска: ${e.message}\n`, isErr: true });
      void finish(127, null);
    });
    proc.on('close', (code, signal) => void finish(code, signal));

    timer = makeKillTimer(proc, null, timeoutMs, () => {
      emit('run:output', { runId, chunk: `\n— Превышен лимит времени (${Math.round(timeoutMs / 1000)} с), процесс прерван —\n`, isErr: true });
    });

    runs.set(runId, {
      kill: () => {
        emit('run:output', { runId, chunk: '\n— Остановлено пользователем —\n', isErr: true });
        try { proc.kill('SIGTERM'); } catch { /* уже завершился */ }
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* уже завершился */ } }, 3000).unref();
      },
    });

    emit('run:started', { runId, target: 'local', startedAt: startedAt.toISOString() });
  });
}

async function runRemote(root, { runId, group, file, content, args, env, sshCfg, timeoutMs, persistHostKey }) {
  const startedAt = new Date();
  let buf = Buffer.alloc(0);
  let finished = false;

  const finish = async (code, signal) => {
    if (finished) return;
    finished = true;
    runs.delete(runId);
    const durationMs = Date.now() - startedAt.getTime();
    const truncated = buf.length >= MAX_LOG_BYTES;
    await history.save(root, {
      startedAt: startedAt.toISOString(),
      durationMs,
      code: code === undefined ? null : code,
      signal: signal || null,
      script: file,
      group,
      target: `${sshCfg.login}@${sshCfg.host}:${sshCfg.port || 22}`,
      output: buf.toString('utf8'),
      truncated,
    }).catch(() => {});
    emit('run:exit', { runId, code: code === undefined ? null : code, signal: signal || null, durationMs, truncated });
  };

  let handle;
  try {
    handle = await ssh.runScript(
      { ...sshCfg, timeoutMs },
      { content, args, env },
      {
        onData: (d, isErr) => {
          if (buf.length < MAX_LOG_BYTES) buf = Buffer.concat([buf, d]);
          emit('run:output', { runId, chunk: d.toString('utf8'), isErr });
        },
        onClose: (code, signal) => finish(code, signal),
        onNewHostKey: (fp) => {
          persistHostKey?.(fp);
          emit('run:hostkey-saved', { runId, fingerprint: fp });
        },
      },
    );
  } catch (e) {
    emit('run:output', { runId, chunk: `Ошибка SSH: ${e.message}\n`, isErr: true });
    finish(e.code === 'HOSTKEY_CHANGED' ? 254 : 255, null);
    return;
  }

  emit('run:started', {
    runId,
    target: `${sshCfg.login}@${sshCfg.host}:${sshCfg.port || 22}`,
    startedAt: startedAt.toISOString(),
  });

  runs.set(runId, {
    kill: () => {
      emit('run:output', { runId, chunk: '\n— Остановлено пользователем —\n', isErr: true });
      handle.close();
      finish(null, 'KILLED');
    },
  });

  if (timeoutMs > 0) {
    const t = setTimeout(() => {
      if (!finished) {
        emit('run:output', { runId, chunk: `\n— Превышен лимит времени (${Math.round(timeoutMs / 1000)} с), соединение закрыто —\n`, isErr: true });
        handle.close();
        finish(null, 'TIMEOUT');
      }
    }, timeoutMs);
    t.unref?.();
  }
}

module.exports = { init, runLocal, runRemote, kill, isRunning };
