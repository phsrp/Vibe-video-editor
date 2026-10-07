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

// Reversed copy of a clip's range, for playing a clip backwards (preview and export). ffmpeg's "reverse" filter
// keeps every frame it reverses in memory, so the range is cut into short chunks which are reversed one by
// one and joined in reverse order. quality 'preview' makes a small fast copy; 'export' keeps full quality.
const reverseJobs = new Map()
ipcMain.handle('media:reverse', (_e, { file, from, to, quality }) => {
  const crypto = require('crypto')
  let mt = 0
  try {
    mt = fs.statSync(file).mtimeMs
  } catch {}
  const key = crypto.createHash('sha1').update([file, mt, from.toFixed(3), to.toFixed(3), quality || 'preview'].join('|')).digest('hex').slice(0, 16)
  const dir = path.join(app.getPath('userData'), 'reverse')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, key + '.mp4')
  if (fs.existsSync(out)) return out
  if (reverseJobs.has(key)) return reverseJobs.get(key)
  const job = (async () => {
    const CH = quality === 'export' ? 2 : 3
    const n = Math.max(1, Math.ceil((to - from) / CH))
    const parts = []
    const preview = quality !== 'export'
    for (let i = n - 1; i >= 0; i--) {
      const s = from + i * CH
      const d = Math.min(CH, to - s)
      if (d <= 0.001) continue
      const part = path.join(dir, `${key}_${i}.mp4`)
      const vf = preview ? "reverse,scale=-2:'min(540,ih)'" : 'reverse'
      await run(ffmpegPath, ['-y', '-v', 'error', '-ss', String(s), '-t', String(d), '-i', file, '-an', '-vf', vf, '-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'fast', '-crf', preview ? '27' : '14', '-pix_fmt', 'yuv420p', part])
      parts.push(part)
    }
    const list = path.join(dir, key + '.txt')
    fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'))
    const tmpOut = out + '.part.mp4'
    await run(ffmpegPath, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', tmpOut])
    fs.renameSync(tmpOut, out)
    for (const p of parts) fs.rmSync(p, { force: true })
    fs.rmSync(list, { force: true })
    return out
  })()
  reverseJobs.set(key, job)
  job.finally(() => reverseJobs.delete(key))
  return job
})
// Waveform: loudness of an audio file, 200 values per second (0-255), for drawing on the timeline
const peaksCache = new Map()
ipcMain.handle('media:peaks', (_e, file) => {
  if (peaksCache.has(file)) return peaksCache.get(file)
  const p = new Promise((resolve) => {
    const RATE = 8000
    const PER = RATE / 200
    const { spawn } = require('child_process')
    const proc = spawn(ffmpegPath, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { windowsHide: true })
    const out = []
    let carry = Buffer.alloc(0)
    let peak = 0
    let n = 0
    proc.stdout.on('data', (chunk) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
      const usable = buf.length - (buf.length % 2)
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i))
        if (v > peak) peak = v
        if (++n === PER) {
          out.push(Math.min(255, Math.round((peak / 32768) * 255 * 1.5)))
          peak = 0
          n = 0
        }
      }
      carry = buf.subarray(usable)
    })
    proc.on('error', () => resolve(new Uint8Array(0)))
    proc.on('close', () => resolve(Uint8Array.from(out)))
  })
  peaksCache.set(file, p)
  return p
})
// How loud an audio file (or a part of it) is: integrated loudness in LUFS (what streaming services measure)
ipcMain.handle('audio:loudness', (_e, { file, stream, from, to }) =>
  new Promise((resolve) => {
    const args = ['-hide_banner', '-nostats', '-ss', String(Math.max(0, from || 0))]
    if (to > from) args.push('-t', String(to - from))
    args.push('-i', file, '-map', `0:a:${stream || 0}`, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-')
    execFile(ffmpegPath, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const m = /"input_i"\s*:\s*"(-?[\d.]+|-inf)"/.exec(String(stderr))
      const lufs = m ? parseFloat(m[1]) : null
      resolve({ lufs: Number.isFinite(lufs) ? lufs : null })
    })
  })
)
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
      : kind === 'image'
      ? [{ name: 'Pictures', extensions: IMAGE_EXT.map((e) => e.slice(1)) }]
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
    title: 'Vibe Editing Suite',
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

