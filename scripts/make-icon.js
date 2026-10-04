// Draws the app icon (build/icon.png, 512x512) using Electron itself.
// Run: node_modules\electron\dist\electron.exe scripts/make-icon.js
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a2740"/><stop offset="1" stop-color="#191724"/>
    </linearGradient>
    <linearGradient id="tri" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#c4a7e7"/><stop offset="1" stop-color="#ebbcba"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="110" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="110" fill="none" stroke="#403d52" stroke-width="6"/>
  <path d="M196 140 L196 372 Q196 392 214 382 L384 270 Q400 256 384 242 L214 130 Q196 120 196 140 Z" fill="url(#tri)"/>
  <rect x="64" y="404" width="384" height="14" rx="7" fill="#524f67"/>
  <rect x="64" y="404" width="190" height="14" rx="7" fill="#f6c177"/>
  <circle cx="254" cy="411" r="16" fill="#f6c177"/>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), img.toPNG())
  console.log('icon written', img.getSize())
  app.quit()
})
