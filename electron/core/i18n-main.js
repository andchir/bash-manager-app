'use strict';

/** Локализация main-процесса: меню, системные диалоги. */

const M = {
  en: {
    'menu.file': 'File',
    'menu.chooseRoot': 'Choose scripts folder…',
    'menu.quit': 'Quit',
    'menu.view': 'View',
    'menu.reload': 'Reload',
    'menu.fullscreen': 'Toggle Full Screen',
    'menu.zoom100': 'Zoom 100%',
    'menu.zoomIn': 'Zoom In',
    'menu.zoomOut': 'Zoom Out',
    'menu.devtools': 'Developer Tools',
    'menu.help': 'Help',
    'menu.about': 'About Bash Manager',
    'dialog.chooseRoot': 'Choose the scripts folder',
    'dialog.pickFile': 'Choose file',
    'dialog.sshKey': 'SSH private key',
  },
  ru: {
    'menu.file': 'Файл',
    'menu.chooseRoot': 'Выбрать папку со скриптами…',
    'menu.quit': 'Выход',
    'menu.view': 'Вид',
    'menu.reload': 'Перезагрузить',
    'menu.fullscreen': 'Полноэкранный режим',
    'menu.zoom100': 'Масштаб 100%',
    'menu.zoomIn': 'Увеличить',
    'menu.zoomOut': 'Уменьшить',
    'menu.devtools': 'Инструменты разработчика',
    'menu.help': 'Справка',
    'menu.about': 'О программе',
    'dialog.chooseRoot': 'Выберите папку со скриптами',
    'dialog.pickFile': 'Выберите файл',
    'dialog.sshKey': 'Приватный ключ SSH',
  },
};

/** lang: 'auto' | 'en' | 'ru'; locale — app.getLocale() (например 'ru-RU'). */
function resolveLang(lang, locale) {
  if (lang === 'ru' || lang === 'en') return lang;
  return String(locale || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function mt(lang, key) {
  const table = M[lang] || M.en;
  return table[key] || M.en[key] || key;
}

module.exports = { M, resolveLang, mt };
