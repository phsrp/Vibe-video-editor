import { useEffect, useRef, useState } from 'react'
import { keyTimes } from './motion.js'
import Icon from './Icon.jsx'
import { layout, audioLayout, streamCount, totalDuration, fmtTime, toUrl, uid, hasAttached, canGroup, canUngroup } from './state.js'

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

function TrackLabel({ name, sub, volume, mute, onVolume, onMute, onRemove }) {
  return (
    <div className="tl-label" style={{ width: LABEL }}>
      <div className="tl-label-top">
        <span className="tl-name" title={name}>{name}</span>
        <button className={'mini' + (mute ? ' on' : '')} title={mute ? 'Unmute' : 'Mute'} onClick={onMute}>
          <Icon name={mute ? 'mute' : 'volume'} size={13} />
        </button>
        {onRemove && (
          <button className="mini" title="Remove this track" onClick={onRemove}><Icon name="x" size={12} /></button>
        )}
      </div>
      {sub && <div className="tl-sub" title={sub}>{sub}</div>}
      <input type="range" min="0" max="1" step="0.01" value={volume} title={`Volume ${Math.round(volume * 100)}%`} onChange={(e) => onVolume(+e.target.value)} />
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

  const clips = layout(state.clips)
  const aclips = audioLayout(state.audioClips)
  const total = Math.max(totalDuration(state.clips), ...aclips.map((a) => a.start + a.dur), 0)
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
        <button onClick={() => dispatch({ type: 'addAudioTrack', id: uid() })} title="Add an empty audio track">
          + Audio track
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

          {/* video lane */}
          <div className="tl-row" style={{ height: H_VIDEO }}>
            <div className="tl-label" style={{ width: LABEL }}>
              <div className="tl-label-top"><span className="tl-name">Video</span></div>
            </div>
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

          {/* one lane per audio stream that is still attached to its video clips */}
          {Array.from({ length: nStreams }, (_, n) => {
            const st = { volume: 1, mute: false, ...state.streamSettings[n] }
            return (
              <div className="tl-row" key={'s' + n} style={{ height: H_AUDIO }}>
                <TrackLabel
                  name={streamName(n)}
                  sub={streamSub(n)}
                  volume={st.volume}
                  mute={st.mute}
                  onVolume={(v) => dispatch({ type: 'setStream', n, patch: { volume: v } })}
                  onMute={() => dispatch({ type: 'setStream', n, patch: { mute: !st.mute } })}
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
                          <span>{m.name}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}

          {/* extra audio tracks (imported audio files and detached video audio) */}
          {state.audioTracks.map((t) => (
            <div className="tl-row" key={t.id} style={{ height: H_AUDIO }}>
              <TrackLabel
                name={t.name}
                volume={t.volume}
                mute={t.mute}
                onVolume={(v) => dispatch({ type: 'setTrack', id: t.id, patch: { volume: v } })}
                onMute={() => dispatch({ type: 'setTrack', id: t.id, patch: { mute: !t.mute } })}
                onRemove={() => dispatch({ type: 'removeAudioTrack', id: t.id })}
              />
              <div className="lane" onDragOver={(e) => hasMedia(e) && e.preventDefault()} onDrop={(e) => onAudioDrop(e, t.id)}>
                <div className="lane-inner" style={{ left: TRACK_PAD }}>
                  {aclips
                    .filter((a) => a.trackId === t.id)
                    .map((a) => (
                      <div
                        key={a.id}
                        data-sel={a.id}
                        className={'aclip' + (a.stream != null ? ' detached' : ' free') + (t.mute ? ' muted' : '') + (sel.has(a.id) ? ' selected' : '') + (a.groupId ? ' grouped' : '')}
                        style={{ left: a.start * zoom, width: Math.max(6, a.dur * zoom), '--gcol': a.groupId ? groupColor(a.groupId) : undefined }}
                        onPointerDown={(e) => startMoveAudio(e, a)}
                        title={clipAudioName(a)}
                      >
                        <div className="handle left" onPointerDown={(e) => startTrimAudio(e, a, 'in')} />
                        <span>{a.groupId && <Icon name="link" size={11} />}{clipAudioName(a)}</span>
                        <div className="handle right" onPointerDown={(e) => startTrimAudio(e, a, 'out')} />
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ))}

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
    </div>
  )
}
