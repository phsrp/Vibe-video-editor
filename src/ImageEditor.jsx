import { useEffect, useReducer, useRef, useState } from 'react'
import { reducer, initialState } from './state.js'
import ImagePreview, { PAINT_TOOLS } from './ImagePreview.jsx'
import ImageInspector from './ImageInspector.jsx'
import LayersPanel from './LayersPanel.jsx'
import Icon from './Icon.jsx'
import { serializeImage, restoreImage } from './project.js'
import { exportImage } from './imageRender.js'
import { actionFor } from './keybinds.js'

const TOOLS = [
  { id: 'move', icon: 'move', label: 'Move and transform (V)', key: 'V' },
  { id: 'brush', icon: 'brush', label: 'Brush (B)', key: 'B' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser (E)', key: 'E' },
  { id: 'line', icon: 'line', label: 'Line', key: 'L' },
  { id: 'rect', icon: 'square', label: 'Rectangle', key: 'U' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse', key: 'O' },
  { id: 'eyedropper', icon: 'pipette', label: 'Eyedropper: pick a colour (I)', key: 'I' },
]
const isMaskMode = (m) => m === 'mask' || m === 'maskdraw' || m === 'maskpoly' || m === 'maskdrawsmart'

// One open image project (a tab). Layers on a canvas: pictures, paint and text, each with transform, mask, effects and colour.
export default function ImageEditor({ tabId, active, initial, binds, onMeta, onNew, onOpen, registerHandle }) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, canvas: (initial && initial.canvas) || { w: 1920, h: 1080, bg: '#ffffff' } })
  const stateRef = useRef(state)
  stateRef.current = state
  const activeRef = useRef(active)
  activeRef.current = active
  const [projectPath, setProjectPath] = useState(null)
  const projectRef = useRef(null)
  projectRef.current = projectPath
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const savedJson = useRef(serializeImage(state))
  const autosavedJson = useRef('')
  const projectName = projectPath ? projectPath.split(/[\\/]/).pop().replace(/\.json$/i, '') : 'Untitled'
  const [tool, setToolState] = useState('move')
  const [mode, setMode] = useState('transform')
  const [freeMode, setFreeMode] = useState(false)
  const [brush, setBrush] = useState({ color: '#000000', size: 24, opacity: 1, hardness: 0.8, fill: false })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [showExport, setShowExport] = useState(false)
  const canvasRef = useRef(null)
  const thumbRef = useRef(null)
  const flag = (key, def = true) => {
    try {
      const v = localStorage.getItem(key)
      return v == null ? def : v !== '0'
    } catch {
      return def
    }
  }
  const [layersOpen, setLayersOpenState] = useState(() => flag('vibe.layersOpen'))
  const [inspOpen, setInspOpenState] = useState(() => flag('vibe.inspOpen'))
  const setLayersOpen = (v) => {
    setLayersOpenState(v)
    try {
      localStorage.setItem('vibe.layersOpen', v ? '1' : '0')
    } catch {}
  }
  const setInspOpen = (v) => {
    setInspOpenState(v)
    try {
      localStorage.setItem('vibe.inspOpen', v ? '1' : '0')
    } catch {}
  }
  const flash = (t) => {
    setNote(t)
    setTimeout(() => setNote((n) => (n === t ? '' : n)), 4000)
  }

  // choosing a tool: painting tools need the handles off; the move tool shows the transform box again
  const setTool = (t) => {
    setToolState(t)
    if (t !== 'move') setMode('none')
    else if (mode === 'none') setMode('transform')
  }
  // starting a mask tool from the inspector switches to the move tool
  useEffect(() => {
    if (isMaskMode(mode) && tool !== 'move') setToolState('move')
  }, [mode])

  // ---- pictures in
  const addPictures = (items) => {
    if (!items.length) return
    dispatch({ type: 'addMedia', items })
    items.forEach((it) => it.type === 'image' && dispatch({ type: 'imgAddImage', mediaId: it.id, fitCanvas: true }))
    if (items.some((it) => it.type !== 'image')) flash('Only pictures can be layers here: videos were skipped.')
  }
  const importPictures = async () => {
    setBusy(true)
    try {
      addPictures(await window.api.importMedia('image'))
    } finally {
      setBusy(false)
    }
  }
  const onDropFiles = async (e) => {
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    setBusy(true)
    try {
      addPictures(await window.api.describeFiles([...e.dataTransfer.files].map((f) => window.api.pathForFile(f))))
    } finally {
      setBusy(false)
    }
  }

  // ---- saving, opening, autosave
  const rememberRecent = async (file, s) => {
    let thumb = thumbRef.current
    try {
      const k = 256 / Math.max(s.canvas.w, s.canvas.h)
      const data = await exportImage(s, { scale: Math.min(1, k), type: 'image/png' })
      thumb = await window.api.saveThumb({ key: file, data, replace: thumbRef.current })
      thumbRef.current = thumb
    } catch {}
    window.api.recentAdd({
      path: file,
      name: file.split(/[\\/]/).pop().replace(/\.json$/i, ''),
      kind: 'image',
      thumb,
      clips: s.overlayClips.length,
      duration: 0,
      size: `${s.canvas.w}×${s.canvas.h}`,
    })
  }
  const loadFromJson = async (json, file) => {
    setBusy(true)
    try {
      const r = await restoreImage(json)
      dispatch({ type: 'loadImageProject', ...r })
      setProjectPath(file)
      savedJson.current = file ? serializeImage({ ...initialState, ...r }) : serializeImage(initialState)
      autosavedJson.current = ''
      if (file) rememberRecent(file, { ...initialState, ...r })
      flash(r.missing.length ? `Some pictures could not be found: ${r.missing.join(', ')}` : file ? 'Project opened.' : 'Previous session restored.')
    } catch (e) {
      window.alert('Could not open that project:\n' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }
  const saveProject = async (asNew) => {
    const s = stateRef.current
    const json = serializeImage(s)
    const file = await window.api.saveProject(asNew ? null : projectRef.current, json, `${projectName === 'Untitled' ? 'My picture' : projectName}.json`)
    if (!file) return false
    setProjectPath(file)
    savedJson.current = json
    setDirty(false)
    window.api.clearAutosave(tabId)
    rememberRecent(file, s)
    flash('Project saved.')
    return true
  }
  useEffect(() => {
    if (initial && initial.json) loadFromJson(initial.json, initial.file)
  }, [])
  useEffect(() => {
    registerHandle(tabId, { save: () => saveProject(false), isDirty: () => dirtyRef.current, getState: () => stateRef.current, dispatch })
    return () => registerHandle(tabId, null)
  }, [])
  useEffect(() => {
    onMeta(tabId, { title: projectName, path: projectPath, dirty, kind: 'image' })
  }, [projectName, projectPath, dirty])
  useEffect(() => {
    const t = setTimeout(() => setDirty(serializeImage(state) !== savedJson.current), 600)
    return () => clearTimeout(t)
  }, [state.media, state.overlayClips, state.videoTracks, state.rowOrder, state.lockedRows, state.hiddenRows, state.canvas, projectPath])
  useEffect(() => {
    const id = setInterval(async () => {
      const json = serializeImage(stateRef.current)
      if (json === savedJson.current) return
      if (projectRef.current) {
        await window.api.saveProject(projectRef.current, json)
        savedJson.current = json
        setDirty(false)
      } else if (json !== autosavedJson.current) {
        await window.api.autosave(tabId, json)
        autosavedJson.current = json
      }
    }, 15000)
    return () => clearInterval(id)
  }, [])

  // ---- keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (!activeRef.current) return
      const tag = e.target.tagName
      // sliders, colour boxes and tick boxes keep the focus after a click: shortcuts must still work then
      const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['range', 'checkbox', 'color', 'radio', 'button'].includes(e.target.type))
      if (typing) return
      const action = actionFor(binds, e)
      const h = {
        save: () => saveProject(false),
        saveAs: () => saveProject(true),
        open: onOpen,
        undo: () => dispatch({ type: 'undo' }),
        redo: () => dispatch({ type: 'redo' }),
        delete: () => stateRef.current.selection.forEach((id) => dispatch({ type: 'imgRemove', id })),
        duplicate: () => stateRef.current.selection.forEach((id) => dispatch({ type: 'imgDuplicate', id })),
      }
      if (action && h[action]) {
        e.preventDefault()
        return h[action]()
      }
      // single letters pick a tool (not while Ctrl / Alt is held)
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        const t = TOOLS.find((x) => x.key === e.key.toUpperCase())
        if (t) {
          e.preventDefault()
          setTool(t.id)
        } else if (e.key.toUpperCase() === 'T') {
          e.preventDefault()
          dispatch({ type: 'imgAddText' })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [binds, mode])

  if (active) window.__vibe = { dispatch, state, addMedia: (items) => dispatch({ type: 'addMedia', items }) } // used by the developer self-test

  const sizeLabel = `${state.canvas.w} × ${state.canvas.h}`

  return (
    <div className="app" style={{ display: active ? undefined : 'none' }} onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles}>
      <header className="topbar">
        <button onClick={onNew} title="Start another project in a new tab">New</button>
        <button onClick={onOpen} title="Open a project in a new tab">Open…</button>
        <button onClick={() => saveProject(false)}>Save</button>
        <button onClick={() => saveProject(true)}>Save as…</button>
        <button onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length} title="Undo (Ctrl+Z)"><Icon name="undo" size={14} /></button>
        <button onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length} title="Redo (Ctrl+Y)"><Icon name="redo" size={14} /></button>
        <span className="proj-name">{projectName}{dirty ? ' •' : ''}</span>
        <span className="canvas-size" title="The size of the canvas, in pixels">{sizeLabel}</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setShowExport(true)} disabled={!state.overlayClips.length}>
          <Icon name="upload" /> Export picture…
        </button>
      </header>
      <div className="top">
        <div className="toolbar-v">
          {TOOLS.map((t) => (
            <button key={t.id} className={'tool-btn' + (tool === t.id ? ' on' : '')} title={t.label} onClick={() => setTool(t.id)}>
              <Icon name={t.icon} size={17} />
            </button>
          ))}
          <button className="tool-btn" title="Add text (T)" onClick={() => dispatch({ type: 'imgAddText' })}>
            <Icon name="type" size={17} />
          </button>
        </div>
        <LayersPanel state={state} dispatch={dispatch} open={layersOpen} setOpen={setLayersOpen} onAddPicture={importPictures} busy={busy} />
        <main className="stage">
          <ImagePreview state={state} dispatch={dispatch} mode={mode} setMode={setMode} freeMode={freeMode} tool={tool} brush={brush} setBrush={setBrush} canvasRef={canvasRef} />
          <div className="note-line">{note}</div>
        </main>
        <ImageInspector state={state} dispatch={dispatch} mode={mode} setMode={setMode} freeMode={freeMode} setFreeMode={setFreeMode} tool={tool} brush={brush} setBrush={setBrush} open={inspOpen} setOpen={setInspOpen} />
      </div>
      {showExport && <ExportPictureDialog state={state} name={projectName === 'Untitled' ? 'My picture' : projectName} onClose={() => setShowExport(false)} flash={flash} />}
    </div>
  )
}

