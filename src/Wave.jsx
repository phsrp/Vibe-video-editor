import { useEffect, useRef, useState } from 'react'

// Waveforms: a picture of the loudness of an audio file inside its clip on the timeline.
// Only the part of the clip that is on screen is drawn, one bar per screen pixel, so it stays sharp at any zoom.
const cache = new Map() // file -> {data, promise}

export function usePeaks(file) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!file) return
    let live = true
    let e = cache.get(file)
    if (!e) {
      e = { data: null, promise: null }
      e.promise = window.api.audioPeaks(file).then((d) => {
        e.data = d
        return d
      })
      cache.set(file, e)
    }
    if (!e.data) e.promise.then(() => live && tick((n) => n + 1))
    return () => {
      live = false
    }
  }, [file])
  const e = file && cache.get(file)
  return e && e.data
}

const RATE = 200 // values per second, see electron/main.js

// Draws the part [from, to] (seconds of the file) of the file's waveform over a clip that is `width` px wide
// and starts `left` px into the lane; `view` = {l, r}: the lane pixels that are on screen.
// gain = the clip's volume (1 = 100%): the waveform grows and shrinks with it; bars that would be taller than the
// clip (above about 100% loudness) are cut off and drawn in a warm colour.
export default function Wave({ file, from, to, width, left, view, height, gain = 1 }) {
  const ref = useRef(null)
  const peaks = usePeaks(file)
  const x0 = Math.max(0, Math.floor(view.l - left))
  const x1 = Math.min(Math.ceil(width), Math.ceil(view.r - left))
  const w = x1 - x0
  useEffect(() => {
    const cv = ref.current
    if (!cv || !peaks || !peaks.length || w <= 0) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(1, Math.round(w * dpr))
    cv.width = cw
    cv.height = Math.round(height * dpr)
    const g = cv.getContext('2d')
    const color = getComputedStyle(cv).color
    g.fillStyle = color
    const mid = cv.height / 2
    const span = Math.max(0.001, to - from)
    const secPerPx = span / width
    // the centre line, like other editors
    g.globalAlpha = 0.5
    g.fillRect(0, Math.floor(mid), cw, Math.max(1, Math.round(dpr * 0.6)))
    g.globalAlpha = 1
    for (let x = 0; x < cw; x++) {
      const t0 = from + (x0 + x / dpr) * secPerPx
      const t1 = from + (x0 + (x + 1) / dpr) * secPerPx
      const a = Math.floor(t0 * RATE)
      const b = Math.max(a + 1, Math.ceil(t1 * RATE))
      let m = 0
      for (let i = a; i < b && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i]
      if (!m) continue
      const full = cv.height - 2
      const want = (m / 255) * full * gain
      const h = Math.max(1, Math.round(Math.min(full, want)))
      if (want > full) g.fillStyle = '#f6c177' // too loud for the clip: it would be clipped
      g.fillRect(x, Math.round(mid - h / 2), 1, h)
      if (want > full) g.fillStyle = color
    }
  }, [peaks, from, to, width, x0, w, height, gain])
  if (!file || w <= 0) return null
  return <canvas ref={ref} className="wave" style={{ left: x0, width: w, height }} />
}
