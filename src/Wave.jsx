import { useEffect, useRef, useState } from 'react'

// Waveforms: a small picture of the loudness of an audio file inside its clip on the timeline.
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

const RATE = 50 // values per second, see electron/main.js

// Draws the part [from, to] (seconds of the file) of the file's waveform into the whole canvas.
export default function Wave({ file, from, to, width, height }) {
  const ref = useRef(null)
  const peaks = usePeaks(file)
  const w = Math.max(1, Math.min(6000, Math.round(width)))
  useEffect(() => {
    const cv = ref.current
    if (!cv || !peaks || !peaks.length) return
    const g = cv.getContext('2d')
    g.clearRect(0, 0, w, height)
    g.fillStyle = getComputedStyle(cv).color
    const mid = height / 2
    const span = Math.max(0.001, to - from)
    for (let x = 0; x < w; x++) {
      const a = Math.floor((from + (x / w) * span) * RATE)
      const b = Math.max(a + 1, Math.floor((from + ((x + 1) / w) * span) * RATE))
      let m = 0
      for (let i = a; i < b && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i]
      const h = Math.max(1, (m / 255) * (height - 4))
      g.fillRect(x, mid - h / 2, 1, h)
    }
  }, [peaks, from, to, w, height])
  if (!file) return null
  return <canvas ref={ref} className="wave" width={w} height={height} />
}
