// Video export, renderer side. See electron/exporter.js for the overall approach.
import { layout, totalDuration, hasAttached, streamCount, toUrl } from './state.js'
import { createRenderer } from './glRenderer.js'
import { evalTransform, hasTransform } from './motion.js'

export const RESOLUTIONS = { '1080p': [1920, 1080], '2K': [2560, 1440], '4K': [3840, 2160] }
export const DEFAULT_BITRATE = { '1080p': 12, '2K': 24, '4K': 50 }
export const PRESETS = { fast: 'veryfast', balanced: 'medium', best: 'slow' }

export const defaultSettings = { res: '1080p', fps: 30, codec: 'h264', bitrate: 12, speed: 'balanced', audioMode: 'mix' }

// Cut the timeline into pieces: plain clip pieces (read by FFmpeg) and transition pieces (rendered here),
// and work out the audio tracks. Frame counts come from rounding the piece boundaries, so the
// pieces always add up to the exact length of the timeline.
export function buildPlan(state, s) {
  const [w, h] = RESOLUTIONS[s.res]
  const fps = s.fps
  const lay = layout(state.clips)
  if (!lay.length) throw new Error('The timeline is empty.')
  const mediaOf = (id) => state.media.find((m) => m.id === id)
  const total = totalDuration(state.clips)

  for (const c of lay) {
    const m = mediaOf(c.mediaId)
    if (!m || m.missing) throw new Error(`A source file is missing: ${m ? m.name : 'unknown'}. Reconnect it by re-importing, then try again.`)
  }

  const raw = []
  lay.forEach((c, i) => {
    const next = lay[i + 1]
    const nextOv = next ? next.ov : 0
    const m = mediaOf(c.mediaId)
    if (c.ov > 0) raw.push({ kind: 'trans', t0: c.start, t1: c.start + c.ov, a: lay[i - 1], b: c, name: c.transition.name })
    const t0 = c.start + c.ov
    const t1 = c.start + c.dur - nextOv
    if (t1 - t0 > 1e-6) {
      // a clip with motion (position / scale / rotation / opacity) must go through the effects renderer
      if (hasTransform(c)) raw.push({ kind: 'solo', t0, t1, clip: c, media: m, srcStart: c.in + c.ov })
      else raw.push({ kind: 'clip', t0, t1, file: m.path, isImage: m.type === 'image', srcStart: c.in + c.ov, srcDur: t1 - t0 })
    }
  })

  const segments = []
  let k = 0
  for (const r of raw) {
    const frames = Math.round(r.t1 * fps) - Math.round(r.t0 * fps)
    if (frames <= 0) continue
    if (r.kind === 'clip') segments.push({ kind: 'clip', file: r.file, isImage: r.isImage, srcStart: r.srcStart, srcDur: r.srcDur, frames })
    else if (r.kind === 'solo') {
      segments.push({
        kind: 'gl',
        k: k++,
        frames,
        name: null,
        dur: r.t1 - r.t0,
        a: { file: r.media.path, isImage: r.media.type === 'image', start: r.srcStart, clip: r.clip },
        b: null,
      })
    } else {
      const ma = mediaOf(r.a.mediaId)
      const mb = mediaOf(r.b.mediaId)
      segments.push({
        kind: 'gl',
        k: k++,
        frames,
        name: r.name,
        dur: r.t1 - r.t0,
        a: { file: ma.path, isImage: ma.type === 'image', start: r.a.out - (r.t1 - r.t0), clip: r.a },
        b: { file: mb.path, isImage: mb.type === 'image', start: r.b.in, clip: r.b },
      })
    }
  }
  const totalFrames = segments.reduce((a, x) => a + x.frames, 0)

  // ---- audio tracks (muted tracks are left out)
  const audio = []
  for (let n = 0; n < streamCount(state); n++) {
    const st = { volume: 1, mute: false, ...state.streamSettings[n] }
    if (st.mute || st.volume <= 0) continue
    const clips = []
    lay.forEach((c, i) => {
      const m = mediaOf(c.mediaId)
      if (!hasAttached(c, m, n)) return
      const next = lay[i + 1]
      clips.push({ file: m.path, stream: n, srcStart: c.in, dur: c.dur, at: c.start, vol: st.volume, fadeIn: c.ov, fadeOut: next ? next.ov : 0 })
    })
    if (clips.length) audio.push({ name: `Video audio ${n + 1}`, clips })
  }
  for (const t of state.audioTracks) {
    if (t.mute || t.volume <= 0) continue
    const clips = []
    for (const a of state.audioClips) {
      if (a.trackId !== t.id || a.start >= total) continue
      const m = mediaOf(a.mediaId)
      if (!m || m.missing) continue
      clips.push({ file: m.path, stream: a.stream != null ? a.stream : 0, srcStart: a.in, dur: a.out - a.in, at: a.start, vol: t.volume, fadeIn: 0, fadeOut: 0 })
    }
    if (clips.length) audio.push({ name: t.name, clips })
  }

  return {
    w,
    h,
    fps,
    codec: s.codec,
    bitrateMbps: s.bitrate,
    preset: PRESETS[s.speed] || 'medium',
    audioMode: s.audioMode,
    segments,
    audio,
    totalFrames,
    totalSec: totalFrames / fps,
  }
}

