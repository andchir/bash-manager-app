'use strict';

/**
 * Работа с папкой скриптов (репозиторием).
 *
 * Структура:
 *   <root>/<Группа>/<скрипт>.sh            — код скрипта
 *   <root>/<Группа>/<скрипт>.sh.meta.json  — метаданные скрипта
 *   <root>/<Группа>/group.json             — метаданные группы (общие SSH-настройки и т.п.)
 *   <root>/.bash-manager/vault.json        — соль и верификатор мастер-пароля
 *   <root>/.bash-manager/runs/             — журнал запусков (рекомендован к .gitignore)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GROUP_FILE = 'group.json';
const META_SUFFIX = '.meta.json';
const MANAGER_DIR = '.bash-manager';
const SCRIPT_EXTS = ['.sh', '.bash'];
const SKIP_DIRS = new Set([MANAGER_DIR, '.git', 'node_modules']);

class RepoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function managerDir(root) {
  return path.join(root, MANAGER_DIR);
}

function vaultFile(root) {
  return path.join(managerDir(root), 'vault.json');
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await fs.promises.rename(tmp, file);
}

async function assertRoot(root) {
  if (!root) throw new RepoError('NO_ROOT', 'Папка со скриптами не выбрана');
  let st;
  try {
    st = await fs.promises.stat(root);
  } catch {
    throw new RepoError('ROOT_NOT_FOUND', `Папка не найдена: ${root}`);
  }
  if (!st.isDirectory()) throw new RepoError('ROOT_NOT_DIR', 'Указанный путь не является папкой');
}

async function listGroups(root) {
  await assertRoot(root);
  const ents = await fs.promises.readdir(root, { withFileTypes: true });
  const groups = [];
  for (const ent of ents) {
    if (!ent.isDirectory() || SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
    const meta = await readJson(path.join(root, ent.name, GROUP_FILE));
    const scripts = await listScripts(root, ent.name);
    groups.push({
      name: ent.name,
      title: meta?.title || ent.name,
      description: meta?.description || '',
      scriptCount: scripts.length,
      meta: meta || {},
    });
  }
  groups.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return groups;
}

async function listScripts(root, group) {
  await assertRoot(root);
  const dir = path.join(root, group);
  let ents;
  try {
    ents = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    throw new RepoError('GROUP_NOT_FOUND', `Группа не найдена: ${group}`);
  }
  const scripts = [];
  for (const ent of ents) {
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!SCRIPT_EXTS.includes(ext)) continue;
    const meta = await readJson(path.join(dir, ent.name + META_SUFFIX));
    scripts.push({
      file: ent.name,
      title: meta?.title || ent.name,
      favorite: !!meta?.favorite,
      runOn: meta?.runOn || 'local',
      tags: Array.isArray(meta?.tags) ? meta.tags : [],
      description: meta?.description || '',
      hasMeta: !!meta,
      updatedAt: meta?.updatedAt || null,
    });
  }
  scripts.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title, 'ru'));
  return scripts;
}

function scriptPath(root, group, file) {
  assertSafeName(group);
  assertSafeName(file);
  return path.join(root, group, file);
}

async function readScript(root, group, file) {
  const full = scriptPath(root, group, file);
  const [content, meta, groupMeta] = await Promise.all([
    fs.promises.readFile(full, 'utf8'),
    readJson(full + META_SUFFIX),
    readJson(path.join(root, group, GROUP_FILE)),
  ]);
  return { content, meta: meta || null, groupMeta: groupMeta || {} };
}

async function saveScriptContent(root, group, file, content) {
  const full = scriptPath(root, group, file);
  const tmp = full + '.tmp-' + process.pid;
  await fs.promises.writeFile(tmp, content, { mode: 0o755 });
  await fs.promises.rename(tmp, full);
  // Обновим updatedAt в метаданных, если они есть
  const metaFile = full + META_SUFFIX;
  const meta = await readJson(metaFile);
  if (meta) {
    meta.updatedAt = new Date().toISOString();
    await writeJsonAtomic(metaFile, meta);
  }
}

function assertSafeName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new RepoError('BAD_NAME', 'Пустое имя');
  if (name.length > 120) throw new RepoError('BAD_NAME', 'Слишком длинное имя (максимум 120 символов)');
  if (/[\\/]/.test(name) || name.includes('..') || /[\x00-\x1f]/.test(name)) {
    throw new RepoError('BAD_NAME', `Недопустимое имя: ${name}`);
  }
}

function normalizeScriptName(name) {
  assertSafeName(name);
  const trimmed = name.trim();
  const hasExt = SCRIPT_EXTS.includes(path.extname(trimmed).toLowerCase());
  return hasExt ? trimmed : trimmed + '.sh';
}

async function createScript(root, group, name, meta = {}) {
  await assertRoot(root);
  let file = normalizeScriptName(name);
  const dir = path.join(root, group);
  // Уникальность имени
  for (let i = 2; ; i++) {
    try {
      await fs.promises.access(path.join(dir, file));
      const ext = path.extname(file);
      file = file.slice(0, file.length - ext.length) + `-${i}` + ext;
    } catch {
      break;
    }
  }
  const title = meta.title || file.replace(/\.(sh|bash)$/i, '');
  const now = new Date().toISOString();
  const template = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `# ${title}`,
    '',
    `echo "Запуск: ${title}"`,
    '',
  ].join('\n');
  await fs.promises.writeFile(path.join(dir, file), template, { mode: 0o755 });
  const fullMeta = {
    id: crypto.randomUUID(),
    title,
    description: '',
    tags: [],
    favorite: false,
    runOn: 'local',
    inheritSsh: true,
    ssh: {},
    args: [],
    env: {},
    timeoutSec: 300,
    createdAt: now,
    updatedAt: now,
    ...meta,
  };
  await writeJsonAtomic(path.join(dir, file + META_SUFFIX), fullMeta);
  return { file, meta: fullMeta };
}

async function deleteScript(root, group, file) {
  const full = scriptPath(root, group, file);
  await fs.promises.unlink(full);
  try {
    await fs.promises.unlink(full + META_SUFFIX);
  } catch {
    /* метаданных не было */
  }
}