// Export: PNG (keeps see-through parts), JPG (smaller) or WebP; at the canvas size or bigger / smaller
function ExportPictureDialog({ state, name, onClose, flash }) {
  const [fmt, setFmt] = useState('png')
  const [scale, setScale] = useState(1)
  const [quality, setQuality] = useState(92)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const w = Math.round(state.canvas.w * scale)
  const h = Math.round(state.canvas.h * scale)
  const go = async () => {
    setBusy(true)
    setErr('')
    try {
      const type = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[fmt]
      const data = await exportImage(state, { scale, type, quality: quality / 100 })
      const file = await window.api.saveImage({ data, name, ext: fmt })
      if (file) {
        flash('Picture saved.')
        onClose()
      }
    } catch (e) {
      setErr(String((e && e.message) || e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-bg">
      <div className="modal">
        <h3>Export picture</h3>
        <div className="mtop">
          <span className="mlabel">Format</span>
          <select value={fmt} onChange={(e) => setFmt(e.target.value)}>
            <option value="png">PNG (best quality, keeps see-through)</option>
            <option value="jpg">JPG (smaller file)</option>
            <option value="webp">WebP (small, keeps see-through)</option>
          </select>
        </div>
        <div className="mtop">
          <span className="mlabel">Size</span>
          <select value={scale} onChange={(e) => setScale(+e.target.value)}>
            {[0.25, 0.5, 1, 2, 3].map((k) => (
              <option key={k} value={k}>{k === 1 ? 'Original' : `${k * 100}%`}</option>
            ))}
          </select>
          <span className="hint-sm">{w} × {h}</span>
        </div>
        {fmt !== 'png' && (
          <div className="mtop">
            <span className="mlabel">Quality {quality}%</span>
            <input type="range" min="40" max="100" value={quality} onChange={(e) => setQuality(+e.target.value)} />
          </div>
        )}
        {fmt === 'jpg' && state.canvas.bg === 'transparent' && <p className="hint-sm">JPG cannot be see-through: the transparent parts become white.</p>}
        {err && <p className="hint-sm" style={{ color: 'var(--love, #eb6f92)' }}>{err}</p>}
        <div className="btn-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={go} disabled={busy}>{busy ? 'Working…' : 'Save picture…'}</button>
        </div>
      </div>
    </div>
  )
}