let cancelled = false
export function cancelExport() {
  cancelled = true
  window.api.exportCancel()
}

const pad5 = (n) => String(n).padStart(5, '0')

// Runs the export. onProgress({pct, label}). Resolves with the output path.
export async function runExport({ state, settings, transitions, outPath, onProgress }) {
  cancelled = false
  const plan = buildPlan(state, settings)
  plan.out = outPath
  const { w, h, fps } = plan
  await window.api.exportBegin()
  let unsub = null
  try {
    const trans = plan.segments.filter((s) => s.kind === 'gl')
    const transFrames = trans.reduce((a, s) => a + s.frames, 0)
    // a rendered transition frame costs a few times more than a plain frame
    const W_T = 3
    const units = transFrames * W_T + plan.totalFrames
    let doneT = 0
    const report = (label, extra = 0) => onProgress({ pct: Math.min(99.5, ((doneT * W_T + extra) / units) * 100), label })
    report('Preparing…')

    if (trans.length) {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const renderer = createRenderer(canvas)
      for (const t of transitions) renderer.addTransition(t.name, t.source)
      const buf = new Uint8Array(w * h * 4)

      for (let ti = 0; ti < trans.length; ti++) {
        const s = trans[ti]
        const label = `Rendering effects ${ti + 1} of ${trans.length}`
        report(label)
        const extract = (side, name) =>
          window.api.exportExtract({ name, file: side.file, isImage: side.isImage, start: side.start, dur: s.dur, fps, w, h, maxFrames: s.frames + 2 })
        const fa = await extract(s.a, `t${s.k}a`)
        const fb = s.b ? await extract(s.b, `t${s.k}b`) : null
        if (cancelled) throw new Error('Export cancelled')
        await window.api.exportSegBegin({ k: s.k, w, h, fps })
        const cache = new Map()
        const load = (info, key, i) => {
          const idx = Math.min(i, info.count - 1)
          const ck = `${key}${info.count === 1 ? 0 : idx}`
          if (cache.has(ck)) return cache.get(ck)
          const img = new Image()
          img.src = toUrl(`${info.dir}\\${pad5(idx + 1)}.png`)
          const p = img.decode().then(() => img)
          cache.set(ck, p)
          if (cache.size > 6) cache.delete(cache.keys().next().value)
          return p
        }
        let nextA = load(fa, 'a', 0)
        let nextB = fb ? load(fb, 'b', 0) : null
        for (let i = 0; i < s.frames; i++) {
          if (cancelled) throw new Error('Export cancelled')
          const [imgA, imgB] = await Promise.all([nextA, nextB])
          if (i + 1 < s.frames) {
            nextA = load(fa, 'a', i + 1) // load the next frames while this one renders
            nextB = fb ? load(fb, 'b', i + 1) : null
          }
          // each clip's motion at the source time of this frame
          const tfOf = (side) => evalTransform(side.clip, Math.min(side.clip.out, side.start + i / fps))
          renderer.render(
            { el: imgA, w, h, tf: tfOf(s.a) },
            s.b ? { el: imgB, w, h, tf: tfOf(s.b) } : null,
            s.name,
            (i + 0.5) / s.frames
          )
          renderer.read(buf)
          await window.api.exportFrame(buf)
          doneT++
          report(label)
        }
        await window.api.exportSegEnd()
      }
    }

    if (cancelled) throw new Error('Export cancelled')
    unsub = window.api.onExportProgress((p) => onProgress({ pct: Math.min(99.5, ((doneT * W_T + p.frame) / units) * 100), label: 'Encoding video…' }))
    onProgress({ pct: Math.min(99.5, ((doneT * W_T) / units) * 100), label: 'Encoding video…' })
    const forMain = { ...plan, segments: plan.segments.map((s) => (s.kind === 'gl' ? { kind: 'trans', k: s.k, frames: s.frames } : s)) }
    await window.api.exportFinal(forMain)
    onProgress({ pct: 100, label: 'Done' })
    return outPath
  } finally {
    if (unsub) unsub()
    await window.api.exportCleanup()
  }
}

if (typeof window !== 'undefined') window.__vibeExport = { buildPlan, runExport } // used by the developer self-test
