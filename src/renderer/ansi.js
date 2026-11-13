'use strict';

/**
 * Потоковый конвертер ANSI/SGR → HTML.
 * Состояние стиля сохраняется между кусками вывода.
 */

function createAnsiRenderer() {
  const st = { fg: null, bold: false, dim: false, under: false };
  let openCls = null;

  const escHtml = (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c);

  function cls() {
    const parts = [];
    if (st.fg !== null) parts.push('ansi-fg-' + st.fg);
    if (st.bold) parts.push('ansi-bold');
    if (st.dim) parts.push('ansi-dim');
    if (st.under) parts.push('ansi-underline');
    return parts.join(' ');
  }

  function apply(params) {
    const nums = params === '' ? [0] : params.split(';').map((p) => parseInt(p, 10) || 0);
    for (const n of nums) {
      if (n === 0) { st.fg = null; st.bold = false; st.dim = false; st.under = false; }
      else if (n === 1) st.bold = true;
      else if (n === 2) st.dim = true;
      else if (n === 4) st.under = true;
      else if (n === 22) st.bold = false;
      else if (n === 24) st.under = false;
      else if (n === 39) st.fg = null;
      else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) st.fg = n;
      // остальные (фоны, яркость и пр.) игнорируем — безопасно для отображения
    }
  }

  /** @returns html-строка для вставки в контейнер с white-space: pre-wrap */
  function render(chunk) {
    let out = '';
    let i = 0;
    const s = String(chunk);
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\x1b' && s[i + 1] === '[') {
        const m = /^\x1b\[([0-9;]*)m/.exec(s.slice(i));
        if (m) { apply(m[1]); i += m[0].length; continue; }
        const m2 = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(s.slice(i));
        if (m2) { i += m2[0].length; continue; }
      }
      if (ch === '\r') { i++; continue; } // прогресс-бары перезаписывают строку
      const c = cls();
      if (c !== openCls) {
        if (openCls) out += '</span>';
        if (c) out += `<span class="${c}">`;
        openCls = c;
      }
      out += ch === '\n' ? '\n' : escHtml(ch);
      i++;
    }
    return out;
  }

  return { render };
}
