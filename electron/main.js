const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { execFile } = require('child_process')

// When packaged, binaries live outside the asar archive.
const unpack = (p) => p.replace('app.asar', 'app.asar.unpacked')
const ffmpegPath = unpack(require('ffmpeg-static'))
const ffprobePath = unpack(require('ffprobe-static').path)

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif', '.tif', '.tiff']
const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv', 'mts', 'm2ts', 'mpg', 'mpeg']
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'wma']

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout)
    })
  })
}

async function probe(file) {
  const out = await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  const info = JSON.parse(out)
  const ext = path.extname(file).toLowerCase()
  const video = info.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic))
  const audio = info.streams.filter((s) => s.codec_type === 'audio')
  const isImage = IMAGE_EXT.includes(ext)
  let duration = parseFloat(info.format.duration)
  if (!isFinite(duration)) duration = 5
  const type = isImage ? 'image' : video ? 'video' : audio.length ? 'audio' : null
  return {
    type,
    duration: isImage ? 5 : duration,
    width: video ? video.width : 0,
    height: video ? video.height : 0,
    audioStreams: audio.map((s, i) => ({
      index: s.index,
      n: i,
      codec: s.codec_name,
      channels: s.channels,
      title: (s.tags && (s.tags.title || s.tags.language)) || '',
    })),
  }
}

// Cache for thumbnails and per-stream audio (kept between sessions).
function cacheDir() {
  const dir = path.join(app.getPath('userData'), 'cache')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function makeThumb(file, info, id) {
  if (info.type === 'audio') return null
  const out = path.join(cacheDir(), id + '.jpg')
  if (fs.existsSync(out)) return out
  const seek = info.type === 'video' ? String(Math.min(1, info.duration * 0.1)) : '0'
  try {
    await run(ffmpegPath, ['-y', '-ss', seek, '-i', file, '-frames:v', '1', '-vf', 'scale=-2:120', out])
    return out
  } catch {
    return null
  }
}

// Browsers can only play a video's default audio stream, so every audio stream is extracted to
// its own file. That lets each one be played, muted and mixed on its own track.
// This runs in the background after import. All streams are extracted in ONE pass over the
// file, and AAC audio is copied (no re-encoding), which is much faster than one pass per stream.
const audioPath = (id, n) => path.join(cacheDir(), `${id}_a${n}.m4a`)
const audioJobs = new Map()

function extractAudioFiles(file, id, streams) {
  const outs = streams.map((s) => audioPath(id, s.n))
  if (outs.every((o) => fs.existsSync(o) && fs.statSync(o).size > 0)) return Promise.resolve(outs)
  if (audioJobs.has(id)) return audioJobs.get(id)
  const args = ['-y', '-v', 'error', '-i', file]
  streams.forEach((s, i) => {
    args.push('-map', `0:a:${s.n}`, '-vn', '-sn', '-dn')
    args.push(...(s.codec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']))
    args.push(outs[i])
  })
  const job = run(ffmpegPath, args)
    .then(() => outs.map((o) => (fs.existsSync(o) && fs.statSync(o).size > 0 ? o : null)))
    .catch(() => streams.map(() => null))
    .finally(() => audioJobs.delete(id))
  audioJobs.set(id, job)
  return job
}

ipcMain.handle('media:extractAudio', (_e, { file, id, streams }) => extractAudioFiles(file, id, streams))

async function describeFile(file) {
  const info = await probe(file)
  if (!info.type) throw new Error('Unsupported file: ' + file)
  const st = fs.statSync(file)
  // same file => same id, so importing it twice does not duplicate it
  const id = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 10)
  const thumb = await makeThumb(file, info, id)
  // audio files are filled in later (see extractAudioFiles); null = not ready yet
  const pending = info.type === 'video' && info.audioStreams.length > 0
  const audioFiles = pending ? info.audioStreams.map(() => null) : []
  return { id, path: file, name: path.basename(file), thumb, audioFiles, audioPending: pending, ...info }
}

// Freeze frame: save one exact frame of a video as a PNG and import it as an image.
ipcMain.handle('media:freeze', async (_e, { file, time, label }) => {
  const dir = path.join(app.getPath('userData'), 'freezes')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `freeze_${Date.now()}.png`)
  await run(ffmpegPath, ['-y', '-ss', String(Math.max(0, time)), '-i', file, '-frames:v', '1', out])
  const item = await describeFile(out)
  if (label) item.name = label
  return item
})


ipcMain.handle('media:import', async (_e, kind) => {
  const filters =
    kind === 'audio'
      ? [{ name: 'Audio', extensions: AUDIO_EXT }]
      : [
          { name: 'Videos and images', extensions: [...VIDEO_EXT, ...IMAGE_EXT.map((e) => e.slice(1))] },
          { name: 'All files', extensions: ['*'] },
        ]
  const res = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelect'], filters })
  if (res.canceled) return []
  const items = []
  const errors = []
  for (const f of res.filePaths) {
    try {
      items.push(await describeFile(f))
    } catch (e) {
      errors.push(path.basename(f))
    }
  }
  if (errors.length) dialog.showErrorBox('Could not import', 'These files are not supported:\n' + errors.join('\n'))
  return items
})

ipcMain.handle('media:describe', async (_e, files) => {
  const items = []
  for (const f of files) {
    try {
      items.push(await describeFile(f))
    } catch {}
  }
  return items
})

// User-editable transitions folder.
//  - development: ./transitions in the project
//  - installed app: a "transitions" folder in the user's app-data (it survives updates). The bundled
//    starter pack is copied in; files the user already has are never overwritten, and new
//    starter transitions that come with an update are added.
function transitionsDir() {
  if (!app.isPackaged) return path.join(__dirname, '..', 'transitions')
  const dir = path.join(app.getPath('userData'), 'transitions')
  fs.mkdirSync(dir, { recursive: true })
  try {
    const bundled = path.join(process.resourcesPath, 'transitions')
    for (const f of fs.readdirSync(bundled)) {
      const target = path.join(dir, f)
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(bundled, f), target)
    }
  } catch {}
  return dir
}
ipcMain.handle('transitions:list', () => {
  const dir = transitionsDir()
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.glsl'))
  } catch {}
  return files.sort().map((f) => ({ name: path.basename(f, path.extname(f)), source: fs.readFileSync(path.join(dir, f), 'utf8') }))
})

