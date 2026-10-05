// Video export, main-process side.
//
// How export works:
//  1. The renderer works out a "plan": the timeline cut into pieces. Plain clip pieces are
//     read straight from the source files by FFmpeg. Transition pieces are rendered by the app
//     itself (with the same WebGL shaders as the preview): this file extracts the source frames
//     and receives the rendered frames, encoding them into a short temporary video.
//  2. One final FFmpeg run joins all pieces, mixes the audio and encodes the chosen format.
const { app, dialog, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

let job = null // {dir, procs:Set, cancelled, seg}

function track(proc) {
  job.procs.add(proc)
  proc.on('close', () => job && job.procs.delete(proc))
  return proc
}

// Runs ffmpeg to completion. Resolves with stderr; rejects with the tail of stderr on failure.
function runFfmpeg(ffmpegPath, args, onStdout) {
  return new Promise((resolve, reject) => {
    const proc = track(spawn(ffmpegPath, args, { windowsHide: true }))
    let err = ''
    proc.stderr.on('data', (d) => (err = (err + d).slice(-6000)))
    if (onStdout) proc.stdout.on('data', onStdout)
    else proc.stdout.resume()
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (job && job.cancelled) return reject(new Error('Export cancelled'))
      if (code === 0) resolve(err)
      else reject(new Error(err.trim().split('\n').slice(-6).join('\n') || `ffmpeg exited with code ${code}`))
    })
  })
}

