import { useEffect, useReducer, useRef, useState } from 'react'
import { reducer, initialState, layout, totalDuration, fmtTime, toUrl } from './state.js'
import Preview from './Preview.jsx'
import Timeline from './Timeline.jsx'
import KeybindDialog from './KeybindDialog.jsx'
import Inspector from './Inspector.jsx'
import Icon from './Icon.jsx'
import ExportDialog from './ExportDialog.jsx'
import { serialize, restore } from './project.js'
import { actionFor } from './keybinds.js'

// One open project. Several of these can exist at once (one per tab); only the active one is shown
// and reacts to the keyboard, the others keep their state and wait.
export default function Editor({ tabId, active, initial, binds, setBinds, onMeta, onNew, onOpen, registerHandle }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state
  const activeRef = useRef(active)
  activeRef.current = active
  const [zoom, setZoom] = useState(80)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [transitions, setTransitions] = useState([])
  const [trErrors, setTrErrors] = useState({})
  const loadTransitions = async () => setTransitions(await window.api.listTransitions())
  useEffect(() => {
    loadTransitions()
  }, [])
  const [showKeys, setShowKeys] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [projectPath, setProjectPath] = useState(null)
  const projectRef = useRef(null)
  projectRef.current = projectPath
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const savedJson = useRef(serialize(initialState)) // what is on disk (or the empty project)
  const autosavedJson = useRef('')
  const projectName = projectPath ? projectPath.split(/[\\/]/).pop().replace(/\.json$/i, '') : 'Untitled'
  const total = totalDuration(state.clips)

  // Add imported files to the project, then prepare their audio streams in the background.
  const extractPending = (items) => {
    for (const it of items) {
      window.api.extractAudio(it.path, it.id, it.audioStreams).then((files) => dispatch({ type: 'updateMedia', id: it.id, patch: { audioFiles: files, audioPending: false } }))
    }
  }
  const addMedia = (items) => {
    const fresh = items.filter((i) => !stateRef.current.media.some((m) => m.id === i.id))
    dispatch({ type: 'addMedia', items })
    extractPending(fresh.filter((i) => i.audioPending))
  }

  if (active) window.__vibe = { dispatch, state, addMedia } // used by the developer self-test

  const flash = (msg) => {
    setNote(msg)
    setTimeout(() => setNote((n) => (n === msg ? '' : n)), 3500)
  }

  // a project that is not on screen must not keep playing
  useEffect(() => {
    if (!active) dispatch({ type: 'setPlaying', value: false })
  }, [active])

  const importFiles = async (kind) => {
    setBusy(true)
    try {
      const items = await window.api.importMedia(kind)
      if (items.length) addMedia(items)
    } finally {
      setBusy(false)
    }
  }

  // dropping files from Explorer onto the window
  const onDropFiles = async (e) => {
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f))
    setBusy(true)
    try {
      const items = await window.api.describeFiles(paths)
      if (items.length) addMedia(items)
    } finally {
      setBusy(false)
    }
  }

  // Freeze frame: save the exact frame under the playhead as an image and insert it.
  const freezeFrame = async () => {
    const s = stateRef.current
    const lay = layout(s.clips)
    const t = s.playhead
    const hit = lay.filter((c) => t >= c.start && t < c.start + c.dur)
    const c = hit.length ? hit[hit.length - 1] : lay[lay.length - 1]
    const m = c && s.media.find((x) => x.id === c.mediaId)
    if (!m || m.type !== 'video') return flash('Move the playhead over a video clip to freeze a frame.')
    const src = Math.min(c.in + (t - c.start), c.out - 0.01)
    setBusy(true)
    try {
      const item = await window.api.freezeFrame(m.path, src, `Freeze ${m.name} @${fmtTime(src).slice(0, 5)}`)
      dispatch({ type: 'insertFreeze', item, t })
      flash('Frame frozen. Drag its right edge (or use "Show for") to make it longer.')
    } catch {
      flash('Could not capture that frame.')
    } finally {
      setBusy(false)
    }
  }

  // ---- saving, opening, autosave
  const rememberRecent = (file, s) => {
    const first = s.clips.map((c) => s.media.find((m) => m.id === c.mediaId)).find((m) => m && m.thumb)
    window.api.recentAdd({ path: file, name: file.split(/[\\/]/).pop().replace(/\.json$/i, ''), thumb: first ? first.thumb : null, clips: s.clips.length, duration: totalDuration(s.clips) })
  }

  const loadFromJson = async (json, file) => {
    setBusy(true)
    try {
      const r = await restore(json)
      dispatch({ type: 'loadProject', media: r.media, clips: r.clips, audioClips: r.audioClips, audioTracks: r.audioTracks, streamSettings: r.streamSettings })
      setProjectPath(file)
      // a project opened from a file starts "clean"; one restored from autosave still needs saving
      savedJson.current = file ? serialize(r) : serialize(initialState)
      autosavedJson.current = ''
      extractPending(r.pending)
      if (file) rememberRecent(file, r)
      if (r.missing.length) flash(`Some files could not be found: ${r.missing.join(', ')}`)
      else flash(file ? 'Project opened.' : 'Previous session restored.')
    } catch (e) {
      window.alert('Could not open that project:\n' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const saveProject = async (asNew) => {
    const s = stateRef.current
    const json = serialize(s)
    const file = await window.api.saveProject(asNew ? null : projectRef.current, json, `${projectName === 'Untitled' ? 'My project' : projectName}.json`)
    if (!file) return false
    setProjectPath(file)
    savedJson.current = json
    setDirty(false)
    window.api.clearAutosave(tabId)
    rememberRecent(file, s)
    flash('Project saved.')
    return true
  }

  // load the project this tab was opened with
  useEffect(() => {
    if (initial && initial.json) loadFromJson(initial.json, initial.file)
  }, [])

  // let the tab bar ask this project to save (when closing a tab)
  useEffect(() => {
    registerHandle(tabId, { save: () => saveProject(false), isDirty: () => dirtyRef.current })
    return () => registerHandle(tabId, null)
  }, [])

  // tell the tab bar about the project's name and whether it has unsaved changes
  useEffect(() => {
    onMeta(tabId, { title: projectName, path: projectPath, dirty })
  }, [projectName, projectPath, dirty])

  // work out whether there are unsaved changes
  useEffect(() => {
    const t = setTimeout(() => setDirty(serialize(state) !== savedJson.current), 600)
    return () => clearTimeout(t)
  }, [state.media, state.clips, state.audioClips, state.audioTracks, state.streamSettings, projectPath])

  // autosave every 15 seconds: into the project file if it has one, otherwise a recovery copy
  useEffect(() => {
    const id = setInterval(async () => {
      const json = serialize(stateRef.current)
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

  useEffect(() => {
    const onKey = (e) => {
      if (!activeRef.current) return
      const tag = e.target.tagName
      if (showKeys || showExport || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const action = actionFor(binds, e)
      if (!action) return
      e.preventDefault()
      const h = {
        split: () => dispatch({ type: 'split', t: state.playhead }),
        freeze: freezeFrame,
        playPause: () => dispatch({ type: 'setPlaying', value: !state.playing }),
        delete: () => dispatch({ type: 'deleteSelection' }),
        group: () => dispatch({ type: 'group' }),
        ungroup: () => dispatch({ type: 'ungroup' }),
        save: () => saveProject(false),
        saveAs: () => saveProject(true),
        open: onOpen,
        export: () => setShowExport(true),
        undo: () => dispatch({ type: 'undo' }),
        redo: () => dispatch({ type: 'redo' }),
        stepBack: () => dispatch({ type: 'setPlayhead', t: state.playhead - 1 / 30, user: true }),
        stepForward: () => dispatch({ type: 'setPlayhead', t: Math.min(total, state.playhead + 1 / 30), user: true }),
        goStart: () => dispatch({ type: 'setPlayhead', t: 0, user: true }),
      }
      h[action]()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.playing, state.playhead, total, binds, showKeys, showExport])

  const addMediaToTimeline = (m) => {
    if (m.type === 'audio') dispatch({ type: 'addAudioClip', mediaId: m.id, trackId: null, start: state.playhead })
    else dispatch({ type: 'addClip', mediaId: m.id })
  }

  return (
    <div className="app" style={{ display: active ? undefined : 'none' }} onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles}>
      <header className="topbar">
        <button onClick={onNew} title="Start another project in a new tab">New</button>
        <button onClick={onOpen} title="Open a project in a new tab">Open…</button>
        <button onClick={() => saveProject(false)}>Save</button>
        <button onClick={() => saveProject(true)}>Save as…</button>
        <span className="proj-name">{projectName}{dirty ? ' •' : ''}</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setShowExport(true)} disabled={!state.clips.length}>
          <Icon name="upload" /> Export video…
        </button>
      </header>
      <div className="top">
        <aside className="bin">
          <div className="panel-title">
            Media
            <span className="btn-row">
              <button className="primary" onClick={() => importFiles('video')} disabled={busy}>
                {busy ? 'Working…' : '+ Video / image'}
              </button>
              <button onClick={() => importFiles('audio')} disabled={busy} title="Import extra audio files (music, voice, sound effects)">
                + Audio
              </button>
            </span>
          </div>
          <div className="bin-list">
            {state.media.length === 0 && <div className="hint">Import video, images or audio, or drop files here.</div>}
            {state.media.map((m) => (
              <div
                key={m.id}
                className="bin-item"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/vibe-media', m.id)}
                onDoubleClick={() => addMediaToTimeline(m)}
                title={m.type === 'audio' ? 'Drag onto an audio track, or double-click to add at the playhead' : 'Drag to the timeline, or double-click to add at the end'}
              >
                <div className="thumb" style={{ backgroundImage: m.thumb ? `url("${toUrl(m.thumb)}")` : undefined }}>
                  {m.type === 'audio' && <span className="note"><Icon name="music" size={22} /></span>}
                  <span className="badge">{m.type}</span>
                </div>
                <div className="meta">
                  <div className="name">{m.name}</div>
                  <div className="sub">
                    {m.type !== 'image' ? fmtTime(m.duration).slice(0, 5) : ''}
                    {m.type === 'video' || m.type === 'image' ? ` · ${m.width}×${m.height}` : ''}
                    {m.type === 'video' && m.audioStreams.length ? ` · ${m.audioStreams.length} audio` : ''}
                    {m.audioPending ? ' · preparing audio…' : ''}
                    {m.missing ? ' · file missing' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="stage">
          <Preview state={state} dispatch={dispatch} transitions={transitions} onCompiled={setTrErrors} active={active} />
          <div className="transport">
            <button onClick={() => dispatch({ type: 'setPlayhead', t: 0, user: true })} title="Go to start"><Icon name="skipBack" fill /></button>
            <button className="primary play" onClick={() => dispatch({ type: 'setPlaying', value: !state.playing })}>
              {state.playing ? <><Icon name="pause" fill /> Pause</> : <><Icon name="play" fill /> Play</>}
            </button>
            <span className="timecode">
              {fmtTime(state.playhead)} / {fmtTime(total)}
            </span>
          </div>
          <div className="note-line">{note}</div>
        </main>

        <Inspector
          state={state}
          dispatch={dispatch}
          transitions={transitions}
          errors={trErrors}
          onReload={loadTransitions}
          onOpenFolder={() => window.api.openTransitionsFolder()}
        />
      </div>

      <Timeline
        state={state}
        dispatch={dispatch}
        zoom={zoom}
        setZoom={setZoom}
        splitKey={binds.split}
        freezeKey={binds.freeze}
        groupKey={binds.group}
        ungroupKey={binds.ungroup}
        onFreeze={freezeFrame}
        onKeybinds={() => setShowKeys(true)}
      />
      {showExport && <ExportDialog state={state} transitions={transitions} projectName={projectName === 'Untitled' ? 'My video' : projectName} onClose={() => setShowExport(false)} />}
      {showKeys && <KeybindDialog binds={binds} setBinds={setBinds} onClose={() => setShowKeys(false)} />}
    </div>
  )
}
