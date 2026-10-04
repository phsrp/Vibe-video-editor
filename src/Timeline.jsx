import { useEffect, useRef, useState } from 'react'
import { keyTimes } from './motion.js'
import Icon from './Icon.jsx'
import Wave from './Wave.jsx'
import { layout, audioLayout, overlayLayout, streamCount, projectDuration, rowKeys, audioSource, fmtTime, toUrl, uid, hasAttached, canGroup, canUngroup } from './state.js'

const TRACK_PAD = 12
const LABEL = 160
const H_VIDEO = 76
const H_AUDIO = 44

// a stable colour per group, shown as a stripe on every member
const groupColor = (g) => {
  let h = 0
  for (const ch of g) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h}, 75%, 62%)`
}

// The left part of a row: a grip to drag the row up or down, the name (double-click to rename) and,
// for audio rows, mute and volume.
function RowLabel({ name, sub, volume, mute, onVolume, onMute, onRemove, onRename, onGrip }) {
  const [edit, setEdit] = useState(false)
  const done = (v) => {
    setEdit(false)
    if (v && v.trim() && v.trim() !== name) onRename(v.trim())
  }
  return (
    <div className="tl-label" style={{ width: LABEL }} onPointerDown={onGrip} title="Drag up or down to move this track">
      <div className="tl-label-top">
        <span className="grip"><Icon name="grip" size={12} /></span>
        {edit ? (
          <input
            className="name-edit"
            autoFocus
            defaultValue={name}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => done(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') done(e.target.value)
              else if (e.key === 'Escape') setEdit(false)
            }}
          />
        ) : (
          <span className="tl-name" title={name + ' (double-click to rename)'} onDoubleClick={() => setEdit(true)}>{name}</span>
        )}
        {onMute && (
          <button className={'mini' + (mute ? ' on' : '')} title={mute ? 'Unmute' : 'Mute'} onClick={onMute}>
            <Icon name={mute ? 'mute' : 'volume'} size={13} />
          </button>
        )}
        {onRemove && (
          <button className="mini" title="Remove this track" onClick={onRemove}><Icon name="x" size={12} /></button>
        )}
      </div>
      {sub && <div className="tl-sub" title={sub}>{sub}</div>}
      {onVolume && <input type="range" min="0" max="1" step="0.01" value={volume} title={`Volume ${Math.round(volume * 100)}%`} onChange={(e) => onVolume(+e.target.value)} />}
    </div>
  )
}
export default function Timeline({ state, dispatch, zoom, setZoom, splitKey, freezeKey, groupKey, ungroupKey, onFreeze, onKeybinds }) {
  const scrollRef = useRef(null)
  const innerRef = useRef(null)
  const trackRef = useRef(null) // the ruler lane: reference for time <-> pixel conversion
  const scrubbing = useRef(false)
  const [drag, setDrag] = useState(null) // {id, dx, target}
  const [dropIdx, setDropIdx] = useState(null)
  const [marquee, setMarquee] = useState(null) // {x0,y0,x1,y1} in timeline-content pixels
  const [rowDrag, setRowDrag] = useState(null) // {key, to}: a track being dragged up or down
  const [showAdd, setShowAdd] = useState(false) // the 'Add track' popup
  const rowEls = useRef({})

  const clips = layout(state.clips)
  const aclips = audioLayout(state.audioClips)
  const oclips = overlayLayout(state.overlayClips)
  const keys = rowKeys(state)
  const total = Math.max(projectDuration(state), ...aclips.map((a) => a.start + a.dur), 0)
  const nStreams = streamCount(state)
  const width = LABEL + TRACK_PAD * 2 + Math.max(total + 15, 40) * zoom
  const mediaOf = (c) => state.media.find((m) => m.id === c.mediaId)
  const sel = new Set(state.selection)

  // Keep the playhead in view: page the timeline when it nears the right edge (or leaves the left).
  useEffect(() => {
    const el = scrollRef.current
    if (!el || scrubbing.current) return
    const x = LABEL + TRACK_PAD + state.playhead * zoom
    const view = el.clientWidth
    if (x > el.scrollLeft + view - 40 || x < el.scrollLeft + LABEL) {
      if (state.playing || x < el.scrollLeft + LABEL || x > el.scrollLeft + view) el.scrollLeft = Math.max(0, x - view * 0.2)
    }
  }, [state.playhead, state.playing, zoom])

  const indexAtX = (x, skip) => {
    let i = 0
    for (const c of clips) {
      if (skip && skip.has(c.id)) continue
      if ((c.start + c.dur / 2) * zoom < x) i++
    }
    return i
  }
  const localX = (clientX) => clientX - trackRef.current.getBoundingClientRect().left - TRACK_PAD

  // Pointer-drag helper with edge auto-scroll. onMove(clientX, clientY) is called on every move and
  // every frame while the pointer sits near the edge of the timeline (so content keeps scrolling).
  const trackPointer = (e, { onMove, onEnd, scrollX = true, scrollY = false }) => {
    let last = { x: e.clientX, y: e.clientY }
    let prev = performance.now()
    let raf
    const loop = (now) => {
      const dt = Math.min(0.05, (now - prev) / 1000)
      prev = now
      const el = scrollRef.current
      const r = el.getBoundingClientRect()
      const zone = 60
      let vx = 0
      let vy = 0
      if (scrollX) {
        if (last.x > r.right - zone) vx = Math.min(500, 60 + (last.x - (r.right - zone)) * 8)
        else if (last.x < r.left + LABEL + zone) vx = -Math.min(500, 60 + (r.left + LABEL + zone - last.x) * 8)
      }
      if (scrollY) {
        if (last.y > r.bottom - 30) vy = Math.min(400, 60 + (last.y - (r.bottom - 30)) * 8)
        else if (last.y < r.top + 56) vy = -Math.min(400, 60 + (r.top + 56 - last.y) * 8)
      }
      if (vx || vy) {
        el.scrollLeft += vx * dt
        el.scrollTop += vy * dt
        onMove(last.x, last.y)
      }
      raf = requestAnimationFrame(loop)
    }
    const move = (ev) => {
      last = { x: ev.clientX, y: ev.clientY }
      onMove(last.x, last.y)
    }
    const up = (ev) => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onEnd && onEnd(ev)
    }
    raf = requestAnimationFrame(loop)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- playhead scrubbing on the ruler
  const scrub = (e) => {
    scrubbing.current = true
    const apply = (x) => dispatch({ type: 'setPlayhead', t: Math.min(Math.max(0, localX(x) / zoom), total), user: true })
    apply(e.clientX)
    trackPointer(e, {
      onMove: (x) => apply(x),
      onEnd: () => {
        scrubbing.current = false
      },
    })
  }

  // ---- drag-select (like dragging a box around icons in Explorer)
  const startMarquee = (e) => {
    if (e.button !== 0) return
    if (e.target.closest('.clip, .aclip, .tl-label, .ruler-row, button, input')) return
    const additive = e.ctrlKey || e.shiftKey
    const base = additive ? state.selection : []
    if (!additive) dispatch({ type: 'select', id: null })
    const el = innerRef.current
    const inner = () => el.getBoundingClientRect()
    const start = { x: e.clientX - inner().left, y: e.clientY - inner().top }
    let moved = false
    trackPointer(e, {
      scrollY: true,
      onMove: (cx, cy) => {
        const r = inner()
        const x1 = cx - r.left
        const y1 = cy - r.top
        if (!moved && Math.abs(x1 - start.x) < 4 && Math.abs(y1 - start.y) < 4) return
        moved = true
        setMarquee({ x0: start.x, y0: start.y, x1, y1 })
        const L = r.left + Math.min(start.x, x1)
        const R = r.left + Math.max(start.x, x1)
        const T = r.top + Math.min(start.y, y1)
        const B = r.top + Math.max(start.y, y1)
        const hits = []
        el.querySelectorAll('[data-sel]').forEach((n) => {
          const b = n.getBoundingClientRect()
          if (b.right >= L && b.left <= R && b.bottom >= T && b.top <= B) hits.push(n.dataset.sel)
        })
        dispatch({ type: 'selectMany', ids: [...new Set([...base, ...hits])] })
      },
      onEnd: () => setMarquee(null),
    })
  }

  // ---- drag a video clip body to reorder (the whole selection / group moves together)
  const startMove = (e, c) => {
    if (e.button !== 0) return
    const mod = e.ctrlKey || e.shiftKey
    const wasSelected = sel.has(c.id)
    if (mod) dispatch({ type: 'select', id: c.id, additive: true })
    else if (!wasSelected) dispatch({ type: 'select', id: c.id })
    // which video clips travel with this one
    const ids = new Set(
      wasSelected ? clips.filter((x) => sel.has(x.id)).map((x) => x.id) : c.groupId ? clips.filter((x) => x.groupId === c.groupId).map((x) => x.id) : [c.id]
    )
    ids.add(c.id)
    const x0 = e.clientX
    let moved = false
    const targetFor = (dx) => indexAtX((c.start + c.dur / 2) * zoom + dx, ids)
    const move = (ev) => {
      const dx = ev.clientX - x0
      if (!moved && Math.abs(dx) < 4) return
      moved = true
      setDrag({ ids, dx, target: targetFor(dx) })
    }
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) dispatch({ type: 'moveClips', ids: [...ids], toIndex: targetFor(ev.clientX - x0) })
      else if (wasSelected && !mod) dispatch({ type: 'select', id: c.id })
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // ---- keyframe markers on a clip: click = jump to it, drag = move it in time
  const startKfDrag = (e, c, t0) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    dispatch({ type: 'select', id: c.id })
    dispatch({ type: 'setPlayhead', t: c.start + (t0 - c.in), user: true })
    const x0 = e.clientX
    let cur = t0
    let started = false
    const move = (ev) => {
      if (!started && Math.abs(ev.clientX - x0) < 3) return
      if (!started) {
        started = true
        dispatch({ type: 'checkpoint' })
      }
      const nt = Math.min(c.out, Math.max(c.in, t0 + (ev.clientX - x0) / zoom))
      dispatch({ type: 'moveKeyframes', id: c.id, from: cur, to: nt })
      dispatch({ type: 'setPlayhead', t: c.start + (nt - c.in), user: true })
      cur = nt
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- drag the left/right edge of a video clip to trim
  const startTrim = (e, c, side) => {
    e.stopPropagation()
    e.preventDefault()
    dispatch({ type: 'select', id: c.id })
    dispatch({ type: 'checkpoint' })
    const x0 = e.clientX
    const base = side === 'in' ? c.in : c.out
    const move = (ev) => dispatch({ type: 'trim', id: c.id, side, value: base + (ev.clientX - x0) / zoom })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- attached audio boxes: click to select (their video clip's audio)
  const clickStream = (e, c, n) => {
    if (e.button !== 0) return
    e.stopPropagation()
    dispatch({ type: 'select', id: `sa:${c.id}:${n}`, additive: e.ctrlKey || e.shiftKey })
  }

  // ---- audio clips: drag to move (all selected audio clips move together), drag edges to trim
  const startMoveAudio = (e, a) => {
    if (e.button !== 0) return
    const mod = e.ctrlKey || e.shiftKey
    const wasSelected = sel.has(a.id)
    let ids = state.selection
    if (mod) {
      dispatch({ type: 'select', id: a.id, additive: true })
      ids = wasSelected ? state.selection.filter((x) => x !== a.id) : [...state.selection, a.id, ...aclips.filter((x) => a.groupId && x.groupId === a.groupId).map((x) => x.id)]
    } else if (!wasSelected) {
      dispatch({ type: 'select', id: a.id })
      ids = a.groupId ? aclips.filter((x) => x.groupId === a.groupId).map((x) => x.id) : [a.id]
    }
    const bases = aclips.filter((x) => ids.includes(x.id)).map((x) => ({ id: x.id, start: x.start }))
    const x0 = e.clientX
    let started = false
    const move = (ev) => {
      if (!started && Math.abs(ev.clientX - x0) < 4) return
      if (!started) {
        started = true
        dispatch({ type: 'checkpoint' })
      }
      const dt = (ev.clientX - x0) / zoom
      // keep the group together even if the earliest clip hits time 0
      const minStart = Math.min(...bases.map((b) => b.start))
      const d = Math.max(dt, -minStart)
      dispatch({ type: 'moveAudioBatch', moves: bases.map((b) => ({ id: b.id, start: b.start + d })) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!started && wasSelected && !mod) dispatch({ type: 'select', id: a.id })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const startTrimAudio = (e, a, side) => {
    e.stopPropagation()
    e.preventDefault()
    dispatch({ type: 'select', id: a.id })
    dispatch({ type: 'checkpoint' })
    const x0 = e.clientX
    const base = side === 'in' ? a.in : a.out
    const move = (ev) => dispatch({ type: 'trimAudio', id: a.id, side, value: base + (ev.clientX - x0) / zoom })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- overlay clips: drag to move in time (or onto another video track), drag edges to trim
  const startMoveOverlay = (e, c) => {
    if (e.button !== 0) return
    const mod = e.ctrlKey || e.shiftKey
    const wasSelected = sel.has(c.id)
    const groupIds = (g) => (g ? [...oclips, ...aclips].filter((x) => x.groupId === g).map((x) => x.id) : [])
    let ids = state.selection
    if (mod) {
      dispatch({ type: 'select', id: c.id, additive: true })
      ids = wasSelected ? state.selection.filter((x) => x !== c.id) : [...state.selection, c.id, ...groupIds(c.groupId)]
    } else if (!wasSelected) {
      dispatch({ type: 'select', id: c.id })
      ids = [c.id, ...groupIds(c.groupId)]
    }
    const bases = [...oclips, ...aclips].filter((x) => ids.includes(x.id)).map((x) => ({ id: x.id, start: x.start, trackId: x.trackId }))
    const x0 = e.clientX
    let started = false
    const trackUnder = (y) => {
      for (const k of keys) {
        if (!k.startsWith('v:')) continue
        const el = rowEls.current[k]
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (y >= r.top && y < r.bottom) return k.slice(2)
      }
      return null
    }
    const move = (ev) => {
      if (!started && Math.abs(ev.clientX - x0) < 4) return
      if (!started) {
        started = true
        dispatch({ type: 'checkpoint' })
      }
      const dt = (ev.clientX - x0) / zoom
      const minStart = Math.min(...bases.map((b) => b.start))
      const d = Math.max(dt, -minStart)
      const tr = trackUnder(ev.clientY)
      dispatch({ type: 'moveItems', moves: bases.map((b) => ({ id: b.id, start: b.start + d, trackId: b.id === c.id ? tr || b.trackId : undefined })) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!started && wasSelected && !mod) dispatch({ type: 'select', id: c.id })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const startTrimOverlay = (e, c, side) => {
    e.stopPropagation()
    e.preventDefault()
    dispatch({ type: 'select', id: c.id })
    dispatch({ type: 'checkpoint' })
    const x0 = e.clientX
    const base = side === 'in' ? c.in : c.out
    const move = (ev) => dispatch({ type: 'trimOverlay', id: c.id, side, value: base + (ev.clientX - x0) / zoom })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onOverlayDrop = (e, trackId) => {
    const id = e.dataTransfer.getData('text/vibe-media')
    if (!id) return
    e.preventDefault()
    dispatch({ type: 'addOverlayClip', mediaId: id, trackId, start: Math.max(0, localX(e.clientX) / zoom) })
  }

  // ---- drag a whole track (a row) up or down, over the others
  const startRowDrag = (e, key) => {
    if (e.button !== 0 || e.target.closest('button, input')) return
    e.preventDefault()
    const targetFor = (y) => {
      let idx = 0
      for (const k of keys) {
        if (k === key) continue
        const el = rowEls.current[k]
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (y > r.top + r.height / 2) idx++
      }
      return idx
    }
    let moved = false
    const y0 = e.clientY
    trackPointer(e, {
      scrollX: false,
      scrollY: true,
      onMove: (x, y) => {
        if (!moved && Math.abs(y - y0) < 5) return
        moved = true
        setRowDrag({ key, to: targetFor(y) })
      },
      onEnd: (ev) => {
        if (moved) dispatch({ type: 'moveRow', key, toIndex: targetFor(ev.clientY) })
        setRowDrag(null)
      },
    })
  }

  // ---- drops from the media bin
  const hasMedia = (e) => e.dataTransfer.types.includes('text/vibe-media')
  const onVideoDragOver = (e) => {
    if (!hasMedia(e)) return
    e.preventDefault()
    setDropIdx(indexAtX(localX(e.clientX), null))
  }
  const onVideoDrop = (e) => {
    const id = e.dataTransfer.getData('text/vibe-media')
    if (!id) return
    e.preventDefault()
    dispatch({ type: 'addClip', mediaId: id, index: indexAtX(localX(e.clientX), null) })
    setDropIdx(null)
  }
  const onAudioDrop = (e, trackId) => {
    const id = e.dataTransfer.getData('text/vibe-media')
    if (!id) return
    e.preventDefault()
    dispatch({ type: 'addAudioClip', mediaId: id, trackId, start: Math.max(0, localX(e.clientX) / zoom) })
  }

  const onWheel = (e) => {
    if (e.ctrlKey) {
      e.preventDefault()
      setZoom((z) => Math.min(400, Math.max(10, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))
    }
  }

  // ruler ticks
  const step = zoom >= 150 ? 1 : zoom >= 60 ? 2 : zoom >= 30 ? 5 : 10
  const ticks = []
  for (let s = 0; s <= total + 15; s += step) ticks.push(s)

  // where a drop/move indicator should be drawn
  const indicatorIdx = drag ? drag.target : dropIdx
  let indicatorX = null
  if (indicatorIdx != null) {
    const others = clips.filter((c) => !drag || !drag.ids.has(c.id))
    const lastO = others[others.length - 1]
    indicatorX = indicatorIdx >= others.length ? (lastO ? (lastO.start + lastO.dur) * zoom : 0) : others[indicatorIdx].start * zoom
  }

  const groupOk = canGroup(state)
  const ungroupOk = canUngroup(state)

  const streamName = (n) => `Video audio ${n + 1}`
  const streamSub = (n) => {
    for (const m of state.media) if (m.type === 'video' && m.audioStreams && m.audioStreams[n] && m.audioStreams[n].title) return m.audioStreams[n].title
    return ''
  }
  const clipAudioName = (a) => {
    const m = state.media.find((x) => x.id === a.mediaId)
    if (!m) return ''
    return a.stream != null ? `${m.name} (audio ${a.stream + 1})` : m.name
  }

  // ---- the rows (tracks), in the order the user arranged them
  const rowClass = (key) => {
    if (!rowDrag) return ''
    if (rowDrag.key === key) return ' row-dragging'
    const others = keys.filter((k) => k !== rowDrag.key)
    const at = others.indexOf(key)
    if (at === rowDrag.to) return ' drop-above'
    if (rowDrag.to >= others.length && at === others.length - 1) return ' drop-below'
    return ''
  }
  const rowRef = (key) => (el) => {
    if (el) rowEls.current[key] = el
    else delete rowEls.current[key]
  }

  const renderMain = (key) => (
    <div className={'tl-row' + rowClass(key)} key={key} ref={rowRef(key)} style={{ height: H_VIDEO }}>
      <RowLabel name={state.mainName} sub="Main video (plays one clip after another)" onRename={(name) => dispatch({ type: 'renameRow', key, name })} onGrip={(e) => startRowDrag(e, key)} />
      <div className="lane" onDragOver={onVideoDragOver} onDragLeave={() => setDropIdx(null)} onDrop={onVideoDrop}>
        <div className="lane-inner" style={{ left: TRACK_PAD }}>
          {clips.map((c) => {
            const m = mediaOf(c)
            if (!m) return null
            const dragging = drag && drag.ids.has(c.id)
            const nAtt = m.type === 'video' ? (m.audioStreams || []).filter((_, n) => hasAttached(c, m, n)).length : 0
            const silenced = m.type === 'video' && (m.audioStreams || []).length > 0 && nAtt === 0
            return (
              <div
                key={c.id}
                data-sel={c.id}
                className={'clip ' + m.type + (sel.has(c.id) ? ' selected' : '') + (dragging ? ' dragging' : '') + (c.groupId ? ' grouped' : '')}
                style={{
                  left: c.start * zoom,
                  width: Math.max(4, c.dur * zoom),
                  transform: dragging ? `translateX(${drag.dx}px)` : undefined,
                  backgroundImage: m.thumb ? `url("${toUrl(m.thumb)}")` : undefined,
                  '--gcol': c.groupId ? groupColor(c.groupId) : undefined,
                }}
                onPointerDown={(e) => startMove(e, c)}
              >
                {c.ov > 0 && (
                  <div className="tr-zone" style={{ width: c.ov * zoom }} title={c.transition.name}>
                    <span>{c.ov * zoom > 40 ? c.transition.name : '•'}</span>
                  </div>
                )}
                {keyTimes(c)
                  .filter((t) => t >= c.in - 0.001 && t <= c.out + 0.001)
                  .map((t) => (
                    <div key={t.toFixed(3)} className="kf" style={{ left: (t - c.in) * zoom }} onPointerDown={(e) => startKfDrag(e, c, t)} title="Keyframe: click to jump to it, drag to move it" />
                  ))}
                <div className="handle left" onPointerDown={(e) => startTrim(e, c, 'in')} />
                <span className="clip-name">{c.groupId && <Icon name="link" size={11} />}{m.name}</span>
                <span className="clip-dur">{c.dur.toFixed(1)}s{silenced ? ' · no audio' : ''}</span>
                <div className="handle right" onPointerDown={(e) => startTrim(e, c, 'out')} />
              </div>
            )
          })}
          {indicatorX != null && <div className="insert-line" style={{ left: indicatorX }} />}
        </div>
        {!clips.length && <div className="empty-hint">Drag media here, or double-click an item in the Media panel</div>}
      </div>
    </div>
  )

  const renderOverlay = (key) => {
    const tr = state.videoTracks.find((x) => x.id === key.slice(2))
    if (!tr) return null
    return (
      <div className={'tl-row' + rowClass(key)} key={key} ref={rowRef(key)} style={{ height: H_VIDEO }}>
        <RowLabel
          name={tr.name}
          sub="Overlay: sits on top of the video below it"
          onRename={(name) => dispatch({ type: 'renameRow', key, name })}
          onGrip={(e) => startRowDrag(e, key)}
          onRemove={() => dispatch({ type: 'removeVideoTrack', id: tr.id })}
        />
        <div className="lane" onDragOver={(e) => hasMedia(e) && e.preventDefault()} onDrop={(e) => onOverlayDrop(e, tr.id)}>
          <div className="lane-inner" style={{ left: TRACK_PAD }}>
            {oclips
              .filter((c) => c.trackId === tr.id)
              .map((c) => {
                const m = mediaOf(c)
                if (!m) return null
                return (
                  <div
                    key={c.id}
                    data-sel={c.id}
                    className={'clip overlay ' + m.type + (sel.has(c.id) ? ' selected' : '') + (c.groupId ? ' grouped' : '')}
                    style={{
                      left: c.start * zoom,
                      width: Math.max(4, c.dur * zoom),
                      backgroundImage: m.thumb ? `url("${toUrl(m.thumb)}")` : undefined,
                      '--gcol': c.groupId ? groupColor(c.groupId) : undefined,
                    }}
                    onPointerDown={(e) => startMoveOverlay(e, c)}
                  >
                    {keyTimes(c)
                      .filter((t) => t >= c.in - 0.001 && t <= c.out + 0.001)
                      .map((t) => (
                        <div key={t.toFixed(3)} className="kf" style={{ left: (t - c.in) * zoom }} onPointerDown={(e) => startKfDrag(e, c, t)} title="Keyframe: click to jump to it, drag to move it" />
                      ))}
                    <div className="handle left" onPointerDown={(e) => startTrimOverlay(e, c, 'in')} />
                    <span className="clip-name">{c.groupId && <Icon name="link" size={11} />}{m.name}</span>
                    <span className="clip-dur">{c.dur.toFixed(1)}s</span>
                    <div className="handle right" onPointerDown={(e) => startTrimOverlay(e, c, 'out')} />
                  </div>
                )
              })}
          </div>
          {!oclips.some((c) => c.trackId === tr.id) && <div className="empty-hint">Drag a video or image here</div>}
        </div>
      </div>
    )
  }

  const renderStream = (key) => {
    const n = +key.slice(2)
    const st = { volume: 1, mute: false, ...state.streamSettings[n] }
    return (
      <div className={'tl-row' + rowClass(key)} key={key} ref={rowRef(key)} style={{ height: H_AUDIO }}>
        <RowLabel
          name={st.name || streamName(n)}
          sub={streamSub(n)}
          volume={st.volume}
          mute={st.mute}
          onVolume={(v) => dispatch({ type: 'setStream', n, patch: { volume: v } })}
          onMute={() => dispatch({ type: 'setStream', n, patch: { mute: !st.mute } })}
          onRename={(name) => dispatch({ type: 'renameRow', key, name })}
          onGrip={(e) => startRowDrag(e, key)}
        />
        <div className="lane">
          <div className="lane-inner" style={{ left: TRACK_PAD }}>
            {clips.map((c) => {
              const m = mediaOf(c)
              if (!hasAttached(c, m, n)) return null
              const sid = `sa:${c.id}:${n}`
              return (
                <div
                  key={c.id}
                  data-sel={sid}
                  className={'aclip stream' + (st.mute ? ' muted' : '') + (sel.has(sid) ? ' selected' : '')}
                  style={{ left: c.start * zoom, width: Math.max(2, c.dur * zoom) }}
                  onPointerDown={(e) => clickStream(e, c, n)}
                >
                  <Wave file={(m.audioFiles || [])[n]} from={c.in} to={c.out} width={c.dur * zoom} height={H_AUDIO - 8} />
                  <span>{m.name}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const renderAudioTrack = (key) => {
    const t = state.audioTracks.find((x) => x.id === key.slice(2))
    if (!t) return null
    return (
      <div className={'tl-row' + rowClass(key)} key={key} ref={rowRef(key)} style={{ height: H_AUDIO }}>
        <RowLabel
          name={t.name}
          volume={t.volume}
          mute={t.mute}
          onVolume={(v) => dispatch({ type: 'setTrack', id: t.id, patch: { volume: v } })}
          onMute={() => dispatch({ type: 'setTrack', id: t.id, patch: { mute: !t.mute } })}
          onRemove={() => dispatch({ type: 'removeAudioTrack', id: t.id })}
          onRename={(name) => dispatch({ type: 'renameRow', key, name })}
          onGrip={(e) => startRowDrag(e, key)}
        />
        <div className="lane" onDragOver={(e) => hasMedia(e) && e.preventDefault()} onDrop={(e) => onAudioDrop(e, t.id)}>
          <div className="lane-inner" style={{ left: TRACK_PAD }}>
            {aclips
              .filter((a) => a.trackId === t.id)
              .map((a) => {
                const am = state.media.find((x) => x.id === a.mediaId)
                return (
                  <div
                    key={a.id}
                    data-sel={a.id}
                    className={'aclip' + (a.stream != null ? ' detached' : ' free') + (t.mute ? ' muted' : '') + (sel.has(a.id) ? ' selected' : '') + (a.groupId ? ' grouped' : '')}
                    style={{ left: a.start * zoom, width: Math.max(6, a.dur * zoom), '--gcol': a.groupId ? groupColor(a.groupId) : undefined }}
                    onPointerDown={(e) => startMoveAudio(e, a)}
                    title={clipAudioName(a)}
                  >
                    <Wave file={audioSource(a, am)} from={a.in} to={a.out} width={a.dur * zoom} height={H_AUDIO - 8} />
                    <div className="handle left" onPointerDown={(e) => startTrimAudio(e, a, 'in')} />
                    <span>{a.groupId && <Icon name="link" size={11} />}{clipAudioName(a)}</span>
                    <div className="handle right" onPointerDown={(e) => startTrimAudio(e, a, 'out')} />
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    )
  }

  const renderRow = (key) => {
    if (key === 'main') return renderMain(key)
    if (key.startsWith('v:')) return renderOverlay(key)
    if (key.startsWith('s:')) return renderStream(key)
    return renderAudioTrack(key)
  }

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <button onClick={() => dispatch({ type: 'split', t: state.playhead })} title="Split at playhead">
          <Icon name="scissors" /> Split{splitKey ? ` (${splitKey})` : ''}
        </button>
        <button onClick={onFreeze} title="Save the frame under the playhead as an image and insert it (you can then stretch it)">
          <Icon name="snowflake" /> Freeze frame{freezeKey ? ` (${freezeKey})` : ''}
        </button>
        <button disabled={!groupOk} onClick={() => dispatch({ type: 'group' })} title="Group the selected clips so they move together. Detached audio in the selection is attached back to its video.">
          <Icon name="link" /> Group{groupKey ? ` (${groupKey})` : ''}
        </button>
        <button disabled={!ungroupOk} onClick={() => dispatch({ type: 'ungroup' })} title="Break up the selected group. With no group selected: detach the selected audio (or all the audio of a selected video clip) so it can be moved, trimmed or deleted on its own.">
          <Icon name="unlink" /> Ungroup{ungroupKey ? ` (${ungroupKey})` : ''}
        </button>
        <button disabled={!state.selection.length} onClick={() => dispatch({ type: 'deleteSelection' })} title="Delete selected (Del)">
          <Icon name="trash" /> Delete
        </button>
        <button disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })} title="Ctrl+Z">
          <Icon name="undo" /> Undo
        </button>
        <button disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })} title="Ctrl+Y">
          <Icon name="redo" /> Redo
        </button>
        <button onClick={() => setShowAdd(true)} title="Add an overlay video track or an audio track">
          <Icon name="plus" size={13} /> Add track
        </button>
        <span className="spacer" />
        <button onClick={onKeybinds}>
          <Icon name="keyboard" /> Shortcuts
        </button>
        <label className="zoom">
          Zoom
          <input type="range" min="10" max="400" value={zoom} onChange={(e) => setZoom(+e.target.value)} />
        </label>
      </div>

      <div className="tl-scroll" ref={scrollRef} onWheel={onWheel}>
        <div className="tl-inner" ref={innerRef} style={{ width }} onPointerDown={startMarquee}>
          {/* ruler: stays pinned to the top while you scroll through the tracks */}
          <div className="tl-row ruler-row" style={{ height: 26 }}>
            <div className="tl-label ruler-label" style={{ width: LABEL }} />
            <div className="lane ruler" ref={trackRef} onPointerDown={scrub}>
              <div className="lane-inner" style={{ left: TRACK_PAD }}>
                {ticks.map((s) => (
                  <div key={s} className="tick" style={{ left: s * zoom }}>
                    <span>{fmtTime(s).slice(0, 5)}</span>
                  </div>
                ))}
                <div className="ruler-knob" style={{ left: Math.min(state.playhead, total + 15) * zoom }} />
              </div>
            </div>
          </div>

          {keys.map(renderRow)}

          <div className="playhead" style={{ left: LABEL + TRACK_PAD + Math.min(state.playhead, total + 15) * zoom }} />
          {marquee && (
            <div
              className="marquee"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}
        </div>
      </div>

      {showAdd && (
        <div className="modal-bg" onPointerDown={() => setShowAdd(false)}>
          <div className="modal add-track" onPointerDown={(e) => e.stopPropagation()}>
            <h3>Add a track</h3>
            <div className="hint left">Which kind of track do you want? You can drag any track up or down afterwards.</div>
            <div className="add-choices">
              <button
                onClick={() => {
                  dispatch({ type: 'addVideoTrack', id: uid() })
                  setShowAdd(false)
                }}
              >
                <Icon name="film" size={22} />
                <b>Video track</b>
                <span>An overlay layer: clips on it sit on top of the video below and can start at any time.</span>
              </button>
              <button
                onClick={() => {
                  dispatch({ type: 'addAudioTrack', id: uid() })
                  setShowAdd(false)
                }}
              >
                <Icon name="music" size={22} />
                <b>Audio track</b>
                <span>An extra lane for music, voice or sound effects.</span>
              </button>
            </div>
            <div className="modal-foot">
              <button onClick={() => setShowAdd(false)}>Cancel</button>
              <span />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