const fit = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`

// ---- the final ffmpeg command: join pieces, mix audio, encode
function buildFinal(plan, dir) {
  const inputs = []
  const filters = []
  let n = 0
  const addInput = (...a) => {
    inputs.push(...a)
    return n++
  }

  // video pieces
  const vlabels = []
  plan.segments.forEach((s, k) => {
    let i
    let pre
    if (s.kind === 'trans') {
      i = addInput('-i', path.join(dir, `seg_${s.k}.mp4`))
      pre = `setpts=PTS-STARTPTS,fps=${plan.fps},format=yuv420p`
    } else if (s.isImage) {
      i = addInput('-loop', '1', '-framerate', String(plan.fps), '-t', String(s.frames / plan.fps + 1), '-i', s.file)
      pre = `fps=${plan.fps},${fit(plan.w, plan.h)},format=yuv420p`
    } else {
      i = addInput('-ss', String(s.srcStart), '-t', String(s.srcDur), '-i', s.file)
      // setpts makes the clip play faster or slower (speed 2 = twice as fast)
      pre = `setpts=PTS/${s.speed || 1},fps=${plan.fps},${fit(plan.w, plan.h)},format=yuv420p`
    }
    // exactly s.frames frames per piece, so audio and video stay in sync over the whole timeline
    filters.push(`[${i}:v:0]${pre},setpts=PTS-STARTPTS,tpad=stop=4:stop_mode=clone,trim=end_frame=${s.frames},setpts=PTS-STARTPTS[v${k}]`)
    vlabels.push(`[v${k}]`)
  })
  // the picture is also saved as a small preview image twice a second, which the Export tab shows while it works
  if (vlabels.length) {
    filters.push(`${vlabels.join('')}concat=n=${vlabels.length}:v=1:a=0[vcat]`)
    filters.push('[vcat]split=2[vout][vprev]')
    filters.push('[vprev]fps=2,scale=640:-2[vpv]')
  }

  // audio: one chain per clip, mixed per track
  const tlabels = []
  plan.audio.forEach((t, ti) => {
    const clipLabels = []
    t.clips.forEach((c, ci) => {
      const i = addInput('-ss', String(c.srcStart), '-t', String(c.srcDur || c.dur), '-i', c.file)
      let chain = `[${i}:a:${c.stream}]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS`
      if (c.reverse) chain += ',areverse'
      // speed: atempo only takes 0.5 to 2 at a time, so a bigger change is a chain of them
      let sp = c.speed || 1
      while (sp > 2) {
        chain += ',atempo=2'
        sp /= 2
      }
      while (sp < 0.5) {
        chain += ',atempo=0.5'
        sp /= 0.5
      }
      if (Math.abs(sp - 1) > 1e-6) chain += `,atempo=${sp.toFixed(5)}`
      chain += `,volume=${c.vol}`
      if (c.fadeIn > 0) chain += `,afade=t=in:st=0:d=${c.fadeIn}`
      if (c.fadeOut > 0) chain += `,afade=t=out:st=${Math.max(0, c.dur - c.fadeOut)}:d=${c.fadeOut}`
      if (c.at > 0.0005) chain += `,adelay=${Math.round(c.at * 1000)}:all=1`
      const label = `[a${ti}_${ci}]`
      filters.push(chain + label)
      clipLabels.push(label)
    })
    if (clipLabels.length === 1) tlabels.push(clipLabels[0])
    else {
      filters.push(`${clipLabels.join('')}amix=inputs=${clipLabels.length}:duration=longest:normalize=0[t${ti}]`)
      tlabels.push(`[t${ti}]`)
    }
  })
  const aouts = []
  const tot = plan.totalSec.toFixed(4)
  if (tlabels.length) {
    if (plan.audioMode === 'mix' || tlabels.length === 1) {
      const mix = tlabels.length > 1 ? `${tlabels.join('')}amix=inputs=${tlabels.length}:duration=longest:normalize=0,` : `${tlabels[0]}`
      // loudness: bring the whole mix to a target loudness (LUFS), like streaming services do
      const ln = plan.loudness && plan.loudness !== 'off' ? `loudnorm=I=${plan.loudness}:TP=-1.5:LRA=11,` : ''
      filters.push(`${mix}${ln}alimiter=limit=0.97,apad=whole_dur=${tot},atrim=end=${tot}[aout0]`)
      aouts.push('[aout0]')
    } else {
      tlabels.forEach((l, i) => {
        filters.push(`${l}apad=whole_dur=${tot},atrim=end=${tot}[aout${i}]`)
        aouts.push(`[aout${i}]`)
      })
    }
  }

  const scriptPath = path.join(dir, 'filters.txt')
  fs.writeFileSync(scriptPath, filters.join(';\n'))

  const br = plan.bitrateMbps
  const args = ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', ...inputs, '-filter_complex_script', scriptPath]
  if (!plan.audioOnly) args.push('-map', '[vout]')
  aouts.forEach((l) => args.push('-map', l))
  if (plan.audioOnly) {
    // audio only: MP3, M4A (AAC) or WAV
    if (!aouts.length) throw new Error('There is no sound to export: every audio track is muted or empty.')
    const kb = `${plan.audioKbps || 192}k`
    if (plan.audioFormat === 'wav') args.push('-c:a', 'pcm_s16le', '-ar', '48000')
    else if (plan.audioFormat === 'm4a') args.push('-c:a', 'aac', '-b:a', kb, '-ar', '48000', '-movflags', '+faststart')
    else args.push('-c:a', 'libmp3lame', '-b:a', kb, '-ar', '48000')
    args.push(plan.out)
    return args
  }
  // the video encoder: the processor (x264 / x265), or a graphics card (NVIDIA NVENC, AMD AMF, Intel Quick Sync)
  const hevc = plan.codec === 'h265'
  const speed = plan.speed || 'balanced'
  const enc = plan.encoder || 'cpu'
  if (enc === 'nvenc') {
    args.push('-c:v', hevc ? 'hevc_nvenc' : 'h264_nvenc', '-preset', { fast: 'p3', balanced: 'p5', best: 'p7' }[speed] || 'p5', '-rc', 'vbr')
    if (hevc) args.push('-tag:v', 'hvc1')
  } else if (enc === 'amf') {
    args.push('-c:v', hevc ? 'hevc_amf' : 'h264_amf', '-quality', { fast: 'speed', balanced: 'balanced', best: 'quality' }[speed] || 'balanced', '-rc', 'vbr_peak')
    if (hevc) args.push('-tag:v', 'hvc1')
  } else if (enc === 'qsv') {
    args.push('-c:v', hevc ? 'hevc_qsv' : 'h264_qsv', '-preset', { fast: 'veryfast', balanced: 'medium', best: 'slow' }[speed] || 'medium')
    if (hevc) args.push('-tag:v', 'hvc1')
  } else if (hevc) {
    args.push('-c:v', 'libx265', '-preset', plan.preset, '-tag:v', 'hvc1', '-x265-params', 'log-level=error')
  } else {
    args.push('-c:v', 'libx264', '-preset', plan.preset, '-profile:v', 'high')
  }
  args.push('-b:v', `${br}M`, '-maxrate', `${(br * 1.5).toFixed(2)}M`, '-bufsize', `${(br * 3).toFixed(2)}M`, '-pix_fmt', 'yuv420p', '-r', String(plan.fps))
  if (aouts.length) {
    args.push('-c:a', 'aac', '-b:a', `${plan.audioKbps || 192}k`, '-ar', '48000')
    // MP4 keeps a track's name in "handler_name" (players show it when you switch audio tracks)
    if (aouts.length > 1)
      plan.audio.forEach((t, i) => args.push(`-metadata:s:a:${i}`, `title=${t.name}`, `-metadata:s:a:${i}`, `handler_name=${t.name}`))
  }
  if (/\.(mp4|mov)$/i.test(plan.out)) args.push('-movflags', '+faststart')
  args.push(plan.out)
  args.push('-map', '[vpv]', '-q:v', '6', '-update', '1', '-f', 'image2', path.join(dir, 'preview.jpg'))
  return args
}

// Which graphics-card encoders really work on this PC: each one is tried on a few test frames.
let encoderInfo = null
async function detectEncoders(ffmpegPath) {
  const gpus = await new Promise((resolve) => {
    require('child_process').execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }'],
      { windowsHide: true, timeout: 15000 },
      (err, out) => resolve(err ? [] : String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
    )
  })
  const tryEnc = (codec) =>
    new Promise((resolve) => {
      const p = spawn(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-frames:v', '5', '-c:v', codec, '-pix_fmt', 'yuv420p', '-f', 'null', '-'], { windowsHide: true })
      p.on('error', () => resolve(false))
      p.on('close', (code) => resolve(code === 0))
    })
  const [nvenc, amf, qsv] = await Promise.all([tryEnc('h264_nvenc'), tryEnc('h264_amf'), tryEnc('h264_qsv')])
  return { gpus, available: [nvenc && 'nvenc', amf && 'amf', qsv && 'qsv'].filter(Boolean) }
}

function register({ ffmpegPath, getWindow }) {
  ipcMain.handle('export:encoders', async () => {
    if (!encoderInfo) encoderInfo = await detectEncoders(ffmpegPath)
    return encoderInfo
  })

  ipcMain.handle('export:chooseOutput', async (_e, name, ext) => {
    if (process.env.VIBE_SELFTEST && process.env.VIBE_TEST_OUT) return process.env.VIBE_TEST_OUT // developer self-test: no dialog
    const kind = { mp4: 'MP4 video', mkv: 'MKV video', mov: 'MOV video', mp3: 'MP3 audio', m4a: 'M4A audio', wav: 'WAV audio' }[ext] || 'MP4 video'
    const r = await dialog.showSaveDialog(getWindow(), {
      title: 'Export video',
      defaultPath: name,
      filters: [{ name: kind, extensions: [ext || 'mp4'] }],
    })
    return r.canceled ? null : r.filePath
  })

  ipcMain.handle('export:begin', () => {
    const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'vibe-export-'))
    job = { dir, procs: new Set(), cancelled: false, seg: null }
    return dir
  })

  // Extract the source frames a transition needs, already fitted to the export size.
  ipcMain.handle('export:extract', async (_e, o) => {
    const outDir = path.join(job.dir, o.name)
    fs.mkdirSync(outDir, { recursive: true })
    // noPad: keep the picture's own shape (the renderer letterboxes it, so layers can be see-through)
    const vf = o.noPad ? `scale=${o.w}:${o.h}:force_original_aspect_ratio=decrease,setsar=1` : `${fit(o.w, o.h)}`
    const args = ['-y', '-v', 'error']
    if (o.isImage) args.push('-i', o.file, '-vf', vf, '-frames:v', '1')
    else args.push('-ss', String(o.start), '-t', String(o.dur), '-i', o.file, '-vf', `setpts=PTS/${o.speed || 1},fps=${o.fps},${vf}`, '-frames:v', String(o.maxFrames))
    args.push('-compression_level', '1', path.join(outDir, '%05d.png'))
    await runFfmpeg(ffmpegPath, args)
    const count = fs.readdirSync(outDir).length
    return { dir: outDir, count }
  })

  // Rendered transition frames arrive one at a time and are piped into an encoder.
  ipcMain.handle('export:segBegin', (_e, { k, w, h, fps }) => {
    const out = path.join(job.dir, `seg_${k}.mp4`)
    const proc = track(
      spawn(
        ffmpegPath,
        ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', 'pipe:0', '-vf', 'vflip', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', out],
        { windowsHide: true }
      )
    )
    let err = ''
    proc.stderr.on('data', (d) => (err = (err + d).slice(-4000)))
    proc.stdout.resume()
    const done = new Promise((resolve, reject) => {
      proc.on('error', reject)
      proc.stdin.on('error', () => {}) // surfaced through the exit code
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || 'segment encode failed'))))
    })
    job.seg = { proc, done }
  })

  ipcMain.handle('export:frame', async (_e, buf) => {
    const { proc } = job.seg
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
    if (!proc.stdin.write(b)) await new Promise((r) => proc.stdin.once('drain', r))
  })

  ipcMain.handle('export:segEnd', async () => {
    const { proc, done } = job.seg
    proc.stdin.end()
    await done
    job.seg = null
  })

  ipcMain.handle('export:final', async (e, plan) => {
    const args = buildFinal(plan, job.dir)
    let buf = ''
    await runFfmpeg(ffmpegPath, args, (d) => {
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const l of lines) {
        const m = /^frame=(\d+)/.exec(l.trim())
        if (m && !plan.audioOnly) e.sender.send('export:progress', { frame: +m[1] })
        // audio only has no frames: ffmpeg reports how many seconds are done instead
        const sm = /^out_time_(?:ms|us)=(\d+)/.exec(l.trim())
        if (sm && plan.audioOnly) e.sender.send('export:progress', { frame: Math.round((+sm[1] / 1e6) * plan.fps) })
      }
    })
    return plan.out
  })

  ipcMain.handle('export:cancel', () => {
    if (!job) return
    job.cancelled = true
    for (const p of job.procs) {
      try {
        p.kill()
      } catch {}
    }
  })

  ipcMain.handle('export:cleanup', async () => {
    if (!job) return
    const dir = job.dir
    job = null
    // give killed processes a moment to release their files
    await new Promise((r) => setTimeout(r, 300))
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  })

  ipcMain.handle('export:reveal', (_e, file) => shell.showItemInFolder(file))
}

module.exports = { register }