ipcMain.handle('transitions:openFolder', () => shell.openPath(transitionsDir()))

let mainWindow = null
let dirty = false

function createWindow() {
  const win = (mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#14151a',
    title: 'Vibe Video Editor',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      // Local-only app: lets WebGL read frames from local video/image files.
      webSecurity: false,
    },
  }))
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  if (process.env.VIBE_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })
  if (process.env.VIBE_SELFTEST) runSelfTest(win)
  // warn before closing with unsaved changes (autosave keeps a copy, but still)
  win.on('close', (e) => {
    if (!dirty || process.env.VIBE_SELFTEST) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancel', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
      title: 'Unsaved changes',
      message: 'You have unsaved changes.',
      detail: 'An automatic backup was kept and will be offered next time, but your latest changes may not be in it.',
    })
    if (choice === 0) e.preventDefault()
  })
}

// ---- projects (.json files) and autosave
const autosavePath = () => path.join(app.getPath('userData'), 'autosave.json')

ipcMain.handle('project:save', async (_e, { file, json, defaultName }) => {
  let target = file
  if (!target) {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Save project',
      defaultPath: defaultName || 'My project.json',
      filters: [{ name: 'Video project', extensions: ['json'] }],
    })
    if (r.canceled) return null
    target = r.filePath
  }
  fs.writeFileSync(target, json, 'utf8')
  return target
})

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'Video project', extensions: ['json'] }],
  })
  if (r.canceled) return null
  return { file: r.filePaths[0], json: fs.readFileSync(r.filePaths[0], 'utf8') }
})

// Recovery copies of projects that were never saved: one file per open project tab.
const autosaveDir = () => {
  const d = path.join(app.getPath('userData'), 'autosave')
  fs.mkdirSync(d, { recursive: true })
  return d
}
const safeId = (id) => String(id).replace(/[^a-z0-9_-]/gi, '')
ipcMain.handle('project:autosave', (_e, { id, json }) => fs.writeFileSync(path.join(autosaveDir(), safeId(id) + '.json'), json, 'utf8'))
ipcMain.handle('project:listAutosaves', () =>
  fs
    .readdirSync(autosaveDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ id: f.slice(0, -5), json: fs.readFileSync(path.join(autosaveDir(), f), 'utf8') }))
)
ipcMain.handle('project:clearAutosave', (_e, id) => {
  try {
    if (id) fs.unlinkSync(path.join(autosaveDir(), safeId(id) + '.json'))
    else for (const f of fs.readdirSync(autosaveDir())) fs.unlinkSync(path.join(autosaveDir(), f))
  } catch {}
})
ipcMain.handle('project:read', (_e, file) => ({ file, json: fs.readFileSync(file, 'utf8') }))

// ---- recent projects (shown on the Home page)
const recentPath = () => path.join(app.getPath('userData'), 'recent.json')
const readRecent = () => {
  try {
    return JSON.parse(fs.readFileSync(recentPath(), 'utf8'))
  } catch {
    return []
  }
}
ipcMain.handle('recent:list', () => readRecent().filter((r) => fs.existsSync(r.path)).slice(0, 24))
ipcMain.handle('recent:add', (_e, entry) => {
  const list = readRecent().filter((r) => r.path !== entry.path)
  list.unshift({ ...entry, modified: entry.modified || Date.now() })
  fs.writeFileSync(recentPath(), JSON.stringify(list.slice(0, 50)), 'utf8')
})
ipcMain.handle('recent:remove', (_e, file) => {
  fs.writeFileSync(recentPath(), JSON.stringify(readRecent().filter((r) => r.path !== file)), 'utf8')
})

