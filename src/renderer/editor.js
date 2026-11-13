'use strict';

/**
 * Лёгкий редактор Bash: textarea + оверлей с подсветкой + номера строк.
 * Без внешних зависимостей — работает офлайн.
 */

(function () {
  const escHtml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const RX = new RegExp(
    [
      /(#[^\n]*)/.source,                                        // 1 комментарий
      /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/.source, // 2 строки
      /(\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$\$|\$\?|\$!|\$#|\$@|\$\*|\$[0-9])/.source, // 3 переменные
      /\b(if|then|elif|else|fi|for|in|while|until|do|done|case|esac|function|select|time|coproc|return|local|declare|typeset|export|readonly|source|shift|exit|set|unset|echo|printf|read|cd|trap|eval|exec|readarray|mapfile)\b/.source, // 4 ключевые
      /\b([0-9]+)\b/.source,                                     // 5 числа
    ].join('|'),
    'g',
  );

  function highlightBash(src) {
    const lines = String(src).split('\n');
    return lines
      .map((line, idx) => {
        if (idx === 0 && line.startsWith('#!')) {
          return `<span class="tok-shebang">${escHtml(line)}</span>`;
        }
        let html = '';
        let last = 0;
        RX.lastIndex = 0;
        let m;
        while ((m = RX.exec(line)) !== null) {
          html += escHtml(line.slice(last, m.index));
          const cls = m[1] ? 'tok-comment'
            : m[2] ? 'tok-string'
            : m[3] ? 'tok-var'
            : m[4] ? 'tok-keyword'
            : 'tok-number';
          html += `<span class="${cls}">${escHtml(m[0])}</span>`;
          last = m.index + m[0].length;
          if (m[0].length === 0) RX.lastIndex++;
        }
        html += escHtml(line.slice(last));
        return html;
      })
      .join('\n');
  }

  function createBashEditor(opts = {}) {
    const root = document.createElement('div');
    root.className = 'flex flex-1 min-h-0 rounded-xl overflow-hidden border bg-[var(--editor-bg)]';
    root.style.borderColor = 'var(--editor-border)';

    const gutter = document.createElement('pre');
    gutter.className =
      'gutter m-0 py-3 pl-3 pr-2 text-right font-mono overflow-hidden select-none flex-none leading-6';
    gutter.style.color = 'var(--editor-gutter)';

    const wrap = document.createElement('div');
    wrap.className = 'relative flex-1 min-w-0';

    const hl = document.createElement('pre');
    hl.className =
      'hl m-0 absolute inset-0 py-3 px-3 font-mono overflow-hidden whitespace-pre break-words leading-6 pointer-events-none';
    hl.style.color = 'var(--editor-text)';

    const ta = document.createElement('textarea');
    ta.className =
      'editor-area absolute inset-0 w-full h-full py-3 px-3 bg-transparent font-mono text-transparent outline-none resize-none whitespace-pre break-words leading-6 overflow-auto';
    ta.spellcheck = false;
    ta.setAttribute('wrap', 'off');
    ta.autocapitalize = 'off';
    ta.autocomplete = 'off';
    ta.autocorrect = 'off';

    wrap.appendChild(hl);
    wrap.appendChild(ta);
    root.appendChild(gutter);
    root.appendChild(wrap);

    let value = '';
    let fontSize = opts.fontSize || 13;
    let dirty = false;
    let guard = false;

    function paint() {
      const lineCount = value.split('\n').length;
      let nums = '';
      for (let i = 1; i <= lineCount; i++) nums += i + '\n';
      gutter.textContent = nums;
      hl.innerHTML = highlightBash(value) + '\n';
      hl.scrollTop = ta.scrollTop;
      gutter.scrollTop = ta.scrollTop;
      // Критично: одинаковые метрики строк у textarea, подсветки и gutter,
      // иначе курсор и клики не совпадают с видимым текстом.
      const lh = Math.round(fontSize * 1.6) + 'px';
      ta.style.fontSize = fontSize + 'px';
      hl.style.fontSize = fontSize + 'px';
      gutter.style.fontSize = fontSize + 'px';
      ta.style.lineHeight = lh;
      hl.style.lineHeight = lh;
      gutter.style.lineHeight = lh;
    }

    ta.addEventListener('input', () => {
      if (guard) return;
      value = ta.value;
      dirty = true;
      paint();
      opts.onDirty?.(true);
    });

    ta.addEventListener('scroll', () => {
      hl.scrollTop = ta.scrollTop;
      gutter.scrollTop = ta.scrollTop;
    });

    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        opts.onSave?.();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: en } = ta;
        const spaces = '  ';
        ta.value = value.slice(0, s) + spaces + value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + spaces.length;
        ta.dispatchEvent(new Event('input'));
      }
    });

    const api = {
      el: root,
      setValue(v) {
        guard = true;
        value = String(v ?? '');
        ta.value = value;
        dirty = false;
        paint();
        guard = false;
      },
      getValue: () => ta.value,
      setFontSize(px) {
        fontSize = px;
        paint();
      },
      focus: () => ta.focus(),
      isDirty: () => dirty,
      markSaved() {
        dirty = false;
        opts.onDirty?.(false);
      },
      highlight: highlightBash,
    };
    paint();
    return api;
  }

  window.createBashEditor = createBashEditor;
  window.highlightBash = highlightBash;
})();
