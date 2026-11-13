'use strict';

/**
 * Preload-мост: единственная точка доступа renderer к main.
 * Ошибки IPC превращаются в исключения с полем code.
 */

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) {
    // ВАЖНО: через contextBridge у объектов Error теряются
    // пользовательские свойства — бросаем plain-объект с code.
    throw { name: 'IpcError', code: res?.error?.code || 'ERROR', message: res?.error?.message || 'Неизвестная ошибка' };
  }
  return res.data;
}

function subscribe(channel) {
  return (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const api = {
  // состояние / настройки
  getState: () => call('app:state'),
  chooseRoot: () => call('app:chooseRoot'),
  setRoot: (dir) => call('app:setRoot', dir),
  updateSettings: (patch) => call('settings:update', patch),
  pickFile: (opts) => call('app:pickFile', opts),

  // хранилище
  vaultSetup: (payload) => call('vault:setup', payload),
  vaultUnlock: (payload) => call('vault:unlock', payload),
  vaultTryAutoUnlock: () => call('vault:tryAutoUnlock'),
  vaultLock: () => call('vault:lock'),
  vaultSetRemember: (payload) => call('vault:setRemember', payload),
  vaultForget: () => call('vault:forget'),
  vaultChangePassword: (payload) => call('vault:changePassword', payload),

  // репозиторий
  listGroups: () => call('repo:listGroups'),
  listScripts: (group) => call('repo:listScripts', group),
  readScript: (payload) => call('repo:readScript', payload),
  saveScript: (payload) => call('repo:saveScript', payload),
  createScript: (payload) => call('repo:createScript', payload),
  deleteScript: (payload) => call('repo:deleteScript', payload),
  saveMeta: (payload) => call('repo:saveMeta', payload),
  readGroupMeta: (group) => call('repo:readGroupMeta', group),
  saveGroupMeta: (payload) => call('repo:saveGroupMeta', payload),
  createGroup: (name) => call('repo:createGroup', name),
  deleteGroup: (name) => call('repo:deleteGroup', name),
  protectGitignore: () => call('repo:protectGitignore'),

  // запуск / история / ssh
  runScript: (payload) => call('run:script', payload),
  killRun: (runId) => call('run:kill', runId),
  listRuns: () => call('runs:list'),
  readRun: (id) => call('runs:read', id),
  sshTest: (payload) => call('ssh:test', payload),

  // события main -> renderer
  onRunOutput: subscribe('run:output'),
  onRunStarted: subscribe('run:started'),
  onRunExit: subscribe('run:exit'),
  onRunHostKeySaved: subscribe('run:hostkey-saved'),
  onVaultLocked: subscribe('vault:locked'),
  onSshHostKey: subscribe('ssh:hostkey'),
  onMenuChooseRoot: subscribe('menu:choose-root'),
  onMenuAbout: subscribe('menu:about'),
  replyHostKey: (id, accepted) => ipcRenderer.send('ssh:hostkey:reply', { id, accepted }),
};

contextBridge.exposeInMainWorld('api', api);