// ---- settings (kept in the user's app-data)
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const DEFAULT_SETTINGS = { autoUpdate: true }
function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
ipcMain.handle('settings:get', () => readSettings())
ipcMain.handle('settings:set', (_e, patch) => {
  const next = { ...readSettings(), ...patch }
  fs.writeFileSync(settingsPath(), JSON.stringify(next), 'utf8')
  applyUpdateSchedule()
  return next
})
ipcMain.handle('app:setDirty', (_e, v) => {
  dirty = !!v
})
// closing a project tab with unsaved changes: 0 = save, 1 = don't save, 2 = cancel
ipcMain.handle('ui:askSave', (_e, name) =>
  dialog.showMessageBoxSync(mainWindow, {
    type: 'question',
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved changes',
    message: `Save changes to "${name}"?`,
  })
)
ipcMain.handle('app:isTest', () => !!process.env.VIBE_SELFTEST)

require('./exporter').register({ ffmpegPath, getWindow: () => mainWindow })

// ---- updates (installed app only). New versions are published as GitHub Releases.
// Nothing is downloaded until the user says so. With "automatic updates" on (the default) the app
// checks a few seconds after starting and every 4 hours, and asks. "Remind me later" snoozes the
// question for 4 hours. The user can always check by hand.
const SNOOZE_MS = 4 * 60 * 60 * 1000
let updateStatus = { state: 'idle' }
let updater = null
let checkTimer = null
let snoozedUntil = 0
let manualCheck = false

function sendUpdate(s) {
  updateStatus = s
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', s)
}

function runCheck(manual) {
  if (!updater) return sendUpdate({ state: 'dev' })
  manualCheck = !!manual
  updater.checkForUpdates().catch(() => {
    if (manualCheck) sendUpdate({ state: 'error', during: 'check' })
    manualCheck = false
  })
}

// (re)start the schedule according to the setting
function applyUpdateSchedule() {
  if (checkTimer) {
    clearInterval(checkTimer.i)
    clearTimeout(checkTimer.t)
    checkTimer = null
  }
  if (!updater || !readSettings().autoUpdate) return
  checkTimer = { t: setTimeout(() => runCheck(false), 8000), i: setInterval(() => runCheck(false), SNOOZE_MS) }
}

function setupUpdater() {
  if (!app.isPackaged || process.env.VIBE_SELFTEST) return
  const { autoUpdater } = require('electron-updater')
  updater = autoUpdater
  autoUpdater.autoDownload = false // ask first
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => manualCheck && sendUpdate({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => {
    const ask = manualCheck || Date.now() > snoozedUntil
    sendUpdate({ state: ask ? 'available' : 'snoozed', version: i.version, current: app.getVersion() })
    manualCheck = false
  })
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) sendUpdate({ state: 'uptodate' })
    manualCheck = false
  })
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', version: updateStatus.version, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version }))
  autoUpdater.on('error', () => {
    if (updateStatus.state === 'downloading') sendUpdate({ state: 'error', during: 'download' })
    else if (manualCheck) sendUpdate({ state: 'error', during: 'check' })
    manualCheck = false
  })
  applyUpdateSchedule()
}
ipcMain.handle('update:check', () => runCheck(true))
ipcMain.handle('update:download', () => updater && updater.downloadUpdate().catch(() => sendUpdate({ state: 'error', during: 'download' })))
ipcMain.handle('update:snooze', () => {
  snoozedUntil = Date.now() + SNOOZE_MS
  sendUpdate({ state: 'snoozed', version: updateStatus.version, current: app.getVersion() })
})
ipcMain.handle('update:install', () => updater && updater.quitAndInstall())
ipcMain.handle('update:debug', (_e, s) => process.env.VIBE_SELFTEST && sendUpdate(s)) // for the developer self-test
ipcMain.handle('app:version', () => app.getVersion())
app.whenReady().then(setupUpdater)

// Developer self-test: VIBE_SELFTEST=<script.js> VIBE_TEST_FILES=a;b runs the script inside the
// page (with window.__items = imported media), then saves screenshots the script requests.
function runSelfTest(win) {
  win.webContents.once('did-finish-load', async () => {
    const items = []
    for (const f of (process.env.VIBE_TEST_FILES || '').split(';').filter(Boolean)) items.push(await describeFile(f))
    const script = fs.readFileSync(process.env.VIBE_SELFTEST, 'utf8')
    const outDir = path.dirname(process.env.VIBE_SELFTEST)
    await win.webContents.executeJavaScript(`window.__items = ${JSON.stringify(items)};`)
    const steps = await win.webContents.executeJavaScript(`(async()=>{ ${script} })()`)
    for (const s of steps || []) {
      if (s.wait) await new Promise((r) => setTimeout(r, s.wait))
      if (s.js) console.log('JS:', JSON.stringify(await win.webContents.executeJavaScript(s.js)))
      if (s.save) {
        const url = await win.webContents.executeJavaScript(s.dataUrl)
        fs.writeFileSync(path.join(outDir, s.save), Buffer.from(url.split(',')[1], 'base64'))
      }
      if (s.shot) fs.writeFileSync(path.join(outDir, s.shot), (await win.webContents.capturePage()).toPNG())
    }
    app.quit()
  })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
