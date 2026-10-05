import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { projectDuration } from './state.js'
import { RESOLUTIONS, DEFAULT_BITRATE, defaultSettings, runExport, cancelExport, isExporting } from './exporter.js'

const ENCODERS = [
  { id: 'nvenc', label: 'NVIDIA graphics card (NVENC)' },
  { id: 'amf', label: 'AMD graphics card (AMF)' },
  { id: 'qsv', label: 'Intel graphics (Quick Sync)' },
]

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
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h}h ${String(m).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

// The Export tab of a project: settings on the left, and on the right the video as it is being made.
export default function ExportTab({ active, getProject, onStatus }) {
  const [s, setS] = useState(load)
  const [phase, setPhase] = useState('settings') // settings | running | done | error
  const [prog, setProg] = useState({ pct: 0, label: '' })
  const [eta, setEta] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [out, setOut] = useState('')
  const [err, setErr] = useState('')
  const [shown, setShown] = useState(null) // 'canvas' | 'image' | null: what the preview area shows
  const [imgUrl, setImgUrl] = useState('')
  const [project, setProject] = useState(() => getProject())
  const [gpu, setGpu] = useState(null) // {gpus: [names], available: ['nvenc'|'amf'|'qsv']} once checked
  const canvasRef = useRef(null)
  const t0 = useRef(0)
  useEffect(() => {
    window.api.exportEncoders().then(setGpu).catch(() => setGpu({ gpus: [], available: [] }))
  }, [])

  const set = (patch) => setS((x) => ({ ...x, ...patch }))
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {}
  }, [s])
  // when this tab is opened or shown again, look at the project as it is now
  useEffect(() => {
    if (active && phase !== 'running') setProject(getProject())
  }, [active])
  // a clock while exporting
  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => setElapsed((performance.now() - t0.current) / 1000), 500)
    return () => clearInterval(id)
  }, [phase])

  const state = project.state
  const duration = projectDuration(state)
  const [rw, rh] = RESOLUTIONS[s.res]
  const sizeMB = (((s.bitrate * 1000 + s.audioKbps) * duration) / 8 / 1000).toFixed(0)
  const empty = !state.clips.length && !state.overlayClips.length

  const start = async () => {
    if (isExporting()) {
      setErr('Another export is already running. Wait for it to finish, or cancel it first.')
      setPhase('error')
      return
    }
    const snap = getProject()
    setProject(snap)
    const file = await window.api.exportChooseOutput(`${snap.name || 'My video'}.${s.container}`, s.container)
    if (!file) return
    setPhase('running')
    setErr('')
    setShown(null)
    setProg({ pct: 0, label: 'Preparing…' })
    setElapsed(0)
    t0.current = performance.now()
    onStatus({ running: true, pct: 0 })
    try {
      const transitions = await window.api.listTransitions()
      const result = await runExport({
        state: snap.state,
        settings: { ...s, encoder },
        transitions,
        outPath: file,
        onProgress: (p) => {
          setProg(p)
          const el = (performance.now() - t0.current) / 1000
          setEta(p.pct > 3 ? (el / p.pct) * (100 - p.pct) : null)
          onStatus({ running: true, pct: p.pct })
        },
        onPreview: (canvas) => {
          const cv = canvasRef.current
          if (!cv) return
          setShown((v) => v || 'canvas')
          if (cv.width !== 640) {
            cv.width = 640
            cv.height = 360
          }
          cv.getContext('2d').drawImage(canvas, 0, 0, cv.width, cv.height)
        },
        onPreviewUrl: (url) => {
          setShown('image')
          setImgUrl(url)
        },
      })
      setOut(result)
      setPhase('done')
      onStatus({ running: false, pct: 100, done: true })
    } catch (e) {
      if (String(e.message).includes('cancelled')) setPhase('settings')
      else {
        setErr(String(e.message || e))
        setPhase('error')
      }
      onStatus({ running: false, pct: 0 })
    }
  }

  const running = phase === 'running'
  const has = (id) => !!gpu && gpu.available.includes(id)
  const encoder = s.encoder === 'cpu' || has(s.encoder) ? s.encoder : 'cpu' // a saved choice that does not work here falls back to the processor

  return (
    <div className="export-page" style={{ display: active ? undefined : 'none' }}>
      <div className="export-side">
        <h2>Export video</h2>
        <div className="exp-grid">
          <label>Resolution</label>
          <select disabled={running} value={s.res} onChange={(e) => set({ res: e.target.value, bitrate: DEFAULT_BITRATE[e.target.value] })}>
            {Object.entries(RESOLUTIONS).map(([k, [w, h]]) => (
              <option key={k} value={k}>{k} ({w}×{h})</option>
            ))}
          </select>

          <label>Frame rate</label>
          <select disabled={running} value={s.fps} onChange={(e) => set({ fps: +e.target.value })}>
            {[24, 30, 60].map((f) => (
              <option key={f} value={f}>{f} fps</option>
            ))}
          </select>

          <label>Video format</label>
          <select disabled={running} value={s.codec} onChange={(e) => set({ codec: e.target.value })}>
            <option value="h264">H.264 (works everywhere)</option>
            <option value="h265">H.265 / HEVC (smaller files, slower)</option>
          </select>

          <label>File type</label>
          <select disabled={running} value={s.container} onChange={(e) => set({ container: e.target.value })}>
            <option value="mp4">MP4 (works everywhere)</option>
            <option value="mkv">MKV (handles many audio tracks well)</option>
            <option value="mov">MOV (Apple, editing programs)</option>
          </select>

          <label>Video bitrate: {s.bitrate} Mbps</label>
          <input disabled={running} type="range" min="1" max="100" step="1" value={s.bitrate} onChange={(e) => set({ bitrate: +e.target.value })} />

          <label>Speed / quality</label>
          <select disabled={running} value={s.speed} onChange={(e) => set({ speed: e.target.value })}>
            <option value="fast">Fast (bigger file)</option>
            <option value="balanced">Balanced</option>
            <option value="best">Best quality (slow)</option>
          </select>

          <label>Encoder</label>
          <select disabled={running} value={encoder} onChange={(e) => set({ encoder: e.target.value })}>
            <option value="cpu">Processor (works on every PC)</option>
            {ENCODERS.map((x) => (
              <option key={x.id} value={x.id} disabled={!has(x.id)}>
                {x.label}{has(x.id) ? '' : ' (not found)'}
              </option>
            ))}
          </select>

          <label>Audio tracks</label>
          <select disabled={running} value={s.audioMode} onChange={(e) => set({ audioMode: e.target.value })}>
            <option value="mix">Mix everything into one track</option>
            <option value="separate">Keep tracks separate</option>
          </select>

          <label>Audio quality</label>
          <select disabled={running} value={s.audioKbps} onChange={(e) => set({ audioKbps: +e.target.value })}>
            {[128, 192, 256, 320].map((k) => (
              <option key={k} value={k}>{k} kbps{k === 192 ? ' (good)' : k === 320 ? ' (best)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="hint left exp-info">
          <b>Graphics card encoding</b> is much faster for H.265 and somewhat faster for H.264, but needs a graphics card with a video encoder: an <b>NVIDIA</b> GeForce (GTX 600 or newer, or any RTX), an <b>AMD</b> Radeon (RX 400 or newer) or <b>Intel</b> built-in graphics (2nd generation Core or newer), with up-to-date drivers.{' '}
          {gpu == null
            ? 'Checking this PC…'
            : gpu.gpus.length
              ? `Found on this PC: ${gpu.gpus.join(', ')}. ${gpu.available.length ? 'It can be used for exporting.' : 'None of them can be used for exporting here.'}`
              : 'No graphics card was found on this PC.'}
        </div>
        <div className="hint left exp-info">
          {state.clips.length + state.overlayClips.length} clip{state.clips.length + state.overlayClips.length === 1 ? '' : 's'} · length {fmtDur(duration)} · about {sizeMB} MB at {rw}×{rh}. Muted tracks are not included.
          {s.audioMode === 'separate' && ' Each audio track becomes its own audio stream in the file (switch between them in a player like VLC).'}
        </div>
        {phase === 'error' && <div className="exp-error">Export failed:<pre>{err}</pre></div>}
        <div className="export-actions">
          {!running && (
            <button className="primary big" onClick={start} disabled={empty}>
              <Icon name="upload" size={16} /> {phase === 'done' ? 'Export again…' : 'Start export…'}
            </button>
          )}
          {running && (
            <button className="big" onClick={cancelExport}>Cancel export</button>
          )}
          {phase === 'done' && (
            <button className="big" onClick={() => window.api.exportReveal(out)}>
              <Icon name="folder" size={16} /> Show in folder
            </button>
          )}
        </div>
        {empty && <div className="hint warn">This project has nothing on its timeline yet.</div>}
      </div>

      <div className="export-main">
        <div className="export-view">
          <canvas ref={canvasRef} width="640" height="360" style={{ display: shown === 'canvas' ? 'block' : 'none' }} />
          {shown === 'image' && <img src={imgUrl} alt="" />}
          {!shown && (
            <div className="export-placeholder">
              {running ? 'Getting ready…' : phase === 'done' ? 'Done. Your video is saved.' : 'The video appears here while it is being made.'}
            </div>
          )}
        </div>
        {(running || phase === 'done') && (
          <div className="export-status">
            <div className="exp-label">{phase === 'done' ? 'Your video is ready.' : prog.label}</div>
            <div className="bar"><div className="bar-fill" style={{ width: `${phase === 'done' ? 100 : prog.pct}%` }} /></div>
            <div className="exp-pct">
              {phase === 'done' ? `Finished in ${fmtDur(elapsed)}` : `${prog.pct.toFixed(0)}% · ${fmtDur(elapsed)} so far${eta != null ? ` · about ${fmtDur(eta)} left` : ''}`}
            </div>
            {phase === 'done' && <div className="hint left" style={{ wordBreak: 'break-all' }}>{out}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