// The Documents folders were called "Vibe Video Editor ..." before the rename. Rename them once, in place.
// If that is not possible (folder open somewhere, new one already exists) the old folder keeps being used.
const FOLDER_RENAMES = [
  ['Vibe Video Editor Projects', 'Vibe Editing Suite Projects'],
  ['Vibe Video Editor Library', 'Vibe Editing Suite Library'],
]
const folderRenamed = new Set()
const docFolder = (idx) => {
  const [oldName, newName] = FOLDER_RENAMES[idx]
  const docs = app.getPath('documents')
  const oldP = path.join(docs, oldName)
  const newP = path.join(docs, newName)
  if (!folderRenamed.has(idx) && fs.existsSync(oldP) && !fs.existsSync(newP)) {
    try {
      fs.renameSync(oldP, newP)
      folderRenamed.add(idx)
    } catch {
      return oldP
    }
  }
  return fs.existsSync(oldP) && !fs.existsSync(newP) ? oldP : newP
}
// project files and recent lists remember full paths: point them at the renamed folders
const fixOldPaths = (text) =>
  FOLDER_RENAMES.reduce((t, [o, n], i) => (path.basename(docFolder(i)) === n ? t.split(o).join(n) : t), text)

// Where projects are saved unless you pick somewhere else: Documents > Vibe Editing Suite Projects
const projectsDir = () => {
  const d = docFolder(0)
  try {
    fs.mkdirSync(d, { recursive: true })
  } catch {}
  return d
}
ipcMain.handle('projects:folder', () => shell.openPath(projectsDir()))