async function readMeta(root, group, file) {
  return readJson(scriptPath(root, group, file) + META_SUFFIX);
}

async function saveMeta(root, group, file, meta) {
  meta.updatedAt = new Date().toISOString();
  await writeJsonAtomic(scriptPath(root, group, file) + META_SUFFIX, meta);
}

async function readGroupMeta(root, group) {
  return (await readJson(path.join(root, group, GROUP_FILE))) || {};
}

async function saveGroupMeta(root, group, meta) {
  await writeJsonAtomic(path.join(root, group, GROUP_FILE), meta);
}

async function createGroup(root, name) {
  assertSafeName(name);
  const dir = path.join(root, name.trim());
  try {
    await fs.promises.mkdir(dir, { flag: 'wx' });
  } catch {
    throw new RepoError('GROUP_EXISTS', `Группа уже существует: ${name}`);
  }
}

async function deleteGroup(root, name) {
  assertSafeName(name);
  const scripts = await listScripts(root, name);
  if (scripts.length > 0) throw new RepoError('GROUP_NOT_EMPTY', 'Группа не пуста — сначала удалите скрипты');
  await fs.promises.rmdir(path.join(root, name));
}

/** Добавляет служебные пути в .gitignore корня (не дублируя записи). */
async function protectGitignore(root) {
  const file = path.join(root, '.gitignore');
  const wanted = ['# Bash Manager', `${MANAGER_DIR}/runs/`, '*.log'];
  let existing = '';
  try {
    existing = await fs.promises.readFile(file, 'utf8');
  } catch {
    /* файла нет — создадим */
  }
  const lines = new Set(existing.split('\n').map((l) => l.trim()));
  const toAdd = wanted.filter((w) => !lines.has(w));
  if (toAdd.length === 0) return { added: [], file };
  const next = existing ? existing.replace(/\n?$/, '\n') + toAdd.join('\n') + '\n' : toAdd.join('\n') + '\n';
  await fs.promises.writeFile(file, next);
  return { added: toAdd, file };
}

module.exports = {
  GROUP_FILE,
  META_SUFFIX,
  MANAGER_DIR,
  RepoError,
  managerDir,
  vaultFile,
  readJson,
  writeJsonAtomic,
  listGroups,
  listScripts,
  readScript,
  saveScriptContent,
  createScript,
  deleteScript,
  readMeta,
  saveMeta,
  readGroupMeta,
  saveGroupMeta,
  createGroup,
  deleteGroup,
  protectGitignore,
  assertSafeName,
};
