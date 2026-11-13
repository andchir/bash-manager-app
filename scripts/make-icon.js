'use strict';

/**
 * Генерация build/icon.png (512×512, прозрачный фон) для electron-builder.
 * Иконка рисуется SVG и растрируется через скрытое окно Electron.
 * Запуск: npm run make-icon
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#10b981"/>
      <stop offset="1" stop-color="#047857"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#g)"/>
  <rect x="20" y="20" width="472" height="472" rx="108" fill="none" stroke="#6ee7b7" stroke-opacity="0.55" stroke-width="6"/>
  <path d="M150 172 L256 256 L150 340" fill="none" stroke="#ffffff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="278" y1="340" x2="368" y2="340" stroke="#ffffff" stroke-width="44" stroke-linecap="round"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { sandbox: true },
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}</style></head>
<body>${SVG}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.capturePage();
  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'icon.png');
  fs.writeFileSync(out, img.toPNG());
  const size = img.getSize();
  console.log(`Иконка записана: ${out} (${size.width}x${size.height})`);
  app.exit(0);
});