// The library: videos, images and sounds you use again and again (an intro, a logo, music, sound effects).
// They live in Documents > Vibe Editing Suite Library and show up in the Library panel of the editor.
const libraryDir = () => {
  const d = docFolder(1)
  try {
    fs.mkdirSync(d, { recursive: true })
  } catch {}
  return d
}
ipcMain.handle('library:folder', () => shell.openPath(libraryDir()))
ipcMain.handle('library:list', () => {
  const ok = new Set([...IMAGE_EXT, ...VIDEO_EXT.map((e) => '.' + e), ...AUDIO_EXT.map((e) => '.' + e)])
  const out = []
  const walk = (dir, depth) => {
    let names = []
    try {
      names = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const n of names) {
      const p = path.join(dir, n.name)
      if (n.isDirectory()) {
        if (depth < 2) walk(p, depth + 1)
      } else if (ok.has(path.extname(n.name).toLowerCase())) out.push({ path: p, name: n.name })
    }
  }
  walk(libraryDir(), 0)
  return out.sort((x, y) => x.name.localeCompare(y.name))
})
// Delete a file from the library: it goes to the Recycle Bin (only files inside the library folder are allowed)
ipcMain.handle('library:delete', async (_e, file) => {
  try {
    const dir = path.resolve(libraryDir()) + path.sep
    const p = path.resolve(String(file))
    if (!p.startsWith(dir) || !fs.existsSync(p)) return false
    await shell.trashItem(p)
    return true
  } catch {
    return false
  }
})
// "Add files...": pick files and copy them into the library
ipcMain.handle('library:add', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Add to your library',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos, images and audio', extensions: [...VIDEO_EXT, ...IMAGE_EXT.map((e) => e.slice(1)), ...AUDIO_EXT] }],
  })
  if (r.canceled) return 0
  const dir = libraryDir()
  let n = 0
  for (const src of r.filePaths) {
    const ext = path.extname(src)
    const base = path.basename(src, ext)
    let dest = path.join(dir, base + ext)
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base} (${i})${ext}`)
    try {
      fs.copyFileSync(src, dest)
      n++
    } catch {}
  }
  return n
})

ipcMain.handle('project:save', async (_e, { file, json, defaultName }) => {
  let target = file
  if (!target) {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Save project',
      defaultPath: path.join(projectsDir(), defaultName || 'My project.json'),
      filters: [{ name: 'Vibe Editing Suite project', extensions: ['json'] }],
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
    defaultPath: projectsDir(),
    properties: ['openFile'],
    filters: [{ name: 'Vibe Editing Suite project', extensions: ['json'] }],
  })
  if (r.canceled) return null
  return { file: r.filePaths[0], json: fs.readFileSync(r.filePaths[0], 'utf8') }
})

// The image editor: save the finished picture (bytes from the page) where the user picks, and small thumbnails for Recent projects
ipcMain.handle('image:save', async (_e, { data, name, ext }) => {
  let target = process.env.VIBE_TEST_OUT
  if (!target) {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Save the picture',
      defaultPath: path.join(app.getPath('pictures') || projectsDir(), (name || 'My picture') + '.' + ext),
      filters: [{ name: ext.toUpperCase() + ' picture', extensions: [ext] }],
    })
    if (r.canceled) return null
    target = r.filePath
  }
  fs.writeFileSync(target, Buffer.from(data))
  return target
})
ipcMain.handle('thumb:save', (_e, { key, data, replace }) => {
  const dir = path.join(app.getPath('userData'), 'thumbs')
  fs.mkdirSync(dir, { recursive: true })
  if (replace && path.resolve(replace).startsWith(path.resolve(dir))) fs.rmSync(replace, { force: true }) // the earlier thumbnail of this project
  const file = path.join(dir, require('crypto').createHash('sha1').update(String(key)).digest('hex').slice(0, 16) + '-' + Date.now().toString(36) + '.png')
  fs.writeFileSync(file, Buffer.from(data))
  return file
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
    .map((f) => ({ id: f.slice(0, -5), json: fixOldPaths(fs.readFileSync(path.join(autosaveDir(), f), 'utf8')) }))
)
ipcMain.handle('project:clearAutosave', (_e, id) => {
  try {
    if (id) fs.unlinkSync(path.join(autosaveDir(), safeId(id) + '.json'))
    else for (const f of fs.readdirSync(autosaveDir())) fs.unlinkSync(path.join(autosaveDir(), f))
  } catch {}
})
ipcMain.handle('project:read', (_e, file) => ({ file, json: fixOldPaths(fs.readFileSync(file, 'utf8')) }))

// ---- recent projects (shown on the Home page)
const recentPath = () => path.join(app.getPath('userData'), 'recent.json')
const readRecent = () => {
  try {
    return JSON.parse(fixOldPaths(fs.readFileSync(recentPath(), 'utf8')))
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

// GitHub release notes arrive as HTML (or text, or a list): boil them down to short bullet lines
function notesToList(n) {
  let text = ''
  if (Array.isArray(n)) text = n.map((x) => (x && x.note) || '').join('\n')
  else if (typeof n === 'string') text = n
  const items = []
  const lis = text.match(/<li[^>]*>[\s\S]*?<\/li>/gi)
  if (lis) lis.forEach((l) => items.push(l))
  else text.split(/\r?\n/).forEach((l) => /^\s*[-*]\s+/.test(l) && items.push(l.replace(/^\s*[-*]\s+/, '')))
  return items
    .map((s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12)
}

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
  // only once, right as the editor opens (a short wait lets the window finish loading to show the popup)
  checkTimer = { t: setTimeout(() => runCheck(false), 2000), i: null }
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
    sendUpdate({ state: ask ? 'available' : 'snoozed', version: i.version, current: app.getVersion(), notes: notesToList(i.releaseNotes) })
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
  sendUpdate({ state: 'snoozed', version: updateStatus.version, current: app.getVersion(), notes: updateStatus.notes })
})
ipcMain.handle('update:install', () => updater && updater.quitAndInstall())
ipcMain.handle('update:debug', (_e, s) => process.env.VIBE_SELFTEST && sendUpdate(s)) // for the developer self-test
ipcMain.handle('app:version', () => app.getVersion())
// The AI model for the smart mask and tracking: SAM 2.1 Small (Meta, Apache-2.0), run on the graphics card (WebGPU).
// It is not part of the installer: it is downloaded once, on request, from Hugging Face into the app's data folder.
const SAM2_URL = 'https://huggingface.co/diffusionstudio/sam2.1-small-video-onnx-fp16/resolve/927ecec6e6ae2727d0af7720eefdb07f2efe4689/'
const MODEL_FILES = [
  { name: 'sam2/constants.json', url: SAM2_URL + 'constants.json', size: 9820, sha256: '09397F7251C159B64A2D581CC3EA0DBB3CF720C2E60777CB14E244405ED1C305' },
  { name: 'sam2/vision_encoder.onnx', url: SAM2_URL + 'onnx/vision_encoder.onnx', size: 83679474, sha256: 'FB570036F5AFAC59EF20848958B075C84DA746E333EFD863104D94604652EFC4' },
  { name: 'sam2/mask_decoder.onnx', url: SAM2_URL + 'onnx/mask_decoder.onnx', size: 8910345, sha256: '999B3B47BF2E924D522ED6CC011FA2C9B651754CC07895EB0DA16A28A5CE7C4D' },
  { name: 'sam2/memory_encoder.onnx', url: SAM2_URL + 'onnx/memory_encoder.onnx', size: 2807884, sha256: 'F36324E383DBF21FCD549169AEDF698DB00C307FD9A49538C0E5F0AA168E4F99' },
  { name: 'sam2/memory_attention.onnx', url: SAM2_URL + 'onnx/memory_attention.onnx', size: 16175204, sha256: '6666BE8CA502B5C16E9A113D3D3934996D32F27E93BEE5E66A8317FCCEEC9985' },
  { name: 'sam2/pointer_tpos.onnx', url: SAM2_URL + 'onnx/pointer_tpos.onnx', size: 34228, sha256: 'F9C1B36E0AA9DC6B7C05B02A8FDAA17CC671D967FFCACC14FCD3177E65EC25E9' },
]
const modelsDir = () => {
  const d = path.join(app.getPath('userData'), 'models')
  fs.mkdirSync(d, { recursive: true })
  return d
}
const modelReady = (m) => {
  try {
    return fs.statSync(path.join(modelsDir(), m.name)).size === m.size
  } catch {
    return false
  }
}
function modelStatus() {
  const mdir = modelsDir()
  // the earlier, smaller model (MobileSAM) is not used any more: its files are removed
  for (const old of ['mobile_sam_image_encoder.onnx', 'sam_mask_decoder_single.onnx']) fs.rmSync(path.join(mdir, old), { force: true })
  const p = (n) => path.join(mdir, n)
  return {
    ready: MODEL_FILES.every(modelReady),
    totalBytes: MODEL_FILES.reduce((a, m) => a + m.size, 0),
    paths: { constants: p('sam2/constants.json'), visionEncoder: p('sam2/vision_encoder.onnx'), maskDecoder: p('sam2/mask_decoder.onnx'), memoryEncoder: p('sam2/memory_encoder.onnx'), memoryAttention: p('sam2/memory_attention.onnx'), pointerTpos: p('sam2/pointer_tpos.onnx') },
  }
}
function downloadFile(url, dest, onBytes, redirects = 0) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    https
      .get(url, { headers: { 'User-Agent': 'VibeVideoEditor' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 6) {
          res.resume()
          return downloadFile(new URL(res.headers.location, url).href, dest, onBytes, redirects + 1).then(resolve, reject)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error('The download failed (HTTP ' + res.statusCode + ').'))
        }
        const out = fs.createWriteStream(dest)
        res.on('data', (c) => onBytes(c.length))
        res.pipe(out)
        out.on('finish', () => out.close(resolve))
        out.on('error', reject)
        res.on('error', reject)
      })
      .on('error', reject)
  })
}
let modelJob = null
ipcMain.handle('models:status', () => modelStatus())
ipcMain.handle('models:download', async () => {
  if (modelJob) return modelJob
  const FILES = MODEL_FILES
  modelJob = (async () => {
    try {
      const crypto = require('crypto')
      const total = FILES.reduce((a, m) => a + m.size, 0)
      let done = FILES.filter(modelReady).reduce((a, m) => a + m.size, 0)
      const send = () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('models:progress', { received: done, total })
      send()
      for (const m of FILES) {
        if (modelReady(m)) continue
        const dest = path.join(modelsDir(), m.name)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        const part = dest + '.part'
        await downloadFile(m.url, part, (n) => {
          done += n
          send()
        })
        const hash = crypto.createHash('sha256').update(fs.readFileSync(part)).digest('hex').toUpperCase()
        if (hash !== m.sha256) {
          fs.rmSync(part, { force: true })
          throw new Error('The downloaded file was not what was expected, so it was thrown away. Try again.')
        }
        fs.renameSync(part, dest)
      }
      return { ...modelStatus(), error: null }
    } catch (err) {
      return { ...modelStatus(), error: String((err && err.message) || err) }
    } finally {
      modelJob = null
    }
  })()
  return modelJob
})
// Version history: copies of a project kept as you save and work, so an earlier state can be brought back.
// One folder per project (named after the project file, or the tab for a project not saved yet).
const historyDir = (key) => {
  const h = require('crypto').createHash('sha1').update(String(key)).digest('hex').slice(0, 16)
  const d = path.join(app.getPath('userData'), 'history', h)
  fs.mkdirSync(d, { recursive: true })
  return d
}
const HISTORY_KEEP = 40
ipcMain.handle('history:add', (_e, { key, json, label }) => {
  const d = historyDir(key)
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort()
  if (files.length) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(d, files[files.length - 1]), 'utf8')).json === json) return false // nothing changed
    } catch {}
  }
  fs.writeFileSync(path.join(d, Date.now() + '.json'), JSON.stringify({ time: Date.now(), label: label || '', json }), 'utf8')
  for (const old of files.slice(0, Math.max(0, files.length + 1 - HISTORY_KEEP))) fs.rmSync(path.join(d, old), { force: true })
  return true
})
ipcMain.handle('history:list', (_e, key) => {
  const d = historyDir(key)
  const out = []
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json')).sort().reverse()) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))
      const p = JSON.parse(v.json)
      const secs = (p.clips || []).reduce((a, c) => a + (c.out - c.in) / (c.speed > 0 ? c.speed : 1), 0)
      out.push({ id: f, time: v.time, label: v.label, clips: (p.clips || []).length + (p.overlayClips || []).length, audio: (p.audioClips || []).length, seconds: secs })
    } catch {}
  }
  return out
})
ipcMain.handle('history:read', (_e, { key, id }) => {
  const v = JSON.parse(fs.readFileSync(path.join(historyDir(key), path.basename(id)), 'utf8'))
  return v.json
})
// The microphone (voice-over recording): allowed for this app's own window only. In developer tests a fake
// microphone is used so nothing needs to be plugged in.
if (process.env.VIBE_SELFTEST) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}
app.whenReady().then(() => {
  const { session } = require('electron')
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')
})

// A finished voice-over: the recording (webm) is turned into an .m4a (so it has a proper length) and kept in
// Documents > Vibe Editing Suite Projects > Voice-overs
ipcMain.handle('voice:save', async (_e, { data }) => {
  const dir = path.join(projectsDir(), 'Voice-overs')
  fs.mkdirSync(dir, { recursive: true })
  const d = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  const name = `Voice-over ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`
  const webm = path.join(dir, name + '.webm')
  const m4a = path.join(dir, name + '.m4a')
  fs.writeFileSync(webm, Buffer.from(data))
  await run(ffmpegPath, ['-y', '-v', 'error', '-i', webm, '-vn', '-c:a', 'aac', '-b:a', '192k', m4a])
  fs.rmSync(webm, { force: true })
  return m4a
})
ipcMain.handle('voice:folder', () => {
  const dir = path.join(projectsDir(), 'Voice-overs')
  fs.mkdirSync(dir, { recursive: true })
  return shell.openPath(dir)
})
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
