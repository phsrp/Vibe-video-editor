// Draws the README banner (docs/banner.png) using Electron itself and the bundled Montserrat font.
// Run: node_modules\electron\dist\electron.exe scripts/make-banner.js
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const font = path.join(__dirname, '..', 'node_modules', '@fontsource-variable', 'montserrat', 'files', 'montserrat-latin-wght-normal.woff2')
const fontUrl = 'file:///' + font.replace(/\\/g, '/')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'M'; src: url('${fontUrl}'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { width: 1600px; height: 820px; background: #191724; font-family: 'M', sans-serif; color: #e0def4; overflow: hidden; position: relative; }
.glow { position: absolute; border-radius: 50%; filter: blur(110px); opacity: .55; }
.g1 { width: 620px; height: 620px; left: -140px; top: -260px; background: #c4a7e7; }
.g2 { width: 560px; height: 560px; right: -120px; top: 120px; background: #eb6f92; opacity: .4; }
.g3 { width: 520px; height: 520px; left: 520px; bottom: -330px; background: #31748f; opacity: .6; }
.wrap { position: relative; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 60px; }
.pill { font-weight: 700; letter-spacing: .32em; font-size: 22px; padding: 10px 26px; border: 2px solid #524f67; border-radius: 40px; color: #c4a7e7; background: rgba(38,35,58,.7); margin-bottom: 26px; }
h1 { font-weight: 900; font-size: 150px; line-height: 1.02; letter-spacing: -.02em; text-transform: uppercase;
     background: linear-gradient(100deg, #c4a7e7 0%, #ebbcba 48%, #f6c177 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sub { margin-top: 34px; font-size: 25px; font-weight: 500; color: #908caa; line-height: 1.5; max-width: 1400px; white-space: nowrap; }
.sub b { color: #e0def4; font-weight: 700; }
</style></head><body>
<div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div>
<div class="wrap">
  <div class="pill">VIBE EDITING SUITE</div>
  <h1>Completely made<br>with AI</h1>
  <div class="sub">Designed, written, tested and packaged by <b>Claude</b> (Anthropic) from plain-English instructions.<br>No human wrote a line of this code.</div>
</div>
</body></html>`

app.whenReady().then(async () => {
  const file = path.join(os.tmpdir(), 'vibe-banner.html')
  fs.writeFileSync(file, html)
  const win = new BrowserWindow({ width: 1600, height: 820, show: false, useContentSize: true, webPreferences: { offscreen: true, webSecurity: false } })
  await win.loadFile(file)
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await new Promise((r) => setTimeout(r, 600))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1600, height: 820 })
  const out = path.join(__dirname, '..', 'docs', 'banner.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, img.toPNG())
  console.log('banner written', img.getSize())
  app.quit()
})
