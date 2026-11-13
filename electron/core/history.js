'use strict';

/** Журнал запусков: <root>/.bash-manager/runs/<id>.json */

const fs = require('fs');
const path = require('path');
const { managerDir } = require('./repo');

function runsDir(root) {
  return path.join(managerDir(root), 'runs');
}

function makeId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}_${Math.random().toString(36).slice(2, 8)}`;
}

async function save(root, entry) {
  const dir = runsDir(root);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const id = makeId();
  await fs.promises.writeFile(
    path.join(dir, id + '.json'),
    JSON.stringify({ id, ...entry }, null, 2),
    { mode: 0o600 },
  );
  return id;
}

async function list(root, limit = 200) {
  const dir = runsDir(root);
  let files;
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf8'));
      out.push({
        id: data.id || f.replace(/\.json$/, ''),
        startedAt: data.startedAt,
        durationMs: data.durationMs,
        code: data.code,
        signal: data.signal || null,
        script: data.script,
        group: data.group,
        target: data.target,
        exitCode: data.code,
      });
    } catch {
      /* пропускаем битые записи */
    }
  }
  out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return out.slice(0, limit);
}

async function read(root, id) {
  const safe = path.basename(id);
  const data = JSON.parse(await fs.promises.readFile(path.join(runsDir(root), safe + '.json'), 'utf8'));
  return data;
}

module.exports = { save, list, read, runsDir };
