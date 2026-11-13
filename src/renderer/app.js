'use strict';

/* global createBashEditor, createAnsiRenderer */

/**
 * Bash Manager — интерфейс приложения (vanilla JS + Tailwind).
 * Все события — через делегирование (data-action), без inline-обработчиков (CSP).
 */

const App = (() => {
  // ------------------------- утилиты -------------------------

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const t = window.t;

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Сообщение об ошибке: перевод по коду, иначе исходный текст из main. */
  const errMsg = (e) => (e && e.code && t('error.' + e.code) !== 'error.' + e.code ? t('error.' + e.code) : (e && e.message) || String(e));

  const pad2 = (n) => String(n).padStart(2, '0');

  const fmtTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return t('time.dateFormat', {
      d: pad2(d.getDate()),
      m: pad2(d.getMonth() + 1),
      y: d.getFullYear(),
      h: pad2(d.getHours()),
      mi: pad2(d.getMinutes()),
      s: pad2(d.getSeconds()),
    });
  };

  const fmtDur = (ms) => {
    if (ms == null) return '—';
    if (ms < 1000) return ms + ' ' + t('time.ms');
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' ' + t('time.sec');
    const m = Math.floor(s / 60);
    return t('time.minSec', { m, s: s % 60 });
  };

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  // ------------------------- иконки -------------------------

  const PATHS = {
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    folderPlus: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    chevLeft: '<polyline points="15 18 9 12 15 6"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  };

  const I = (name, cls = 'w-4 h-4') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;

  // ------------------------- состояние -------------------------

  const S = {
    screen: 'loading',
    locked: false,
    rootDir: null,
    vault: { hasVault: false, unlocked: false, remembered: false, canRemember: false, rootDir: null },
    settings: { theme: 'dark', fontSize: 13, autoLockMin: 10, lastRoot: null, recentRoots: [] },
    version: '',
    groups: [],
    activeGroup: null,
    groupMeta: {},
    scripts: [],
    activeScript: null,
    doc: null, // { content, meta, groupMeta }
    tab: 'editor',
    search: '',
    saving: false,
    run: null, // { runId, target, status, code, startedAt }
    history: [],
    historyFilter: 'script',
  };

  let editor = null;
  let metaDirty = false; // менялась ли форма меты с момента сохранения
  let ansi = null;
  const outputBox = document.createElement('div');
  outputBox.className = 'font-mono text-[13px] leading-5 text-slate-200 whitespace-pre-wrap break-words';
  let runTimer = null;

  // ------------------------- toasts -------------------------

  const TOAST_CLS = {
    success: 'border-brand-500/40 text-[var(--accent)]',
    error: 'border-red-500/40 text-red-200',
    info: 'border-sky-500/40 text-sky-200',
    warn: 'border-amber-500/40 text-amber-200',
  };

  function toast(type, msg, ms = 4200) {
    const el = document.createElement('div');
    el.className = `anim-slide-in pointer-events-auto max-w-sm rounded-xl border bg-[var(--panel2)] px-4 py-3 shadow-2xl text-sm ${TOAST_CLS[type] || TOAST_CLS.info}`;
    el.innerHTML = `<div class="flex items-start gap-2 text-[var(--text)]">${I(type === 'error' ? 'alert' : type === 'success' ? 'check' : type === 'warn' ? 'alert' : 'zap', 'w-4 h-4 mt-0.5 flex-none')}<span>${esc(msg)}</span></div>`;
    $('#toast-root').appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .25s';
      setTimeout(() => el.remove(), 260);
    }, ms);
  }

  function notify(title, body) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    } catch { /* уведомления недоступны */ }
  }

  // ------------------------- модальные окна -------------------------

  function openModal(html, { width = 'max-w-lg', onMount, dismissable = true } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm anim-fade-in';
    wrap.innerHTML = `<div class="anim-pop-in w-full ${width} max-h-[88vh] flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl overflow-hidden">${html}</div>`;
    $('#modal-root').appendChild(wrap);
    const close = () => wrap.remove();
    if (dismissable) {
      wrap.addEventListener('mousedown', (e) => {
        if (e.target === wrap) close();
      });
    }
    onMount?.(wrap.firstElementChild, close);
    return { el: wrap.firstElementChild, close };
  }

  const modalHeader = (title) => `
    <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
      <h3 class="font-semibold text-[var(--text)]">${esc(title)}</h3>
      <button data-action="modal-close" class="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]">${I('x')}</button>
    </div>`;

  function confirmDialog(message, { danger = false, okText = null } = {}) {
    return new Promise((resolve) => {
      const m = openModal(`
        ${modalHeader(t('common.confirm'))}
        <div class="px-5 py-4 text-sm text-[var(--text)]">${message}</div>
        <div class="px-5 py-4 flex justify-end gap-2 border-t border-[var(--border)]">
          <button data-m="cancel" class="px-4 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]">${esc(t('common.cancel'))}</button>
          <button data-m="ok" class="px-4 py-2 rounded-lg text-sm font-medium ${danger ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-brand-600 hover:bg-brand-500 text-white'}">${esc(okText || t('common.confirm'))}</button>
        </div>`, {
        onMount: (el, close) => {
          $('[data-m="cancel"]', el).addEventListener('click', () => { close(); resolve(false); });
          $('[data-m="ok"]', el).addEventListener('click', () => { close(); resolve(true); });
        },
        dismissable: true,
      });
      m.el.parentElement.addEventListener('mousedown', (e) => {
        if (e.target === m.el.parentElement) resolve(false);
      }, { once: true });
    });
  }

  function promptDialog(title, def = '') {
    return new Promise((resolve) => {
      const m = openModal(`
        ${modalHeader(title)}
        <div class="px-5 py-4"><input id="prompt-input" type="text" value="${esc(def)}"
          class="w-full px-3 py-2 rounded-lg bg-[var(--panel2)] border border-[var(--border)] text-[var(--text)] text-sm outline-none focus:border-brand-500" /></div>
        <div class="px-5 py-4 flex justify-end gap-2 border-t border-[var(--border)]">
          <button data-m="cancel" class="px-4 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]">${esc(t('common.cancel'))}</button>
          <button data-m="ok" class="px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white">${esc(t('common.ok'))}</button>
        </div>`, {
        onMount: (el, close) => {
          const input = $('#prompt-input', el);
          input.focus();
          input.select();
          const done = (val) => { close(); resolve(val); };
          $('[data-m="cancel"]', el).addEventListener('click', () => done(null));
          $('[data-m="ok"]', el).addEventListener('click', () => done(input.value.trim() || null));
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') done(input.value.trim() || null);
            if (e.key === 'Escape') done(null);
          });
        },
      });
      m.el.parentElement.addEventListener('mousedown', (e) => {
        if (e.target === m.el.parentElement) resolve(null);
      }, { once: true });
    });
  }

  // ------------------------- тема / режимы окна -------------------------

  function applyTheme() {
    const light = S.settings.theme === 'light';
    document.documentElement.classList.toggle('light', light);
    document.documentElement.classList.toggle('dark', !light);
  }

  // Адаптация при маленьком окне: <680px — одна панель (список/детали)
  function updateLayoutMode() {
    const w = window.innerWidth;
    if (w <= 680) {
      if (!document.body.dataset.pane) {
        document.body.dataset.pane = S.activeScript ? 'detail' : 'list';
      }
    } else {
      delete document.body.dataset.pane;
    }
  }

  // ------------------------- экраны -------------------------

  function setScreen(name) {
    S.screen = name;
    const root = $('#root');
    if (name === 'welcome') {
      root.innerHTML = renderWelcome();
    } else if (name === 'vault-setup') {
      root.innerHTML = renderVaultSetup();
      mountVaultSetup();
    } else if (name === 'main') {
      root.innerHTML = renderShell();
      renderSidebar();
      renderList();
      renderDetail();
    }
  }

  function renderWelcome() {
    const recents = (S.settings.recentRoots || [])
      .map((d) => `
        <button data-action="set-root" data-dir="${esc(d)}" class="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--panel2)] hover:border-brand-500/50 text-left transition-colors">
          ${I('folder', 'w-4 h-4 text-[var(--accent)] flex-none')}
          <span class="truncate text-sm text-[var(--text)]">${esc(d)}</span>
        </button>`).join('');
    return `
      <div class="flex-1 flex items-center justify-center p-8 overflow-auto">
        <div class="w-full max-w-xl anim-fade-in">
          <div class="flex items-center gap-3 mb-2">
            <div class="w-11 h-11 rounded-2xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center text-[var(--accent)]">${I('terminal', 'w-6 h-6')}</div>
            <h1 class="text-3xl font-bold text-[var(--text)]">${esc(t('app.title'))}</h1>
          </div>
          <p class="text-[var(--muted)] mb-8">${esc(t('welcome.subtitle'))}</p>
          <button data-action="choose-root" class="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors">
            ${I('folderPlus')} ${esc(t('welcome.chooseFolder'))}
          </button>
          <p class="mt-3 text-xs text-[var(--muted)]">${esc(t('welcome.hint'))}</p>
          ${recents ? `<div class="mt-8"><div class="text-xs uppercase tracking-wider text-[var(--muted)] mb-2">${esc(t('welcome.recent'))}</div><div class="space-y-2">${recents}</div></div>` : ''}
          <div class="mt-8 grid grid-cols-3 gap-3 text-xs text-[var(--muted)]">
            <div class="rounded-xl border border-[var(--border)] bg-[var(--panel2)] p-3"><div class="text-[var(--accent)] mb-1">${I('edit', 'w-4 h-4')}</div>${esc(t('welcome.featEditor'))}</div>
            <div class="rounded-xl border border-[var(--border)] bg-[var(--panel2)] p-3"><div class="text-[var(--accent)] mb-1">${I('globe', 'w-4 h-4')}</div>${esc(t('welcome.featSsh'))}</div>
            <div class="rounded-xl border border-[var(--border)] bg-[var(--panel2)] p-3"><div class="text-[var(--accent)] mb-1">${I('lock', 'w-4 h-4')}</div>${esc(t('welcome.featCrypto'))}</div>
          </div>
        </div>
      </div>`;
  }

  function strengthBar(pw) {
    const score = window.__pwStrength ? window.__pwStrength(pw) : 0;
    const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500', 'bg-brand-500'];
    const cells = [1, 2, 3, 4].map((i) => `<div class="h-1.5 flex-1 rounded-full ${i <= score ? colors[score] : 'bg-[var(--border)]'}"></div>`).join('');
    return `<div class="flex gap-1 mt-2">${cells}</div><div class="text-xs mt-1 text-[var(--muted)]">${esc(t('vault.strength.' + score))}</div>`;
  }

  function renderVaultSetup() {
    return `
      <div class="flex-1 flex items-center justify-center p-8 overflow-auto">
        <div class="w-full max-w-md anim-fade-in rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-7 shadow-2xl">
          <div class="flex items-center gap-3 mb-1">
            <div class="w-10 h-10 rounded-xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center text-[var(--accent)]">${I('shield', 'w-5 h-5')}</div>
            <h2 class="text-xl font-bold text-[var(--text)]">${esc(t('vault.setupTitle'))}</h2>
          </div>
          <p class="text-sm text-[var(--muted)] mb-6">${esc(t('vault.setupFolder'))} <span class="text-[var(--text)]">${esc(S.rootDir)}</span></p>
          <label class="block text-xs text-[var(--muted)] mb-1">${esc(t('vault.masterPassword'))}</label>
          <input id="vs-pw" type="password" autocomplete="new-password"
            class="w-full px-3 py-2.5 rounded-lg bg-[var(--panel2)] border border-[var(--border)] text-[var(--text)] text-sm outline-none focus:border-brand-500" />
          <div id="vs-strength">${strengthBar('')}</div>
          <label class="block text-xs text-[var(--muted)] mb-1 mt-4">${esc(t('vault.repeatPassword'))}</label>
          <input id="vs-pw2" type="password" autocomplete="new-password"
            class="w-full px-3 py-2.5 rounded-lg bg-[var(--panel2)] border border-[var(--border)] text-[var(--text)] text-sm outline-none focus:border-brand-500" />
          ${S.vault.canRemember ? `
          <label class="flex items-center gap-2 mt-4 text-sm text-[var(--text)] cursor-pointer">
            <input id="vs-remember" type="checkbox" checked />
            ${esc(t('vault.remember'))}
          </label>` : `
          <p class="mt-4 text-xs text-amber-400/90 flex items-center gap-1.5">${I('alert', 'w-3.5 h-3.5')} ${esc(t('vault.rememberUnavailable'))}</p>`}
          <div id="vs-error" class="hidden mt-3 text-sm text-red-400"></div>
          <button id="vs-submit" data-action="vault-setup-submit" class="mt-6 w-full px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors">${esc(t('vault.createVault'))}</button>
          <p class="mt-4 text-xs text-[var(--muted)] leading-relaxed">${esc(t('vault.setupNote'))}</p>
        </div>
      </div>`;
  }

  function mountVaultSetup() {
    const pw = $('#vs-pw');
    pw.addEventListener('input', () => { $('#vs-strength').innerHTML = strengthBar(pw.value); });
    [pw, $('#vs-pw2')].forEach((el) =>
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doVaultSetup();
      }),
    );
  }

  async function doVaultSetup() {
    const pw = $('#vs-pw').value;
    const pw2 = $('#vs-pw2').value;
    const err = $('#vs-error');
    const show = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    if (pw.length < 8) return show(t('vault.tooShort'));
    if (pw !== pw2) return show(t('vault.mismatch'));
    err.classList.add('hidden');
    try {
      const remember = !!$('#vs-remember')?.checked;
      S.vault = await api.vaultSetup({ password: pw, remember });
      toast('success', t('vault.created'));
      await enterMain();
    } catch (e) {
      show(errMsg(e));
    }
  }

  function renderLockOverlay() {
    return `
      <div class="fixed inset-0 z-[60] flex items-center justify-center p-8 bg-black/70 backdrop-blur-sm anim-fade-in">
        <div class="anim-pop-in w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-7 shadow-2xl">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">${I('lock', 'w-5 h-5')}</div>
            <div>
              <h2 class="text-lg font-bold text-[var(--text)]">${esc(t('vault.lockedTitle'))}</h2>
              <p class="text-xs text-[var(--muted)]">${esc(t('vault.lockedHint'))}</p>
            </div>
          </div>
          <input id="ul-pw" type="password" autocomplete="current-password" placeholder="${esc(t('vault.passwordPlaceholder'))}"
            class="w-full px-3 py-2.5 rounded-lg bg-[var(--panel2)] border border-[var(--border)] text-[var(--text)] text-sm outline-none focus:border-brand-500" />
          ${S.vault.canRemember ? `
          <label class="flex items-center gap-2 mt-3 text-sm text-[var(--text)] cursor-pointer">
            <input id="ul-remember" type="checkbox" ${S.vault.remembered ? 'checked' : ''}/>
            ${esc(t('vault.remember'))}
          </label>` : ''}
          <div id="ul-error" class="hidden mt-3 text-sm text-red-400"></div>
          <button data-action="vault-unlock-submit" class="mt-5 w-full px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors flex items-center justify-center gap-2">${I('unlock')} ${esc(t('vault.unlock'))}</button>
          ${S.vault.remembered ? `<button data-action="vault-forget" class="mt-2 w-full px-4 py-2 rounded-xl text-sm text-[var(--muted)] hover:text-red-400 transition-colors">${esc(t('vault.forgetSaved'))}</button>` : ''}
        </div>
      </div>`;
  }

  async function doUnlock() {
    const pw = $('#ul-pw')?.value || '';
    const err = $('#ul-error');
    try {
      const remember = !!$('#ul-remember')?.checked;
      S.vault = await api.vaultUnlock({ password: pw, remember });
      if (remember && S.vault.canRemember) {
        try { await api.vaultSetRemember({ remember: true }); } catch { /* нужен повторный ввод — некритично */ }
      }
      S.locked = false;
      closeLockOverlay();
      toast('success', t('vault.unlocked'));
      if (S.screen === 'main') await reloadDoc();
    } catch (e) {
      if (err) { err.textContent = errMsg(e); err.classList.remove('hidden'); }
    }
  }

  function showLockOverlay() {
    if ($('#lock-overlay')) return;
    const div = document.createElement('div');
    div.id = 'lock-overlay';
    div.innerHTML = renderLockOverlay();
    document.body.appendChild(div);
    $('#ul-pw')?.focus();
  }

  function closeLockOverlay() {
    $('#lock-overlay')?.remove();
  }

  // ------------------------- главный экран -------------------------

  function renderShell() {
    return `
      <header class="h-14 flex-none flex items-center gap-3 px-4 border-b border-[var(--border)] bg-[var(--panel)]">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-lg bg-brand-500/15 border border-brand-500/30 flex items-center justify-center text-[var(--accent)] flex-none">${I('terminal', 'w-4 h-4')}</div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-[var(--text)] leading-tight">${esc(t('app.title'))}</div>
            <div id="hdr-root" class="text-[11px] text-[var(--muted)] truncate max-w-[340px]" title="${esc(S.rootDir || '')}">${esc(S.rootDir || '')}</div>
          </div>
        </div>
        <div class="flex-1"></div>
        <div id="hdr-vault" class="flex items-center"></div>
        <button data-action="theme-toggle" title="${esc(t('header.tooltip.theme'))}" class="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]">${I(S.settings.theme === 'light' ? 'moon' : 'sun')}</button>
        <button data-action="open-settings" title="${esc(t('header.tooltip.settings'))}" class="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]">${I('settings')}</button>
        <button data-action="lock" title="${esc(t('header.tooltip.lock'))}" class="p-2 rounded-lg ${S.vault.unlocked ? 'text-[var(--accent)]' : 'text-[var(--muted)]'} hover:bg-[var(--hover)]">${I(S.vault.unlocked ? 'unlock' : 'lock')}</button>
      </header>
      <div class="flex-1 flex min-h-0">
        <aside id="sidebar" class="w-60 flex-none border-r border-[var(--border)] bg-[var(--panel)] overflow-y-auto"></aside>
        <section id="listpane" class="w-80 flex-none border-r border-[var(--border)] bg-[var(--panel)] flex flex-col min-h-0"></section>
        <main id="detail" class="flex-1 min-w-0 flex flex-col min-h-0 bg-[var(--bg)]"></main>
      </div>`;
    updateLayoutMode();
  }

  function renderVaultBadge() {
    const el = $('#hdr-vault');
    if (!el) return;
    el.innerHTML = S.vault.unlocked
      ? `<span class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-brand-500/10 border border-brand-500/30 text-[var(--accent)]">${I('unlock', 'w-3.5 h-3.5')} ${esc(t('vault.unlockedBadge'))}</span>`
      : `<span class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300">${I('lock', 'w-3.5 h-3.5')} ${esc(t('vault.lockedBadge'))}</span>`;
  }

  function renderSidebar() {
    const el = $('#sidebar');
    if (!el) return;
    const items = S.groups.map((g) => `
      <div data-action="select-group" data-group="${esc(g.name)}"
        class="group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${g.name === S.activeGroup ? 'bg-brand-500/15 text-[var(--accent)] border border-brand-500/30' : 'text-[var(--text)] hover:bg-[var(--hover)] border border-transparent'}">
        ${I('folder', 'w-4 h-4 flex-none ' + (g.name === S.activeGroup ? 'text-[var(--accent)]' : 'text-slate-500'))}
        <span class="truncate flex-1" title="${esc(g.title)} (${g.name})">${esc(g.title)}</span>
        <span class="text-[11px] text-[var(--muted)] flex-none">${g.scriptCount}</span>
        <button data-action="edit-group" data-group="${esc(g.name)}" title="${esc(t('sidebar.editGroup'))}"
          class="hidden group-hover:block p-1 rounded text-[var(--muted)] hover:text-[var(--text)] flex-none">${I('settings', 'w-3.5 h-3.5')}</button>
      </div>`).join('');
    el.innerHTML = `
      <div class="p-3">
        <div class="flex items-center justify-between mb-2 px-1">
          <span class="text-xs uppercase tracking-wider text-[var(--muted)]">${esc(t('sidebar.groups'))}</span>
          <button data-action="new-group" title="${esc(t('sidebar.newGroup'))}" class="p-1 rounded text-[var(--muted)] hover:text-[var(--accent)]">${I('plus', 'w-4 h-4')}</button>
        </div>
        <div class="space-y-0.5">${items || `<div class="px-3 py-6 text-center text-xs text-[var(--muted)]">${t('sidebar.empty')}</div>`}</div>
      </div>`;
  }

  function filteredScripts() {
    const q = S.search.trim().toLowerCase();
    if (!q) return S.scripts;
    return S.scripts.filter((s) =>
      (s.title + ' ' + s.file + ' ' + s.tags.join(' ')).toLowerCase().includes(q),
    );
  }

  function renderList() {
    const el = $('#listpane');
    if (!el) return;
    const scripts = filteredScripts();
    const rows = scripts.map((s) => {
      const remote = s.runOn === 'remote';
      return `
      <div data-action="select-script" data-file="${esc(s.file)}"
        class="group px-3 py-2.5 cursor-pointer border-b border-[var(--border)] transition-colors ${s.file === S.activeScript ? 'bg-brand-500/10 border-l-2 border-l-brand-500' : 'hover:bg-[var(--hover)] border-l-2 border-l-transparent'}">
        <div class="flex items-center gap-2">
          <button data-action="toggle-fav" data-file="${esc(s.file)}" title="${esc(t('list.favorite'))}"
            class="flex-none ${s.favorite ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}">${I('star', 'w-3.5 h-3.5')}</button>
          <span class="truncate text-sm font-medium text-[var(--text)] flex-1" title="${esc(s.file)}">${esc(s.title)}</span>
          <span class="flex-none text-[10px] px-1.5 py-0.5 rounded border ${remote ? 'border-sky-500/30 text-sky-300 bg-sky-500/10' : 'border-slate-600/40 text-slate-400 bg-slate-500/5'}">${remote ? esc(t('list.badgeRemote')) : esc(t('list.badgeLocal'))}</span>
          <button data-action="run-script" data-file="${esc(s.file)}" title="${esc(t('list.runTitle'))}"
            class="flex-none p-1.5 rounded-lg text-[var(--accent)] hover:bg-brand-500/20 opacity-0 group-hover:opacity-100 transition-opacity">${I('play', 'w-3.5 h-3.5')}</button>
          <button data-action="delete-script" data-file="${esc(s.file)}" title="${esc(t('list.deleteTitle'))}"
            class="flex-none p-1.5 rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity">${I('trash', 'w-3.5 h-3.5')}</button>
        </div>
        <div class="flex items-center gap-1.5 mt-1 pl-6">
          <span class="text-[11px] text-[var(--muted)] truncate">${esc(s.file)}</span>
          ${s.tags.map((t) => `<span class="text-[10px] px-1.5 py-px rounded-full bg-[var(--panel2)] border border-[var(--border)] text-[var(--muted)] flex-none">${esc(t)}</span>`).join('')}
        </div>
      </div>`;
    }).join('');
    el.innerHTML = `
      <div class="p-3 border-b border-[var(--border)] space-y-2">
        <div id="group-select-row" class="items-center gap-2">
          <select id="group-select" class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[var(--panel2)] border border-[var(--border)] text-sm text-[var(--text)] outline-none focus:border-brand-500">
            ${S.groups.map((g) => `<option value="${esc(g.name)}" ${g.name === S.activeGroup ? 'selected' : ''}>${esc(g.title)} (${g.scriptCount})</option>`).join('')}
          </select>
          <button data-action="new-group" title="${esc(t('sidebar.newGroup'))}" class="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--accent)] flex-none">${I('plus', 'w-4 h-4')}</button>
          ${S.activeGroup ? `<button data-action="edit-group" data-group="${esc(S.activeGroup)}" title="${esc(t('sidebar.editGroup'))}" class="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] flex-none">${I('settings', 'w-4 h-4')}</button>` : ''}
        </div>
        <div class="flex items-center gap-1">
          <h2 class="text-sm font-semibold text-[var(--text)] truncate" title="${esc(S.activeGroup || '')}">${esc(groupTitle())}</h2>
          ${S.activeGroup ? `
          <button data-action="edit-group" data-group="${esc(S.activeGroup)}" title="${esc(t('sidebar.editGroup'))}"
            class="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]">${I('settings', 'w-3.5 h-3.5')}</button>
          <button data-action="delete-group" data-group="${esc(S.activeGroup)}" title="${esc(t('group.delete'))}"
            class="p-1.5 rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10">${I('trash', 'w-3.5 h-3.5')}</button>
          ` : ''}
        </div>
        <button data-action="new-script" title="${esc(t('list.newScript'))}" class="p-1.5 rounded-lg text-[var(--accent)] hover:bg-brand-500/15">${I('plus', 'w-4 h-4')}</button>
        <div class="relative">
          <span class="absolute left-2.5 top-2 text-[var(--muted)]">${I('search', 'w-3.5 h-3.5')}</span>
          <input id="search" type="text" value="${esc(S.search)}" placeholder="${esc(t('list.searchPlaceholder'))}"
            class="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[var(--panel2)] border border-[var(--border)] text-sm text-[var(--text)] outline-none focus:border-brand-500" />
        </div>
      </div>
      <div class="flex-1 overflow-y-auto">${rows || `<div class="px-4 py-10 text-center text-xs text-[var(--muted)]">${S.search ? esc(t('list.noResults')) : t('list.noScripts')}</div>`}</div>`;
    $('#search')?.addEventListener('input', debounce((e) => { S.search = e.target.value; renderList(); }, 150));
    $('#group-select')?.addEventListener('change', (e) => selectGroup(e.target.value));
  }

  function groupTitle() {
    const g = S.groups.find((x) => x.name === S.activeGroup);
    return g ? g.title : (S.activeGroup || t('list.noGroupTitle'));
  }

  // ------------------------- детальная панель -------------------------

  function renderDetail() {
    const el = $('#detail');
    if (!el) return;
    renderVaultBadge();
    if (!S.activeGroup) {
      el.innerHTML = `<div class="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">${esc(t('detail.selectGroup'))}</div>`;
      return;
    }
    if (!S.activeScript) {
      el.innerHTML = `<div class="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">${esc(t('detail.selectScript'))}</div>`;
      return;
    }
    const meta = S.doc?.meta || {};
    const dirty = !!editor?.isDirty() || metaDirty;
    el.innerHTML = `
      <div class="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--panel)] flex-wrap">
        <button id="btn-back" data-action="back-to-list" title="${esc(t('common.backToList'))}"
          class="items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]">${I('chevLeft', 'w-4 h-4')}</button>
        <span class="text-sm font-semibold text-[var(--text)] truncate" title="${esc(S.activeScript)}">${esc(meta.title || S.activeScript)}</span>
        <span class="text-[11px] text-[var(--muted)] truncate">${esc(S.activeScript)}</span>
        <span id="dirty-dot" class="text-amber-400 text-sm ${dirty ? '' : 'hidden'}">●</span>
        <div class="flex-1"></div>
        <button id="btn-save-script" data-action="save-script" ${S.saving || !dirty ? 'disabled' : ''}
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40">${I('save', 'w-3.5 h-3.5')} ${esc(t('common.save'))}</button>
        ${S.run?.status === 'running'
          ? `<button data-action="kill-run" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600/90 hover:bg-red-500 text-white">${I('square', 'w-3.5 h-3.5')} ${esc(t('common.stop'))}</button>`
          : `<button data-action="run-script" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white">${I('play', 'w-3.5 h-3.5')} ${esc(t('common.run'))}</button>`}
      </div>
      <div class="flex-none flex items-center gap-1 px-4 pt-2 border-b border-[var(--border)] bg-[var(--panel)] flex-wrap">
        ${tabBtn('editor', t('tabs.editor'), 'edit')}
        ${tabBtn('output', t('tabs.output'), 'terminal')}
        ${tabBtn('meta', t('tabs.meta'), 'settings')}
        ${tabBtn('history', t('tabs.history'), 'clock')}
      </div>
      <div id="tab-body" class="flex-1 min-h-0 flex flex-col p-3"></div>`;
    renderTab();
  }

  function tabBtn(id, label, icon) {
    const active = S.tab === id;
    return `
      <button data-action="switch-tab" data-tab="${id}"
        class="flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium border-b-2 transition-colors ${active ? 'text-[var(--accent)] border-brand-500 bg-brand-500/5' : 'text-[var(--muted)] border-transparent hover:text-[var(--text)]'}">
        ${I(icon, 'w-3.5 h-3.5')} ${label}
        ${id === 'output' && S.run?.status === 'running' ? '<span class="w-1.5 h-1.5 rounded-full bg-brand-400 anim-pulse-dot"></span>' : ''}
      </button>`;
  }

  function renderTab() {
    const body = $('#tab-body');
    if (!body) return;
    // уход с вкладки меты пересобирает её форму — несохранённые правки теряются
    if (S.tab !== 'meta' && metaDirty) setMetaDirty(false);
    if (S.tab === 'editor') {
      body.innerHTML = '<div id="editor-slot" class="flex flex-1 min-h-0"></div>';
      $('#editor-slot').appendChild(editor.el);
    } else if (S.tab === 'output') {
      renderOutputTab(body);
    } else if (S.tab === 'meta') {
      body.innerHTML = renderMetaTab();
      mountMetaTab(body);
    } else if (S.tab === 'history') {
      body.innerHTML = renderHistoryTab();
      mountHistoryTab(body);
    }
  }

  // ------------------------- вывод -------------------------

  function renderOutputTab(body) {
    const r = S.run;
    body.innerHTML = `
      <div class="flex-none flex items-center gap-2 mb-2 flex-wrap">
        ${r ? `
          <span class="text-xs px-2 py-1 rounded-lg border ${r.status === 'running' ? 'border-brand-500/40 text-[var(--accent)] bg-brand-500/10' : r.code === 0 ? 'border-brand-500/40 text-[var(--accent)] bg-brand-500/10' : 'border-red-500/40 text-red-300 bg-red-500/10'}">
            ${r.status === 'running' ? esc(t('output.running')) : r.code === 0 ? esc(t('output.success')) : r.code === null ? esc(t('output.stopped')) : esc(t('output.errorCode', { code: r.code }))}
          </span>
          <span class="text-xs text-[var(--muted)]" title="${esc(r.target)}">${esc(t('detail.target'))} ${esc(r.target)}</span>
          <span id="run-elapsed" class="text-xs text-[var(--muted)]">${r.status === 'running' ? '…' : fmtDur(r.durationMs)}</span>
        ` : `<span class="text-xs text-[var(--muted)]">${esc(t('output.notRun'))}</span>`}
        <div class="flex-1"></div>
        <button data-action="clear-output" class="px-2.5 py-1.5 rounded-lg text-xs border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]">${esc(t('output.clear'))}</button>
        <button data-action="copy-output" class="px-2.5 py-1.5 rounded-lg text-xs border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] flex items-center gap-1">${I('copy', 'w-3 h-3')} ${esc(t('output.copy'))}</button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-800 bg-[#0a1120] p-3 output-text" id="output-scroll"></div>`;
    $('#output-scroll').appendChild(outputBox);
  }

  function startRun(runId, target) {
    stopElapsed();
    ansi = createAnsiRenderer();
    outputBox.innerHTML = '';
    S.run = { runId, target, status: 'running', code: null, startedAt: Date.now() };
    S.tab = 'output';
    renderDetail();
    runTimer = setInterval(() => {
      const el = $('#run-elapsed');
      if (el && S.run) el.textContent = fmtDur(Date.now() - S.run.startedAt);
    }, 500);
  }

  function stopElapsed() {
    if (runTimer) clearInterval(runTimer);
    runTimer = null;
  }

  function appendOutput(chunk, isErr) {
    if (!S.run) return;
    const html = ansi.render(chunk);
    outputBox.insertAdjacentHTML('beforeend', html);
    if (outputBox.innerHTML.length > 400000) {
      outputBox.innerHTML = outputBox.innerHTML.slice(-300000);
    }
    const sc = $('#output-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
  }

  // ------------------------- метаданные скрипта -------------------------

  function sshFieldsHtml(ssh = {}, prefix, disabled = false) {
    const isEnc = (v) => typeof v === 'string' && v.startsWith('enc1:');
    const hasLogin = isEnc(ssh.login);
    const hasPw = isEnc(ssh.password);
    const hasPass = isEnc(ssh.passphrase);
    const auth = ssh.auth || (ssh.privateKeyPath ? 'key' : 'password');
    const d = disabled ? 'disabled' : '';
    return `
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="lbl">${esc(t('meta.host'))}</label>
          <input id="${prefix}-host" type="text" value="${esc(ssh.host || '')}" ${d} placeholder="srv.example.com" class="inp" />
        </div>
        <div>
          <label class="lbl">${esc(t('meta.port'))}</label>
          <input id="${prefix}-port" type="number" value="${esc(ssh.port || 22)}" ${d} class="inp" />
        </div>
        <div>
          <label class="lbl">${esc(t('meta.login'))}</label>
          <input id="${prefix}-login" type="text" data-secret="login" value="" ${d}
            placeholder="${hasLogin ? esc(t('meta.savedPlaceholder')) : esc(t('meta.loginPlaceholder'))}" class="inp" autocomplete="off" />
        </div>
        <div>
          <label class="lbl">${esc(t('meta.auth'))}</label>
          <select id="${prefix}-auth" ${d} class="inp">
            <option value="password" ${auth === 'password' ? 'selected' : ''}>${esc(t('meta.authPassword'))}</option>
            <option value="key" ${auth === 'key' ? 'selected' : ''}>${esc(t('meta.authKey'))}</option>
          </select>
        </div>
        <div class="${auth === 'key' ? 'hidden' : ''}" data-auth-block="password">
          <label class="lbl">${esc(t('meta.password'))}</label>
          <input id="${prefix}-password" type="password" data-secret="password" value="" ${d}
            placeholder="${hasPw ? esc(t('meta.savedPlaceholder')) : esc(t('meta.passwordPlaceholder'))}" class="inp" autocomplete="new-password" />
        </div>
        <div class="${auth === 'key' ? '' : 'hidden'}" data-auth-block="key">
          <label class="lbl">${esc(t('meta.privateKey'))}</label>
          <div class="flex gap-2">
            <input id="${prefix}-keypath" type="text" value="${esc(ssh.privateKeyPath || '')}" ${d} placeholder="${esc(t('meta.keyPlaceholder'))}" class="inp flex-1" />
            ${disabled ? '' : `<button data-action="pick-key" data-prefix="${prefix}" title="${esc(t('meta.pickKey'))}" class="px-2.5 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] flex-none">${I('folder', 'w-3.5 h-3.5')}</button>`}
          </div>
        </div>
        <div class="${auth === 'key' ? '' : 'hidden'}" data-auth-block="key">
          <label class="lbl">${esc(t('meta.passphrase'))}</label>
          <input id="${prefix}-passphrase" type="password" data-secret="passphrase" value="" ${d}
            placeholder="${hasPass ? esc(t('meta.savedPlaceholder')) : esc(t('meta.passphrasePlaceholder'))}" class="inp" autocomplete="new-password" />
        </div>
        <div>
          <label class="lbl">${esc(t('meta.hostKey'))}</label>
          <div class="flex items-center gap-2">
            <input id="${prefix}-hostkey" type="text" readonly value="${esc(ssh.hostKey || '')}" placeholder="${esc(t('meta.hostKeyPlaceholder'))}" class="inp flex-1 opacity-70" />
            ${ssh.hostKey && !disabled ? `<button data-action="clear-hostkey" data-prefix="${prefix}" title="${esc(t('meta.clearHostKey'))}" class="px-2 py-2 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-red-400 flex-none">${I('trash', 'w-3.5 h-3.5')}</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  function readSshForm(prefix, prevSsh = {}) {
    const val = (id) => $(`#${prefix}-${id}`)?.value?.trim() ?? '';
    const isEnc = (v) => typeof v === 'string' && v.startsWith('enc1:');
    const secret = (id) => {
      const input = $(`#${prefix}-${id}`);
      if (!input || !input.dataset.touched) return prevSsh[id] && isEnc(prevSsh[id]) ? prevSsh[id] : '';
      return input.value;
    };
    return {
      host: val('host'),
      port: parseInt(val('port'), 10) || 22,
      auth: val('auth'),
      login: secret('login'),
      password: secret('password'),
      privateKeyPath: val('keypath'),
      passphrase: secret('passphrase'),
      hostKey: val('hostkey') || prevSsh.hostKey || '',
    };
  }

  function updateSaveButton() {
    const dirty = !!editor?.isDirty() || metaDirty;
    const btn = $('#btn-save-script');
    if (btn) btn.disabled = S.saving || !dirty;
    const dot = $('#dirty-dot');
    if (dot) dot.classList.toggle('hidden', !dirty);
  }

  function setMetaDirty(d) {
    metaDirty = d;
    updateSaveButton();
  }

  function renderMetaTab() {
    const meta = S.doc?.meta || {};
    const groupMeta = S.doc?.groupMeta || {};
    const ssh = meta.ssh || {};
    const hasGroupSsh = !!groupMeta.ssh && Object.keys(groupMeta.ssh).length > 0;
    const inherit = meta.inheritSsh !== false;
    const args = Array.isArray(meta.args) ? meta.args : [];
    return `
      <div class="flex-1 overflow-y-auto pr-1 pb-6">
        <div class="max-w-3xl space-y-6">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="lbl">${esc(t('meta.title'))}</label>
              <input id="m-title" type="text" value="${esc(meta.title || '')}" class="inp" placeholder="${esc(t('meta.titlePlaceholder'))}" />
            </div>
            <div>
              <label class="lbl">${esc(t('meta.tags'))}</label>
              <input id="m-tags" type="text" value="${esc((meta.tags || []).join(', '))}" class="inp" placeholder="backup, db" />
            </div>
            <div class="col-span-2">
              <label class="lbl">${esc(t('meta.description'))}</label>
              <textarea id="m-desc" rows="2" class="inp resize-none">${esc(meta.description || '')}</textarea>
            </div>
            <div>
              <label class="lbl">${esc(t('meta.runOn'))}</label>
              <select id="m-runon" class="inp">
                <option value="local" ${meta.runOn !== 'remote' ? 'selected' : ''}>${esc(t('meta.runOnLocal'))}</option>
                <option value="remote" ${meta.runOn === 'remote' ? 'selected' : ''}>${esc(t('meta.runOnRemote'))}</option>
              </select>
            </div>
            <div>
              <label class="lbl">${esc(t('meta.timeout'))}</label>
              <input id="m-timeout" type="number" min="0" value="${esc(meta.timeoutSec ?? 300)}" class="inp" />
            </div>
            <label class="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
              <input id="m-favorite" type="checkbox" ${meta.favorite ? 'checked' : ''}/> ${esc(t('meta.favorite'))}
            </label>
          </div>

          <div>
            <div class="flex items-center gap-2 mb-3">
              <h3 class="text-sm font-semibold text-[var(--text)]">${esc(t('meta.sshSection'))}</h3>
              <span class="text-[11px] text-[var(--muted)]">${esc(t('meta.sshHint'))}</span>
            </div>
            <label class="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer mb-3 ${hasGroupSsh ? '' : 'opacity-50 pointer-events-none'}">
              <input id="m-inherit" type="checkbox" ${inherit ? 'checked' : ''}/>
              ${esc(t('meta.inherit'))}${hasGroupSsh ? '' : ' ' + esc(t('meta.inheritNotSet'))}
            </label>
            <div id="m-ssh-wrap" class="${inherit ? 'opacity-40 pointer-events-none' : ''}">
              ${sshFieldsHtml(ssh, 'm')}
            </div>
          </div>

          <div>
            <h3 class="text-sm font-semibold text-[var(--text)] mb-1">${esc(t('meta.env'))}</h3>
            <p class="text-[11px] text-[var(--muted)] mb-2">${esc(t('meta.envHint'))}</p>
            <textarea id="m-env" rows="3" class="inp resize-none font-mono text-xs">${esc(envToText(meta.env))}</textarea>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <div>
                <h3 class="text-sm font-semibold text-[var(--text)]">${esc(t('meta.args'))}</h3>
                <p class="text-[11px] text-[var(--muted)]">${esc(t('meta.argsHint'))}</p>
              </div>
              <button data-action="meta-add-arg" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]">${I('plus', 'w-3 h-3')} ${esc(t('common.add'))}</button>
            </div>
            <div id="m-args" class="space-y-2">${args.map((a, i) => argRowHtml(a, i)).join('') || `<div id="m-args-empty" class="text-xs text-[var(--muted)] py-2">${esc(t('meta.argsEmpty'))}</div>`}</div>
          </div>

          <div class="flex items-center gap-2 pt-2">
            <button data-action="meta-test-ssh" class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]">${I('zap', 'w-3.5 h-3.5')} ${esc(t('meta.testSsh'))}</button>
            <span class="text-[11px] text-[var(--muted)]">${esc(t('meta.testFirst'))}</span>
          </div>
        </div>
      </div>`;
  }

  function argRowHtml(a = {}, i) {
    return `
      <div class="grid grid-cols-12 gap-2 items-center" data-arg-row>
        <input data-arg="flag" value="${esc(a.flag || '')}" placeholder="${esc(t('meta.argFlag'))}" class="inp col-span-3 font-mono text-xs" />
        <input data-arg="label" value="${esc(a.label || '')}" placeholder="${esc(t('meta.argLabel'))}" class="inp col-span-4 text-xs" />
        <input data-arg="default" value="${esc(a.default || '')}" placeholder="${esc(t('meta.argDefault'))}" class="inp col-span-3 text-xs" />
        <label class="col-span-1 flex items-center gap-1 text-[11px] text-[var(--muted)] cursor-pointer" title="${esc(t('meta.argRequiredTitle'))}">
          <input data-arg="required" type="checkbox" ${a.required ? 'checked' : ''}/> ${esc(t('common.requiredShort'))}
        </label>
        <button data-action="meta-del-arg" class="col-span-1 p-1.5 rounded-lg text-[var(--muted)] hover:text-red-400 justify-self-end">${I('trash', 'w-3.5 h-3.5')}</button>
      </div>`;
  }

  function mountMetaTab(body) {
    // вкладка только что пересобрана из S.doc.meta — несохранённых изменений нет
    setMetaDirty(false);
    const onFieldChange = () => setMetaDirty(true);
    body.addEventListener('input', onFieldChange);
    body.addEventListener('change', onFieldChange);
    // переключение типа авторизации
    $('#m-auth', body)?.addEventListener('change', () => toggleAuthBlocks('m'));
    $('#m-inherit', body)?.addEventListener('change', (e) => {
      $('#m-ssh-wrap', body).classList.toggle('opacity-40', e.target.checked);
      $('#m-ssh-wrap', body).classList.toggle('pointer-events-none', e.target.checked);
    });
  }

  function toggleAuthBlocks(prefix) {
    const auth = $(`#${prefix}-auth`)?.value;
    const grid = $(`#${prefix}-host`)?.closest('.grid');
    if (!grid) return;
    $$('[data-auth-block]', grid).forEach((el) => {
      el.classList.toggle('hidden', el.dataset.authBlock !== auth);
    });
  }

  function envToText(env) {
    return Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
  }

  function textToEnv(text) {
    const out = {};
    for (const line of String(text || '').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1);
    }
    return out;
  }

  function collectMetaForm() {
    const cur = S.doc?.meta || {};
    const args = $$('#m-args [data-arg-row]').map((row) => ({
      flag: $('[data-arg="flag"]', row).value.trim(),
      label: $('[data-arg="label"]', row).value.trim(),
      default: $('[data-arg="default"]', row).value,
      required: $('[data-arg="required"]', row).checked,
    })).filter((a) => a.flag);
    const inheritSsh = $('#m-inherit')?.checked !== false;
    return {
      ...cur,
      title: $('#m-title').value.trim(),
      tags: $('#m-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      description: $('#m-desc').value,
      runOn: $('#m-runon').value,
      timeoutSec: Math.max(0, parseInt($('#m-timeout').value, 10) || 0),
      favorite: $('#m-favorite').checked,
      inheritSsh,
      // при наследовании форма скрипта заблокирована — не перезаписываем сохранённый блок
      // пустыми значениями и портом по умолчанию (иначе они затрут настройки группы)
      ssh: inheritSsh ? (cur.ssh || {}) : readSshForm('m', cur.ssh || {}),
      env: textToEnv($('#m-env').value),
      args,
    };
  }

  async function saveMeta(silent = false) {
    try {
      const meta = collectMetaForm();
      await api.saveMeta({ group: S.activeGroup, file: S.activeScript, meta });
      S.doc.meta = meta;
      setMetaDirty(false);
      if (!silent) toast('success', t('meta.saved'));
      await loadScripts();
      renderList();
      renderDetail();
      return true;
    } catch (e) {
      if (e.code === 'LOCKED') {
        toast('warn', t('meta.needMaster'));
        S.locked = true;
        showLockOverlay();
      } else {
        toast('error', errMsg(e));
      }
      return false;
    }
  }

  // ------------------------- история -------------------------

  function renderHistoryTab() {
    const items = filteredHistory();
    const rows = items.map((h) => `
      <tr data-action="history-view" data-id="${esc(h.id)}" class="cursor-pointer hover:bg-[var(--hover)] border-b border-[var(--border)]">
        <td class="px-3 py-2 text-xs text-[var(--text)] whitespace-nowrap">${fmtTime(h.startedAt)}</td>
        <td class="px-3 py-2 text-xs text-[var(--text)]">
          <div class="truncate max-w-[180px]" title="${esc(h.script)}">${esc(h.script)}</div>
          <div class="text-[10px] text-[var(--muted)] truncate max-w-[180px]">${esc(h.group)}</div>
        </td>
        <td class="px-3 py-2 text-xs text-[var(--muted)] truncate max-w-[160px]" title="${esc(h.target)}">${esc(h.target)}</td>
        <td class="px-3 py-2 text-xs whitespace-nowrap">
          <span class="px-1.5 py-0.5 rounded border ${h.code === 0 ? 'text-[var(--accent)] border-brand-500/30 bg-brand-500/10' : 'text-red-300 border-red-500/30 bg-red-500/10'}">
            ${h.code === null ? esc(t('history.codeStopped')) : esc(t('history.codePrefix')) + ' ' + h.code}
          </span>
        </td>
        <td class="px-3 py-2 text-xs text-[var(--muted)] whitespace-nowrap">${fmtDur(h.durationMs)}</td>
        <td class="px-3 py-2"><button data-action="history-view" data-id="${esc(h.id)}" class="p-1 rounded text-[var(--muted)] hover:text-[var(--text)]">${I('eye', 'w-3.5 h-3.5')}</button></td>
      </tr>`).join('');
    return `
      <div class="flex items-center gap-2 mb-3 flex-none">
        <button data-action="history-refresh" class="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]" title="${esc(t('history.refresh'))}">${I('refresh', 'w-4 h-4')}</button>
        <div class="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
          <button data-action="history-filter" data-filter="script" class="px-3 py-1.5 ${S.historyFilter === 'script' ? 'bg-brand-500/15 text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}">${esc(t('history.thisScript'))}</button>
          <button data-action="history-filter" data-filter="all" class="px-3 py-1.5 ${S.historyFilter === 'all' ? 'bg-brand-500/15 text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}">${esc(t('history.all'))}</button>
        </div>
        <span class="text-xs text-[var(--muted)]">${esc(t('history.entries', { n: items.length }))}</span>
      </div>
      <div class="flex-1 overflow-y-auto rounded-xl border border-[var(--border)]">
        <table class="w-full">
          <thead class="sticky top-0 bg-[var(--panel)] border-b border-[var(--border)]">
            <tr>
              <th class="text-left px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">${esc(t('history.colTime'))}</th>
              <th class="text-left px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">${esc(t('history.colScript'))}</th>
              <th class="text-left px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">${esc(t('history.colTarget'))}</th>
              <th class="text-left px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">${esc(t('history.colStatus'))}</th>
              <th class="text-left px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">${esc(t('history.colDuration'))}</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6" class="px-4 py-10 text-center text-xs text-[var(--muted)]">${esc(t('history.empty'))}</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  function filteredHistory() {
    if (S.historyFilter === 'script' && S.activeScript) {
      return S.history.filter((h) => h.script === S.activeScript && h.group === S.activeGroup);
    }
    return S.history;
  }

  async function loadHistory() {
    try {
      S.history = await api.listRuns();
    } catch { /* игнорируем */ }
  }

  function mountHistoryTab() {
    loadHistory().then(() => {
      if (S.tab === 'history') {
        const body = $('#tab-body');
        if (body) { body.innerHTML = renderHistoryTab(); }
      }
    });
  }

  async function viewRun(id) {
    try {
      const run = await api.readRun(id);
      const r2 = createAnsiRenderer();
      openModal(`
        ${modalHeader(t('history.runTitle', { script: run.script }))}
        <div class="px-5 py-3 text-xs text-[var(--muted)] flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--border)]">
          <span>${fmtTime(run.startedAt)}</span><span>${esc(t('history.target'))} ${esc(run.target)}</span>
          <span>${esc(t('history.exitCode'))} ${run.code === null ? esc(t('history.codeStopped')) : run.code}</span><span>${esc(t('history.duration'))} ${fmtDur(run.durationMs)}</span>
          ${run.truncated ? `<span class="text-amber-400">${esc(t('output.truncated'))}</span>` : ''}
        </div>
        <div class="px-5 py-3 overflow-auto flex-1">
          <pre class="font-mono text-[12px] leading-5 text-slate-200 whitespace-pre-wrap break-words bg-[#0a1120] border border-slate-800 rounded-xl p-3 m-0 output-text">${r2.render(run.output || t('history.emptyOutput'))}</pre>
        </div>`, { width: 'max-w-3xl' });
    } catch (e) {
      toast('error', errMsg(e));
    }
  }

  // ------------------------- модалки создания/групп -------------------------

  async function newScriptModal() {
    if (!S.activeGroup) return toast('warn', t('detail.selectGroup'));
    const m = openModal(`
      ${modalHeader(t('newScript.title'))}
      <div class="px-5 py-4 space-y-3">
        <div>
          <label class="lbl">${esc(t('newScript.filename'))}</label>
          <input id="ns-name" type="text" value="" placeholder="${esc(t('newScript.filenamePlaceholder'))}" class="inp" />
          <p class="text-[11px] text-[var(--muted)] mt-1">${esc(t('newScript.filenameHint'))}</p>
        </div>
        <div>
          <label class="lbl">${esc(t('newScript.displayName'))}</label>
          <input id="ns-title" type="text" value="" placeholder="${esc(t('newScript.displayPlaceholder'))}" class="inp" />
        </div>
        <div>
          <label class="lbl">${esc(t('meta.runOn'))}</label>
          <select id="ns-runon" class="inp">
            <option value="local">${esc(t('meta.runOnLocal'))}</option>
            <option value="remote">${esc(t('meta.runOnRemote'))}</option>
          </select>
        </div>
        <div id="ns-error" class="hidden text-sm text-red-400"></div>
      </div>
      <div class="px-5 py-4 flex justify-end gap-2 border-t border-[var(--border)]">
        <button data-m="cancel" class="px-4 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]">${esc(t('common.cancel'))}</button>
        <button data-m="ok" class="px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white flex items-center gap-1.5">${I('plus', 'w-3.5 h-3.5')} ${esc(t('common.create'))}</button>
      </div>`, {
      onMount: (el, close) => {
        const nameInput = $('#ns-name', el);
        nameInput.focus();
        $('[data-m="cancel"]', el).addEventListener('click', close);
        $('[data-m="ok"]', el).addEventListener('click', async () => {
          const name = nameInput.value.trim();
          const err = $('#ns-error', el);
          if (!name) { err.textContent = t('newScript.nameRequired'); err.classList.remove('hidden'); return; }
          try {
            const { file, meta } = await api.createScript({
              group: S.activeGroup,
              name,
              meta: { title: $('#ns-title', el).value.trim() || undefined, runOn: $('#ns-runon', el).value },
            });
            close();
            toast('success', t('newScript.created', { file }));
            await loadScripts();
            await selectScript(file);
          } catch (e) {
            err.textContent = errMsg(e);
            err.classList.remove('hidden');
          }
        });
      },
    });
    return m;
  }

  async function editGroupModal(groupName) {
    const gm = await api.readGroupMeta(groupName).catch(() => ({}));
    const g = S.groups.find((x) => x.name === groupName);
    openModal(`
      ${modalHeader(t('group.title', { name: g?.title || groupName }))}
      <div class="px-5 py-4 overflow-y-auto space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="lbl">${esc(t('group.folder'))}</label>
            <input id="g-folder" type="text" value="${esc(groupName)}" class="inp font-mono text-xs" />
            <p class="text-[10px] text-[var(--muted)] mt-1">${esc(t('group.folderHint'))}</p>
          </div>
          <div>
            <label class="lbl">${esc(t('group.name'))}</label>
            <input id="g-title" type="text" value="${esc(gm.title || g?.title || '')}" class="inp" />
          </div>
          <div class="col-span-2">
            <label class="lbl">${esc(t('group.description'))}</label>
            <input id="g-desc" type="text" value="${esc(gm.description || '')}" class="inp" />
          </div>
        </div>
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-sm font-semibold text-[var(--text)]">${esc(t('group.sshDefaults'))}</h3>
            <span class="text-[11px] text-[var(--muted)]">${esc(t('group.sshDefaultsHint'))}</span>
          </div>
          ${sshFieldsHtml(gm.ssh || {}, 'g')}
        </div>
        <div>
          <label class="lbl">${esc(t('group.env'))}</label>
          <textarea id="g-env" rows="3" class="inp resize-none font-mono text-xs">${esc(envToText(gm.env))}</textarea>
        </div>
        <div id="g-error" class="hidden text-sm text-red-400"></div>
      </div>
      <div class="px-5 py-4 flex justify-between gap-2 border-t border-[var(--border)]">
        <button data-m="delete" class="px-3 py-2 rounded-lg text-sm text-red-400 border border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5">${I('trash', 'w-3.5 h-3.5')} ${esc(t('group.delete'))}</button>
        <div class="flex gap-2">
          <button data-m="cancel" class="px-4 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]">${esc(t('common.cancel'))}</button>
          <button data-m="ok" class="px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white">${esc(t('common.save'))}</button>
        </div>
      </div>`, {
      width: 'max-w-2xl',
      onMount: (el, close) => {
        $('#g-auth', el)?.addEventListener('change', () => toggleAuthBlocks('g'));
        $('[data-m="cancel"]', el).addEventListener('click', close);
        $('[data-m="delete"]', el).addEventListener('click', async () => {
          close();
          const okDel = await confirmDialog(esc(t('group.deleteConfirm', { name: groupName })), { danger: true, okText: t('common.delete') });
          if (!okDel) return;
          try {
            await api.deleteGroup(groupName);
            toast('success', t('group.deleted'));
            if (S.activeGroup === groupName) { S.activeGroup = null; S.activeScript = null; S.doc = null; }
            await loadGroups();
          } catch (e) {
            toast('error', errMsg(e));
          }
        });
        $('[data-m="ok"]', el).addEventListener('click', async () => {
          const newName = $('#g-folder', el).value.trim() || groupName;
          const meta = {
            ...gm,
            title: $('#g-title', el).value.trim() || newName,
            description: $('#g-desc', el).value.trim(),
            ssh: readSshForm('g', gm.ssh || {}),
            env: textToEnv($('#g-env', el).value),
          };
          try {
            // сначала мета под старым именем, потом переименование —
            // при ошибке имени папка группы остаётся на месте
            await api.saveGroupMeta({ group: groupName, meta });
            let renamed = false;
            if (newName !== groupName) {
              await api.renameGroup({ group: groupName, newName });
              if (S.activeGroup === groupName) S.activeGroup = newName;
              renamed = true;
            }
            close();
            toast('success', t(renamed ? 'group.renamed' : 'group.saved'));
            await loadGroups(true);
          } catch (e) {
            if (e.code === 'LOCKED') {
              close();
              S.locked = true;
              showLockOverlay();
            } else {
              const err = $('#g-error', el);
              err.textContent = e.message;
              err.classList.remove('hidden');
            }
          }
        });
      },
    });
  }

  // ------------------------- аргументы перед запуском -------------------------

  function collectArgsModal(meta, onRun) {
    const args = Array.isArray(meta.args) ? meta.args : [];
    if (args.length === 0) return onRun({ argv: [], env: {} });
    const rows = args.map((a) => `
      <div>
        <label class="lbl">${esc(a.label || a.flag)} <span class="text-[var(--muted)]">${esc(a.flag)}${a.required ? ' *' : ''}</span></label>
        <input data-run-arg="${esc(a.flag)}" data-required="${a.required ? 1 : 0}" type="text" value="${esc(a.default || '')}" class="inp" />
      </div>`).join('');
    openModal(`
      ${modalHeader(t('args.title'))}
      <div class="px-5 py-4 overflow-y-auto space-y-3">
        ${rows}
        <div>
          <label class="lbl">${esc(t('args.extra'))}</label>
          <input id="ra-extra" type="text" class="inp font-mono text-xs" placeholder="${esc(t('args.extraPlaceholder'))}" />
        </div>
        <div>
          <label class="lbl">${esc(t('args.envOverride'))}</label>
          <textarea id="ra-env" rows="2" class="inp resize-none font-mono text-xs"></textarea>
        </div>
        <div id="ra-error" class="hidden text-sm text-red-400"></div>
      </div>
      <div class="px-5 py-4 flex justify-end gap-2 border-t border-[var(--border)]">
        <button data-m="cancel" class="px-4 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]">${esc(t('common.cancel'))}</button>
        <button data-m="ok" class="px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white flex items-center gap-1.5">${I('play', 'w-3.5 h-3.5')} ${esc(t('common.run'))}</button>
      </div>`, {
      onMount: (el, close) => {
        $('[data-m="cancel"]', el).addEventListener('click', close);
        $('[data-m="ok"]', el).addEventListener('click', () => {
          const argv = [];
          let missing = null;
          $$('[data-run-arg]', el).forEach((input) => {
            const v = input.value.trim();
            if (!v && input.dataset.required === '1') missing = input.dataset.runArg;
            if (v) argv.push(input.dataset.runArg, v);
          });
          if (missing) {
            const err = $('#ra-error', el);
            err.textContent = t('args.requiredMissing', { flag: missing });
            err.classList.remove('hidden');
            return;
          }
          const extra = $('#ra-extra', el).value.trim();
          if (extra) argv.push(...extra.split(/\s+/));
          const env = textToEnv($('#ra-env', el).value);
          close();
          onRun({ argv, env });
        });
      },
    });
  }

  // ------------------------- запуск -------------------------

  async function runScript(fileArg) {
    const file = fileArg || S.activeScript;
    if (!file) return;
    if (S.run?.status === 'running') {
      toast('warn', t('run.waitFinish'));
      return;
    }
    if (file !== S.activeScript) await selectScript(file);
    if (editor?.isDirty() || metaDirty) {
      const okSave = await saveAll();
      if (!okSave) return;
    }
    const meta = S.doc?.meta || {};
    if (meta.runOn === 'remote' && !S.vault.unlocked) {
      toast('warn', t('run.needMasterRemote'));
      S.locked = true;
      showLockOverlay();
      return;
    }
    collectArgsModal(meta, async ({ argv, env }) => {
      try {
        const { runId, target } = await api.runScript({ group: S.activeGroup, file, args: argv, env });
        startRun(runId, target);
      } catch (e) {
        if (e.code === 'LOCKED') {
          S.locked = true;
          showLockOverlay();
        } else if (e.code === 'NO_SSH') {
          toast('error', errMsg(e));
          S.tab = 'meta';
          renderDetail();
        } else {
          toast('error', errMsg(e));
        }
      }
    });
  }

  // ------------------------- настройки -------------------------

  function settingsModal() {
    const st = S.settings;
    openModal(`
      ${modalHeader(t('settings.title'))}
      <div class="px-5 py-4 overflow-y-auto space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="lbl">${esc(t('settings.language'))}</label>
            <select id="st-lang" class="inp">
              <option value="auto" ${st.lang !== 'en' && st.lang !== 'ru' ? 'selected' : ''}>${esc(t('settings.langAuto'))}</option>
              <option value="en" ${st.lang === 'en' ? 'selected' : ''}>${esc(t('settings.langEn'))}</option>
              <option value="ru" ${st.lang === 'ru' ? 'selected' : ''}>${esc(t('settings.langRu'))}</option>
            </select>
          </div>
          <div>
            <label class="lbl">${esc(t('settings.theme'))}</label>
            <select id="st-theme" class="inp">
              <option value="dark" ${st.theme !== 'light' ? 'selected' : ''}>${esc(t('settings.themeDark'))}</option>
              <option value="light" ${st.theme === 'light' ? 'selected' : ''}>${esc(t('settings.themeLight'))}</option>
            </select>
          </div>
          <div>
            <label class="lbl">${esc(t('settings.fontSize'))}</label>
            <input id="st-font" type="number" min="10" max="24" value="${esc(st.fontSize)}" class="inp" />
          </div>
          <div>
            <label class="lbl">${esc(t('settings.autoLock'))}</label>
            <input id="st-autolock" type="number" min="0" max="240" value="${esc(st.autoLockMin)}" class="inp" />
          </div>
        </div>
        <div>
          <label class="lbl">${esc(t('settings.rootFolder'))}</label>
          <div class="flex gap-2">
            <input type="text" readonly value="${esc(S.rootDir || '')}" class="inp flex-1 opacity-70" />
            <button data-m="root" class="px-3 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] text-sm flex-none">${esc(t('settings.changeRoot'))}</button>
          </div>
        </div>
        <div class="rounded-xl border border-[var(--border)] p-3 space-y-2">
          <div class="text-sm font-semibold text-[var(--text)] flex items-center gap-2">${I('shield', 'w-4 h-4 text-[var(--accent)]')} ${esc(t('settings.security'))}</div>
          <button data-m="gitignore" class="w-full px-3 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)] text-left">${esc(t('settings.gitignore'))}</button>
          ${S.vault.hasVault ? `
          <div class="grid grid-cols-3 gap-2">
            <input id="st-oldpw" type="password" placeholder="${esc(t('settings.currentPassword'))}" class="inp" autocomplete="current-password" />
            <input id="st-newpw" type="password" placeholder="${esc(t('settings.newPassword'))}" class="inp" autocomplete="new-password" />
            <button data-m="changepw" class="px-3 py-2 rounded-lg text-sm bg-[var(--panel2)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover)]">${esc(t('settings.changePassword'))}</button>
          </div>
          <p class="text-[11px] text-[var(--muted)]">${esc(t('settings.changePasswordNote'))}</p>
          <button data-m="forget" class="text-xs text-[var(--muted)] hover:text-red-400">${esc(t('settings.forgetSaved'))}</button>
          ` : ''}
        </div>
        <div id="st-msg" class="hidden text-sm"></div>
      </div>
      <div class="px-5 py-4 flex justify-end border-t border-[var(--border)]">
        <button data-m="ok" class="px-5 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white">${esc(t('settings.done'))}</button>
      </div>`, {
      width: 'max-w-2xl',
      onMount: (el, close) => {
        const msg = (text, ok) => {
          const m = $('#st-msg', el);
          m.textContent = text;
          m.className = `text-sm ${ok ? 'text-[var(--accent)]' : 'text-red-400'}`;
        };
        $('[data-m="ok"]', el).addEventListener('click', async () => {
          const prevLocale = window.getLocale();
          await api.updateSettings({
            lang: $('#st-lang', el).value,
            theme: $('#st-theme', el).value,
            fontSize: Math.min(24, Math.max(10, parseInt($('#st-font', el).value, 10) || 13)),
            autoLockMin: Math.max(0, parseInt($('#st-autolock', el).value, 10) || 0),
          });
          await refreshState();
          close();
          rerenderAfterLocaleChange(prevLocale);
        });
        $('[data-m="root"]', el).addEventListener('click', async () => {
          close();
          await chooseRoot();
        });
        $('[data-m="gitignore"]', el).addEventListener('click', async () => {
          try {
            const res = await api.protectGitignore();
            msg(res.added.length ? t('settings.gitignoreAdded', { list: res.added.join(', ') }) : t('settings.gitignoreProtected'), true);
          } catch (e) { msg(errMsg(e), false); }
        });
        $('[data-m="changepw"]', el)?.addEventListener('click', async () => {
          try {
            const res = await api.vaultChangePassword({
              oldPassword: $('#st-oldpw', el).value,
              newPassword: $('#st-newpw', el).value,
            });
            msg(t('settings.pwChanged', { n: res.reencrypted }), true);
            $('#st-oldpw', el).value = '';
            $('#st-newpw', el).value = '';
          } catch (e) { msg(errMsg(e), false); }
        });
        $('[data-m="forget"]', el)?.addEventListener('click', async () => {
          try {
            S.vault = await api.vaultForget();
            msg(t('settings.forgotDone'), true);
          } catch (e) { msg(errMsg(e), false); }
        });
      },
    });
  }

  /** Полное обновление интерфейса после смены языка. */
  function rerenderAfterLocaleChange(prevLocale) {
    if (prevLocale === window.getLocale()) return;
    $('#modal-root').innerHTML = '';
    closeLockOverlay();
    if (S.screen === 'main') {
      setScreen('main');
      renderSidebar();
      renderList();
      renderDetail();
      if (S.locked) showLockOverlay();
    } else {
      setScreen(S.screen);
    }
  }

  function aboutModal() {
    openModal(`
      ${modalHeader(t('about.title'))}
      <div class="px-5 py-4 text-sm text-[var(--text)] space-y-2">
        <p>${esc(t('about.line1', { version: S.version }))}</p>
        <p class="text-[var(--muted)]">${esc(t('about.stack'))}</p>
        <p class="text-[var(--muted)] text-xs leading-relaxed">${esc(t('about.security'))}</p>
      </div>`);
  }

  // ------------------------- данные -------------------------

  async function refreshState() {
    const st = await api.getState();
    S.rootDir = st.vault.rootDir || S.rootDir;
    S.vault = st.vault;
    S.settings = { ...S.settings, ...st.settings };
    S.version = st.version;
    if (st.locale && window.getLocale() !== st.locale) setLocale(st.locale);
    applyTheme();
  }

  async function loadGroups(keepActive = false) {
    S.groups = await api.listGroups();
    if (!keepActive && S.activeGroup && !S.groups.some((g) => g.name === S.activeGroup)) {
      S.activeGroup = null;
      S.activeScript = null;
      S.doc = null;
    }
    if (!S.activeGroup && S.groups.length > 0) {
      S.activeGroup = S.groups[0].name;
    }
    await loadGroupMeta();
    await loadScripts();
    renderSidebar();
    renderList();
    renderDetail();
  }

  async function loadGroupMeta() {
    if (!S.activeGroup) { S.groupMeta = {}; return; }
    S.groupMeta = await api.readGroupMeta(S.activeGroup).catch(() => ({}));
  }

  async function loadScripts() {
    if (!S.activeGroup) { S.scripts = []; return; }
    S.scripts = await api.listScripts(S.activeGroup);
  }

  async function selectScript(file) {
    if (!file) return;
    S.activeScript = file;
    await reloadDoc();
    S.tab = S.tab || 'editor';
    if (window.innerWidth <= 680) document.body.dataset.pane = 'detail';
    renderList();
    renderDetail();
  }

  async function reloadDoc() {
    if (!S.activeGroup || !S.activeScript) return;
    const doc = await api.readScript({ group: S.activeGroup, file: S.activeScript });
    S.doc = doc;
    editor.setValue(doc.content);
    editor.setFontSize(S.settings.fontSize);
    editor.markSaved();
  }

  async function saveAll() {
    if (S.saving) return false;
    let saved = false;
    let ok = true;
    if (editor?.isDirty()) { ok = (await saveScript(true)) && ok; saved = true; }
    if (S.tab === 'meta' && metaDirty) { ok = (await saveMeta(true)) && ok; saved = true; }
    if (saved && ok) toast('success', t('detail.scriptSaved'));
    return ok;
  }

  async function saveScript(silent = false) {
    if (!S.activeScript || S.saving || !editor?.isDirty()) return false;
    S.saving = true;
    try {
      await api.saveScript({ group: S.activeGroup, file: S.activeScript, content: editor.getValue() });
      editor.markSaved();
      $('#dirty-dot')?.classList.add('hidden');
      await loadScripts();
      if (!silent) toast('success', t('detail.scriptSaved'));
      return true;
    } catch (e) {
      toast('error', e.message);
      return false;
    } finally {
      S.saving = false;
    }
  }

  async function chooseRoot() {
    try {
      const res = await api.chooseRoot();
      if (res.canceled) return;
      await refreshState();
      S.activeGroup = null;
      S.activeScript = null;
      S.doc = null;
      await enterScreen();
    } catch (e) {
      toast('error', e.message);
    }
  }

  async function enterMain() {
    setScreen('main');
    renderVaultBadge();
    if (!editor) {
      editor = createBashEditor({
        fontSize: S.settings.fontSize,
        onSave: () => saveAll(),
        onDirty: () => updateSaveButton(),
      });
    }
    await loadGroups();
    await loadHistory();
  }

  async function enterScreen() {
    if (!S.rootDir) {
      setScreen('welcome');
    } else if (!S.vault.hasVault) {
      setScreen('vault-setup');
    } else {
      await enterMain();
      if (!S.vault.unlocked) {
        S.locked = true;
        showLockOverlay();
      }
    }
  }

  // ------------------------- глобальные события -------------------------

  function bindEvents() {
    document.addEventListener('click', async (e) => {
      const modalClose = e.target.closest('[data-action="modal-close"]');
      if (modalClose) {
        modalClose.closest('.fixed')?.remove();
        return;
      }
      const tgt = e.target.closest('[data-action]');
      if (!tgt) return;
      const a = tgt.dataset.action;
      const d = tgt.dataset;

      if (a === 'choose-root') return chooseRoot();
      if (a === 'set-root') {
        try {
          await api.setRoot(d.dir);
          await refreshState();
          S.activeGroup = null; S.activeScript = null; S.doc = null;
          await enterScreen();
        } catch (err) { toast('error', err.message); }
        return;
      }
      if (a === 'theme-toggle') {
        S.settings.theme = S.settings.theme === 'light' ? 'dark' : 'light';
        await api.updateSettings({ theme: S.settings.theme });
        applyTheme();
        renderDetail();
        return;
      }
      if (a === 'open-settings') return settingsModal();
      if (a === 'vault-setup-submit') return doVaultSetup();
      if (a === 'vault-unlock-submit') return doUnlock();
      if (a === 'vault-forget') {
        S.vault = await api.vaultForget();
        toast('info', t('settings.forgotDone'));
        return;
      }
      if (a === 'lock') {
        if (S.vault.unlocked) {
          await api.vaultLock();
          S.vault.unlocked = false;
          S.locked = true;
          showLockOverlay();
          renderVaultBadge();
        } else {
          S.locked = true;
          showLockOverlay();
        }
        return;
      }
      if (a === 'select-group') return selectGroup(d.group);
      if (a === 'new-group') {
        const name = await promptDialog(t('sidebar.newGroup'), '');
        if (!name) return;
        try {
          const res = await api.createGroup(name);
          await loadGroups();
          S.activeGroup = res?.name || name.trim();
          await loadGroupMeta();
          await loadScripts();
          renderSidebar(); renderList(); renderDetail();
        } catch (err) { toast('error', err.message); }
        return;
      }
      if (a === 'edit-group') { e.stopPropagation(); return editGroupModal(d.group); }
      if (a === 'delete-group') {
        e.stopPropagation();
        const okDel = await confirmDialog(esc(t('group.deleteConfirm', { name: d.group })), { danger: true, okText: t('common.delete') });
        if (!okDel) return;
        try {
          await api.deleteGroup(d.group);
          toast('success', t('group.deleted'));
          if (S.activeGroup === d.group) { S.activeGroup = null; S.activeScript = null; S.doc = null; }
          await loadGroups();
        } catch (err) { toast('error', errMsg(err)); }
        return;
      }
      if (a === 'new-script') return newScriptModal();
      if (a === 'select-script') return selectScript(d.file);
      if (a === 'toggle-fav') {
        e.stopPropagation();
        const s = S.scripts.find((x) => x.file === d.file);
        if (s) {
          try {
            const full = await api.readScript({ group: S.activeGroup, file: d.file });
            const m = full.meta || { title: s.title };
            m.favorite = !s.favorite;
            await api.saveMeta({ group: S.activeGroup, file: d.file, meta: m });
            if (S.activeScript === d.file && S.doc) S.doc.meta = m;
            await loadScripts();
            renderList();
          } catch (err) { toast('error', err.message); }
        }
        return;
      }
      if (a === 'delete-script') {
        e.stopPropagation();
        const okDel = await confirmDialog(esc(t('confirm.deleteScript', { file: d.file })), { danger: true, okText: t('common.delete') });
        if (!okDel) return;
        try {
          await api.deleteScript({ group: S.activeGroup, file: d.file });
          if (S.activeScript === d.file) { S.activeScript = null; S.doc = null; }
          await loadScripts();
          renderList(); renderDetail();
          toast('success', t('detail.scriptDeleted'));
        } catch (err) { toast('error', errMsg(err)); }
        return;
      }
      if (a === 'save-script') return saveAll();
      if (a === 'run-script') { e.stopPropagation(); return runScript(d.file); }
      if (a === 'kill-run') { if (S.run) api.killRun(S.run.runId).catch(() => {}); return; }
      if (a === 'switch-tab') { S.tab = d.tab; renderDetail(); return; }
      if (a === 'back-to-list') { document.body.dataset.pane = 'list'; return; }
      if (a === 'clear-output') { outputBox.innerHTML = ''; return; }
      if (a === 'copy-output') {
        navigator.clipboard?.writeText(outputBox.textContent || '').then(
          () => toast('success', t('output.copied')),
          () => toast('error', t('output.copyFailed')),
        );
        return;
      }
      if (a === 'meta-add-arg') {
        $('#m-args-empty')?.remove();
        $('#m-args').insertAdjacentHTML('beforeend', argRowHtml({}, Date.now()));
        setMetaDirty(true);
        return;
      }
      if (a === 'meta-del-arg') { tgt.closest('[data-arg-row]')?.remove(); setMetaDirty(true); return; }
      if (a === 'meta-test-ssh') return testSshFromForm();
      if (a === 'pick-key') {
        const f = await api.pickFile({});
        if (f) {
          $(`#${d.prefix}-keypath`).value = f;
          if (d.prefix === 'm') setMetaDirty(true);
        }
        return;
      }
      if (a === 'clear-hostkey') {
        const input = $(`#${d.prefix}-hostkey`);
        if (input) {
          input.value = '';
          if (d.prefix === 'm') setMetaDirty(true);
        }
        return;
      }
      if (a === 'history-refresh') { await loadHistory(); renderTab(); return; }
      if (a === 'history-filter') { S.historyFilter = d.filter; renderTab(); return; }
      if (a === 'history-view') { e.stopPropagation(); return viewRun(d.id); }
    });

    // отслеживание «тронутых» секретных полей
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-secret]');
      if (el) el.dataset.touched = '1';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'ul-pw') doUnlock();
    });
    window.addEventListener('resize', debounce(updateLayoutMode, 120));

    api.onRunOutput((p) => {
      if (S.run && p.runId === S.run.runId) appendOutput(p.chunk, p.isErr);
    });
    api.onRunStarted((p) => {
      if (S.run && p.runId === S.run.runId && S.tab === 'output') renderDetail();
    });
    api.onRunExit((p) => {
      if (!S.run || p.runId !== S.run.runId) return;
      S.run.status = 'done';
      S.run.code = p.code;
      S.run.durationMs = p.durationMs;
      stopElapsed();
      renderDetail();
      loadHistory();
      if (p.code === 0) {
        toast('success', t('run.finishedOk', { dur: fmtDur(p.durationMs) }));
        notify(t('app.title'), t('run.notifyOk'));
      } else if (p.code === null) {
        toast('warn', t('run.stoppedToast'));
      } else {
        toast('error', t('run.finishedErr', { code: p.code }));
        notify(t('app.title'), t('run.notifyErr', { code: p.code }));
      }
    });
    api.onVaultLocked(() => {
      S.vault.unlocked = false;
      S.locked = true;
      showLockOverlay();
      renderVaultBadge();
      toast('info', t('vault.locked'));
    });
    api.onSshHostKey((info) => {
      openModal(`
        ${modalHeader(t('hostkey.title'))}
        <div class="px-5 py-4 text-sm text-[var(--text)] space-y-3">
          <p>${t('hostkey.unknown', { host: esc(info.host), port: esc(String(info.port)) })}</p>
          <div class="rounded-xl bg-[#0a1120] border border-slate-700 p-3 font-mono text-xs text-sky-300 break-all">${esc(info.fingerprint)}</div>
          <p class="text-xs text-[var(--muted)]">${t('hostkey.verifyHint', { cmd: t('hostkey.cmdExample') })}</p>
        </div>
        <div class="px-5 py-4 flex justify-end gap-2 border-t border-[var(--border)]">
          <button data-m="no" class="px-4 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--muted)] hover:text-red-400">${esc(t('hostkey.reject'))}</button>
          <button data-m="yes" class="px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white">${esc(t('hostkey.trust'))}</button>
        </div>`, {
        dismissable: false,
        onMount: (el, close) => {
          $('[data-m="no"]', el).addEventListener('click', () => { api.replyHostKey(info.id, false); close(); });
          $('[data-m="yes"]', el).addEventListener('click', () => { api.replyHostKey(info.id, true); close(); });
        },
      });
    });
    api.onMenuChooseRoot(() => chooseRoot());
    api.onMenuAbout(() => aboutModal());

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  async function selectGroup(name) {
    if (S.activeGroup === name) return;
    if (editor?.isDirty() || metaDirty) {
      const okSave = await confirmDialog(t('confirm.saveEditor'), { okText: t('common.save') });
      if (okSave) await saveAll();
    }
    S.activeGroup = name;
    S.activeScript = null;
    S.doc = null;
    S.search = '';
    if (window.innerWidth <= 680) document.body.dataset.pane = 'list';
    await loadGroupMeta();
    await loadScripts();
    renderSidebar();
    renderList();
    renderDetail();
  }

  async function testSshFromForm() {
    if (!S.vault.unlocked) {
      S.locked = true;
      showLockOverlay();
      return toast('warn', t('error.LOCKED'));
    }
    const cur = S.doc?.meta || {};
    const inherit = $('#m-inherit')?.checked !== false;
    // при наследовании тестируем SSH-доступ группы (форма скрипта заблокирована)
    const ssh = inherit
      ? { ...(S.doc?.groupMeta?.ssh || {}) }
      : readSshForm('m', cur.ssh || {});
    if (!ssh.host) return toast('warn', t('sshTest.noHost'));
    try {
      toast('info', t('sshTest.testing'), 1500);
      const res = await api.sshTest({ ssh });
      if (res.ok) {
        toast('success', t('sshTest.ok', { dur: fmtDur(res.ms) }));
        if (res.newHostKey) {
          const input = $('#m-hostkey');
          if (input) input.value = res.newHostKey;
          setMetaDirty(true);
          toast('info', t('sshTest.hostKeyObtained'), 6000);
        }
      } else {
        toast('error', t('sshTest.fail', { error: res.error || (t('history.codePrefix') + ' ' + res.exitCode) }));
      }
    } catch (e) {
      toast('error', e.message);
    }
  }

  // ------------------------- старт -------------------------

  async function boot() {
    if (!window.api) {
      document.body.innerHTML = '<div style="padding:2rem;color:#f87171;font-family:sans-serif">Не удалось инициализировать API (preload не загружен).</div>';
      return;
    }
    bindEvents();
    try {
      await refreshState();
      if (S.vault.hasVault && !S.vault.unlocked) {
        await api.vaultTryAutoUnlock().catch(() => null);
        await refreshState();
      }
    } catch (e) {
      toast('error', e.message);
    }
    await enterScreen();
  }

  // оценка стойкости пароля (дублирует логику main для мгновенного отклика UI)
  window.__pwStrength = (pw) => {
    const s = String(pw || '');
    if (!s) return 0;
    let score = 0;
    if (s.length >= 8) score++;
    if (s.length >= 12) score++;
    if (/[a-zа-яё]/.test(s) && /[A-ZА-ЯЁ]/.test(s)) score++;
    if (/\d/.test(s)) score++;
    if (/[^a-zA-Zа-яА-ЯёЁ0-9\s]/.test(s)) score++;
    return Math.min(4, score);
  };

  document.addEventListener('DOMContentLoaded', boot);

  return { boot };
})();

window.App = App;
