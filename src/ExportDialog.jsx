import { useEffect, useRef, useState } from 'react'
import { totalDuration } from './state.js'
import { RESOLUTIONS, DEFAULT_BITRATE, defaultSettings, runExport, cancelExport } from './exporter.js'

const KEY = 'vibe.exportSettings'
const load = () => {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return defaultSettings
  }
}

const fmtDur = (s) => {
  s = Math.max(0, Math.round(s))
  const m = Math.floor(s / 60)
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

export default function ExportDialog({ state, transitions, projectName, onClose }) {
  const [s, setS] = useState(load)
  const [phase, setPhase] = useState('settings') // settings | running | done | error
  const [prog, setProg] = useState({ pct: 0, label: '' })
  const [eta, setEta] = useState(null)
  const [out, setOut] = useState('')
  const [err, setErr] = useState('')
  const t0 = useRef(0)

  const set = (patch) => setS((x) => ({ ...x, ...patch }))
  const duration = totalDuration(state.clips)
  const sizeMB = ((s.bitrate * 1000 * duration) / 8 / 1000 + (192 * duration) / 8 / 1000).toFixed(0) // Mbit/s -> MB

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {}
  }, [s])

  const start = async () => {
    const path = await window.api.exportChooseOutput(`${projectName || 'My video'}.mp4`)
    if (!path) return
    setPhase('running')
    setErr('')
    setProg({ pct: 0, label: 'Preparing…' })
    t0.current = performance.now()
    try {
      const file = await runExport({
        state,
        settings: s,
        transitions,
        outPath: path,
        onProgress: (p) => {
          setProg(p)
          const el = (performance.now() - t0.current) / 1000
          setEta(p.pct > 3 ? (el / p.pct) * (100 - p.pct) : null)
        },
      })
      setOut(file)
      setPhase('done')
    } catch (e) {
      if (String(e.message).includes('cancelled')) {
        setPhase('settings')
      } else {
        setErr(String(e.message || e))
        setPhase('error')
      }
    }
  }

  const running = phase === 'running'

  return (
    <div className="modal-bg" onClick={() => !running && onClose()}>
      <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Export video</h3>

        {(phase === 'settings' || phase === 'error') && (
          <>
            <div className="exp-grid">
              <label>Resolution</label>
              <select value={s.res} onChange={(e) => set({ res: e.target.value, bitrate: DEFAULT_BITRATE[e.target.value] })}>
                {Object.entries(RESOLUTIONS).map(([k, [w, h]]) => (
                  <option key={k} value={k}>{k} ({w}×{h})</option>
                ))}
              </select>

              <label>Frame rate</label>
              <select value={s.fps} onChange={(e) => set({ fps: +e.target.value })}>
                {[24, 30, 60].map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>

              <label>Format</label>
              <select value={s.codec} onChange={(e) => set({ codec: e.target.value })}>
                <option value="h264">H.264 (works everywhere)</option>
                <option value="h265">H.265 / HEVC (smaller files, slower)</option>
              </select>

              <label>Bitrate: {s.bitrate} Mbps</label>
              <input type="range" min="1" max="100" step="1" value={s.bitrate} onChange={(e) => set({ bitrate: +e.target.value })} />

              <label>Speed / quality</label>
              <select value={s.speed} onChange={(e) => set({ speed: e.target.value })}>
                <option value="fast">Fast (bigger file)</option>
                <option value="balanced">Balanced</option>
                <option value="best">Best quality (slow)</option>
              </select>

              <label>Audio tracks</label>
              <select value={s.audioMode} onChange={(e) => set({ audioMode: e.target.value })}>
                <option value="mix">Mix everything into one track</option>
                <option value="separate">Keep tracks separate</option>
              </select>
            </div>
            <div className="hint left exp-info">
              Length {fmtDur(duration)} · about {sizeMB} MB. Muted tracks are not included.
              {s.audioMode === 'separate' && ' Each audio track becomes its own audio stream in the file (switch between them in a player like VLC).'}
            </div>
            {phase === 'error' && <div className="exp-error">Export failed:<pre>{err}</pre></div>}
            <div className="modal-foot">
              <button onClick={onClose}>Close</button>
              <button className="primary" onClick={start} disabled={!state.clips.length}>
                Export…
              </button>
            </div>
          </>
        )}

        {running && (
          <>
            <div className="exp-label">{prog.label}</div>
            <div className="bar"><div className="bar-fill" style={{ width: `${prog.pct}%` }} /></div>
            <div className="exp-pct">
              {prog.pct.toFixed(0)}%{eta != null ? ` · about ${fmtDur(eta)} left` : ''}
            </div>
            <div className="modal-foot">
              <span />
              <button onClick={cancelExport}>Cancel export</button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="exp-label">Your video is ready.</div>
            <div className="bar"><div className="bar-fill" style={{ width: '100%' }} /></div>
            <div className="hint left" style={{ wordBreak: 'break-all' }}>{out}</div>
            <div className="modal-foot">
              <button onClick={onClose}>Close</button>
              <button className="primary" onClick={() => window.api.exportReveal(out)}>Show in folder</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
