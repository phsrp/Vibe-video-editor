import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { layout, overlayLayout, soleVideoClip, srcAt, speedOf, aspectRatio } from './state.js'
import { evalTransform, evalProp, keyAt, PROPS, rectToFrame, frameToRect } from './motion.js'
import { maskPlaced, polyCentre, MAX_POLY, maskAt } from './masks.js'

// The question after a shape was drawn: follow the subject through the video, and for how long?
// Tracking follows the subject's outline: pixel motion (OpenCV.js) moves it, the AI snaps it to the real edge.
function TrackDialog({ clip, state, media, dispatch, onClose }) {
  const sp = speedOf(clip)
  const ts = srcAt(clip, state.playhead)
  const remain = Math.max(0.2, Math.round((clip.start + clip.dur - state.playhead) * 10) / 10)
  const [secs, setSecs] = useState(Math.min(5, remain))
  const [quad, setQuad] = useState(false) // straight edges, 4 corners (plates, screens, signs)
  const [prog, setProg] = useState(null) // [done, total] while tracking
  const [warn, setWarn] = useState(false) // no graphics card: very slow, asked once
  const [err, setErr] = useState('')
  const [gpu, setGpu] = useState(null) // the graphics card does the tracking, which is much faster
  useEffect(() => {
    import('./smartMask.js').then((m) => m.gpuInfo()).then(setGpu)
  }, [])
  const cancel = useRef(false)
  const canTrack = media && media.type === 'video' && clip.mask && clip.mask.shape === 'poly'
  const run = async (confirmed) => {
    cancel.current = false
    setErr('')
    try {
      const st = await window.api.modelsStatus()
      const { trackOutline, gpuInfo } = await import('./smartMask.js')
      const g = await gpuInfo()
      if (!g.ok) throw new Error('Tracking needs a graphics card, and this computer does not seem to have a usable one.')
      if (!st.ready) throw new Error('Download the AI model first: it is in the Mask section of the Inspector, under Smart select.')
      // basic integrated graphics: it will run, but slowly. Asked once.
      let warned = false
      try {
        warned = localStorage.getItem('vibe.slowGpuWarned') === '1'
      } catch (e) {}
      if (g.weak && !warned && !confirmed) return setWarn(true)
      if (g.weak && confirmed) {
        try {
          localStorage.setItem('vibe.slowGpuWarned', '1')
        } catch (e) {}
      }
      setWarn(false)
      setProg([0, 1])
      const span = Math.min(secs, remain)
      const end = Math.min(clip.out, Math.max(clip.in, clip.reverse ? ts - span * sp : ts + span * sp))
      const len = Math.abs(end - ts)
      // about 30 looks a second (fewer for a very long stretch); each look takes a fraction of a second on a graphics card
      const n = Math.max(2, Math.min(900, Math.round(len * 30)) + 1)
      const times = Array.from({ length: n }, (_, i) => ts + ((end - ts) * i) / (n - 1))
      const frames = await trackOutline({
        file: media.path,
        startPts: clip.mask.pts,
        times,
        paths: st.paths,
        quad,
        onProgress: (d, t) => setProg([d, t]),
        isCancelled: () => cancel.current,
      })
      if (!frames) return onClose()
      frames.sort((p, q) => p.t - q.t)
      dispatch({ type: 'setMaskOutline', id: clip.id, frames, from: Math.min(ts, end), to: Math.max(ts, end) })
      onClose()
    } catch (e) {
      setProg(null)
      setErr('Tracking failed: ' + String((e && e.message) || e))
    }
  }
  return createPortal(
    <div className="modal-bg">
      <div className="modal">
        <h3>Follow the subject?</h3>
        {prog ? (
          <>
            <p className="hint-sm">Tracking… following the subject's outline in each moment ({prog[0]} of {prog[1]}).</p>
            <div className="bar"><div className="bar-fill" style={{ width: (100 * prog[0]) / Math.max(1, prog[1]) + '%' }} /></div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button onClick={() => (cancel.current = true)}>Cancel</button>
            </div>
          </>
        ) : warn ? (
          <>
            <p className="hint-sm"><b>This computer's graphics look basic.</b> Tracking will run, but <b>slowly</b>: it can take several minutes for a few seconds of video. A computer with a proper graphics card does the same in a few seconds.</p>
            <div className="btn-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => setWarn(false)}>Back</button>
              <button className="primary" onClick={() => run(true)}>Track anyway</button>
            </div>
          </>
        ) : (
          <>
            <p className="hint-sm">
              {canTrack
                ? "The mask can follow the subject as the video plays, including when it turns or changes shape. The mask then lasts only for the time you choose; you can change that on the timeline afterwards."
                : 'Tracking works on video clips with a drawn or smart mask. The mask now covers the whole clip; shorten it on the timeline.'}
            </p>
            {canTrack && (
              <>
                <label className="minput" style={{ gridTemplateColumns: '1fr 80px 40px' }}>
                  <span>Follow it for</span>
                  <input type="number" min="0.5" max={remain} step="0.5" value={secs} onChange={(e) => setSecs(Math.max(0.5, Math.min(remain, +e.target.value || 0.5)))} />
                  <span className="unit">sec</span>
                </label>
                {gpu && gpu.ok && !gpu.weak && <p className="hint-sm" style={{ margin: '6px 0' }}>On your graphics card this takes roughly {Math.max(2, Math.round(Math.min(secs, remain) * 9))} seconds.</p>}
                <label className="chk"><input type="checkbox" checked={quad} onChange={(e) => setQuad(e.target.checked)} />Straight edges, 4 corners (licence plates, screens, signs)</label>
              </>
            )}
            {err && <p className="hint-sm" style={{ color: 'var(--love, #eb6f92)' }}>{err}</p>}
            <div className="btn-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={onClose}>{canTrack ? "Don't track" : 'OK'}</button>
              {canTrack && <button className="primary" onClick={() => run(false)}>Track</button>}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}


// Douglas-Peucker: fewer points that still follow the line
function simplify(pts, tol) {
  if (pts.length < 3) return pts
  const keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let max = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i]
      const [x1, y1] = pts[a]
      const [x2, y2] = pts[b]
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1e-9
      const d = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / len
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = true
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}
// A loop that was drawn (its end is close to its start) is simplified in two halves, split at the point farthest
// from the start, otherwise it would collapse into a line.
const fewPoints = (pts) => {
  const closed = pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.06
  const list = closed ? pts.slice(0, -1) : pts
  const run = (tol) => {
    if (!closed) return simplify(list, tol)
    let far = 0
    let best = -1
    list.forEach((p, i) => {
      const d = Math.hypot(p[0] - list[0][0], p[1] - list[0][1])
      if (d > best) {
        best = d
        far = i
      }
    })
    const a = simplify(list.slice(0, far + 1), tol)
    const b = simplify([...list.slice(far), list[0]], tol)
    return [...a, ...b.slice(1, -1)]
  }
  let tol = 0.004
  let out = run(tol)
  while (out.length > MAX_POLY && tol < 0.2) {
    tol *= 1.4
    out = run(tol)
  }
  return out.slice(0, MAX_POLY)
}
// The mask drawn over the preview: drag inside it to move it (that is the animated Mask X / Y), drag the handles to
// change its size and turn it, or drag the points of a drawn shape. In "draw" mode, draw around the subject.
export default function MaskOverlay({ state, dispatch, mode, setMode, box, getFrame }) {
  const [busy, setBusy] = useState('') // text shown while the AI is working
  const [ask, setAsk] = useState(false) // the "follow the subject?" question is open
  const [pen, setPen] = useState([]) // points placed so far with the "click points" tool
  const [hoverPt, setHoverPt] = useState(null)
  const penRef = useRef(null)
  useEffect(() => {
    if (mode !== 'maskpoly') {
      setPen([])
      return undefined
    }
    const key = (e) => {
      const p = penRef.current
      if (!p) return
      if (e.key === 'Enter') p.finish(p.pen)
      else if (e.key === 'Escape') setPen([])
      else if (e.key === 'Backspace') setPen((q) => q.slice(0, -1))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [mode])
  const RATIO = aspectRatio(state)
  const id = soleVideoClip(state)
  const clip = id && (layout(state.clips).find((c) => c.id === id) || overlayLayout(state.overlayClips).find((c) => c.id === id))
  if (!clip) return null
  const smart = mode === 'maskdrawsmart' // the AI finds the subject's outline inside the loop that is drawn
  const clicking = mode === 'maskpoly' // the shape is made by clicking its points one by one
  const drawing = mode === 'maskdraw' || smart || clicking
  if (!clip.mask && !drawing) return null
  if (state.playhead < clip.start - 0.001 || state.playhead > clip.start + clip.dur + 0.001) return null
  const media = clip.text ? { width: RATIO * 1000, height: 1000 } : state.media.find((m) => m.id === clip.mediaId)
  if (!media || !media.width || !media.height) return null
  const ts = srcAt(clip, state.playhead)
  const ma = media.width / media.height
  const s = [Math.max(1, RATIO / ma), Math.max(1, ma / RATIO)]
  if (!drawing && !ask && !maskAt(clip, ts)) return null // the mask does not last until here
  const tf = evalTransform(clip, ts)
  const BW = box.w
  const BH = box.h
  // picture coordinates (x right, y down, 0..1) <-> pixels of the preview
  const toPx = (p) => {
    const [u, v] = rectToFrame([p[0], 1 - p[1]], s, tf, RATIO)
    return [u * BW, (1 - v) * BH]
  }
  const fromPx = (x, y) => {
    const q = frameToRect([x / BW, 1 - y / BH], s, tf, RATIO)
    return [q[0], 1 - q[1]]
  }

  const anyKeys = PROPS.some((p) => ((clip.anim && clip.anim[p.id]) || []).length)
  const keyHere = PROPS.some((p) => keyAt(clip.anim && clip.anim[p.id], ts))
  const begin = (e, onMove, onEnd) => {
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.closest('.xf-overlay').getBoundingClientRect()
    const P = (ev) => [ev.clientX - r.left, ev.clientY - r.top]
    if (anyKeys && !keyHere) dispatch({ type: 'toggleKeyAll', id: clip.id, t: ts })
    else dispatch({ type: 'checkpoint' })
    const p0 = P(e)
    const move = (ev) => onMove(P(ev), p0)
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onEnd && onEnd(P(ev))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- click mode (like a pen tool): click to place points, click the first point / double-click / Enter to finish
  if (clicking) {
    const keep = { feather: clip.mask ? clip.mask.feather : 6, invert: clip.mask ? clip.mask.invert : false, expand: clip.mask ? clip.mask.expand : 0 }
    const finish = (pts) => {
      if (pts.length < 3) return
      dispatch({ type: 'setMask', id: clip.id, patch: { shape: 'poly', pts: pts.slice(0, MAX_POLY), from: undefined, to: undefined, frames: undefined, ...keep } })
      setPen([])
      setMode('mask')
      setAsk(true)
    }
    penRef.current = { pen, finish }
    const where = (e) => {
      const r = e.currentTarget.closest('.xf-overlay').getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }
    const click = (e) => {
      const [x, y] = where(e)
      if (pen.length >= 3) {
        const f = toPx(pen[0])
        if (Math.hypot(f[0] - x, f[1] - y) < 12) return finish(pen)
      }
      const l = pen.length ? toPx(pen[pen.length - 1]) : null
      if (l && Math.hypot(l[0] - x, l[1] - y) < 4) return // the second click of a double-click
      if (pen.length >= MAX_POLY) return finish(pen)
      setPen([...pen, fromPx(x, y)])
    }
    const px = pen.map(toPx)
    const hv = hoverPt && pen.length ? hoverPt : null
    return (
      <div className="xf-overlay mask-draw">
        <div className="mask-draw-hint">{pen.length ? 'Keep clicking around the subject. Click the first point, double-click or press Enter to finish. Backspace takes the last point back.' : 'Click to place the first point of the shape around the subject.'}</div>
        <svg width={BW} height={BH} viewBox={`0 0 ${BW} ${BH}`}>
          <rect
            width={BW}
            height={BH}
            fill="transparent"
            style={{ pointerEvents: 'all', cursor: 'crosshair' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={click}
            onDoubleClick={() => finish(pen)}
            onPointerMove={(e) => setHoverPt(where(e))}
            onPointerLeave={() => setHoverPt(null)}
          />
          {px.length > 0 && <polyline points={[...px, ...(hv ? [hv] : [])].map((q) => q.join(',')).join(' ')} className="mask-line" style={{ pointerEvents: 'none' }} fill="none" />}
          {px.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={i === 0 && pen.length >= 3 ? 7 : 4} fill={i === 0 ? 'var(--accent2)' : '#fff'} stroke="#000" strokeWidth="1" style={{ pointerEvents: 'none' }} />)}
        </svg>
      </div>
    )
  }

  // ---- draw mode: a freehand line around the subject becomes the shape
  if (drawing) {
    const start = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const r = e.currentTarget.closest('.xf-overlay').getBoundingClientRect()
      const raw = []
      const draw = (ev) => {
        const p = fromPx(ev.clientX - r.left, ev.clientY - r.top)
        const last = raw[raw.length - 1]
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.004) raw.push(p)
        const el = document.getElementById('mask-draw-line')
        if (el) el.setAttribute('points', raw.map((q) => toPx(q).join(',')).join(' '))
      }
      draw(e)
      const move = (ev) => draw(ev)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (raw.length < 4) return
        const keep = { feather: clip.mask ? clip.mask.feather : 6, invert: clip.mask ? clip.mask.invert : false, expand: clip.mask ? clip.mask.expand : 0 }
        if (!smart) {
          dispatch({ type: 'setMask', id: clip.id, patch: { shape: 'poly', pts: fewPoints(raw), from: undefined, to: undefined, frames: undefined, ...keep } })
          setMode('mask')
          setAsk(true)
          return
        }
        // smart: the AI looks at this frame and finds the exact outline of what is inside the loop
        const frame = getFrame && getFrame(clip.id)
        if (!frame) {
          setBusy('The picture is not ready yet. Try again in a moment.')
          setTimeout(() => setBusy(''), 2500)
          return
        }
        setBusy('Finding the subject… (the first time takes a few seconds)')
        ;(async () => {
          try {
            const { findSubject } = await import('./smartMask.js')
            const st = await window.api.modelsStatus()
            const pts = await findSubject({ el: frame.el, w: frame.w, h: frame.h, lasso: fewPoints(raw), paths: st.paths })
            if (pts && pts.length >= 3) {
              dispatch({ type: 'setMask', id: clip.id, patch: { shape: 'poly', pts, from: undefined, to: undefined, frames: undefined, ...keep } })
              setMode('mask')
              setBusy('')
              setAsk(true)
            } else {
              setBusy('No subject was found there. Try drawing the loop a little bigger.')
              setTimeout(() => setBusy(''), 3000)
            }
          } catch (err) {
            setBusy('The smart mask could not run: ' + String((err && err.message) || err))
            setTimeout(() => setBusy(''), 5000)
          }
        })()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    return (
      <div className="xf-overlay mask-draw">
        <div className="mask-draw-hint">{busy || (smart ? 'Draw a loop around the subject: the AI finds its edges.' : 'Draw around the subject you want to keep, then let go.')}</div>
        <svg width={BW} height={BH} viewBox={`0 0 ${BW} ${BH}`}>
          <rect width={BW} height={BH} fill="transparent" style={{ pointerEvents: 'all', cursor: 'crosshair' }} onPointerDown={start} />
          <polyline id="mask-draw-line" points="" className="mask-line" />
        </svg>
      </div>
    )
  }

  const tracked = !!(clip.mask.frames && clip.mask.frames.length) // a tracked outline changes every moment: shown, not edited
  const m = maskPlaced(maskAt(clip, ts) || clip.mask, tf)
  const sc = Math.max(0.01, (tf.ms != null ? tf.ms : 100) / 100)
  let outline = []
  let handles = []
  let centre
  const rad = ((m.rot || 0) * Math.PI) / 180
  const rot = (x, y) => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)]
  if (m.shape === 'poly') {
    outline = m.pts.map(toPx)
    centre = toPx(polyCentre(m.pts))
  } else {
    centre = toPx([m.cx, m.cy])
    if (m.shape === 'rect') {
      outline = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
        const r = rot((a * m.w) / 2, (b * m.h) / 2)
        return toPx([m.cx + r[0], m.cy + r[1]])
      })
    } else {
      for (let i = 0; i < 48; i++) {
        const ang = (i / 48) * Math.PI * 2
        const r = rot((Math.cos(ang) * m.w) / 2, (Math.sin(ang) * m.h) / 2)
        outline.push(toPx([m.cx + r[0], m.cy + r[1]]))
      }
    }
    handles = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const r = rot((a * m.w) / 2, (b * m.h) / 2)
      return toPx([m.cx + r[0], m.cy + r[1]])
    })
  }
  const rotPt = (() => {
    if (m.shape === 'poly') return null
    const r = rot(0, (-m.h / 2) - 0.07)
    return toPx([m.cx + r[0], m.cy + r[1]])
  })()
  const set = (patch) => dispatch({ type: 'setMask', id: clip.id, patch, live: true })

  const dragBody = (e) =>
    begin(e, (P, p0) => {
      const a = fromPx(p0[0], p0[1])
      const b = fromPx(P[0], P[1])
      dispatch({ type: 'setProp', id: clip.id, prop: 'mx', value: (tf.mx || 0) + (b[0] - a[0]) * 100, t: ts })
      dispatch({ type: 'setProp', id: clip.id, prop: 'my', value: (tf.my || 0) + (b[1] - a[1]) * 100, t: ts })
    })
  const dragCorner = (e) =>
    begin(e, (P) => {
      const p = fromPx(P[0], P[1])
      const dx = p[0] - m.cx
      const dy = p[1] - m.cy
      const lx = dx * Math.cos(rad) + dy * Math.sin(rad)
      const ly = -dx * Math.sin(rad) + dy * Math.cos(rad)
      set({ w: Math.max(0.02, (Math.abs(lx) * 2) / sc), h: Math.max(0.02, (Math.abs(ly) * 2) / sc) })
    })
  const dragRotate = (e) =>
    begin(e, (P) => {
      const p = fromPx(P[0], P[1])
      const ang = (Math.atan2(p[1] - m.cy, p[0] - m.cx) * 180) / Math.PI + 90
      set({ rot: Math.round(ang * 2) / 2 })
    })
  const dragPoint = (e, i) =>
    begin(e, (P) => {
      const p = fromPx(P[0], P[1])
      // undo the animated move / size so the point lands where the pointer is
      const c = polyCentre(clip.mask.pts)
      const ox = (tf.mx || 0) / 100
      const oy = (tf.my || 0) / 100
      const q = [c[0] + (p[0] - ox - c[0]) / sc, c[1] + (p[1] - oy - c[1]) / sc]
      const pts = clip.mask.pts.map((x, j) => (j === i ? q : x))
      set({ pts })
    })

  // double-click on the outline of a drawn shape adds a point there; right-click a point removes it
  const addPoint = (e) => {
    if (m.shape !== 'poly') return
    const r = e.currentTarget.closest('.xf-overlay').getBoundingClientRect()
    const p = fromPx(e.clientX - r.left, e.clientY - r.top)
    const c = polyCentre(clip.mask.pts)
    const q = [c[0] + (p[0] - (tf.mx || 0) / 100 - c[0]) / sc, c[1] + (p[1] - (tf.my || 0) / 100 - c[1]) / sc]
    const pts = clip.mask.pts
    if (pts.length >= MAX_POLY) return
    let at = 0
    let best = Infinity
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-9)))
      const d = Math.hypot(q[0] - (a[0] + dx * t), q[1] - (a[1] + dy * t))
      if (d < best) {
        best = d
        at = i
      }
    })
    dispatch({ type: 'setMask', id: clip.id, patch: { pts: [...pts.slice(0, at + 1), q, ...pts.slice(at + 1)] } })
  }
  const removePoint = (e, i) => {
    e.preventDefault()
    e.stopPropagation()
    if (clip.mask.pts.length <= 3) return
    dispatch({ type: 'setMask', id: clip.id, patch: { pts: clip.mask.pts.filter((_, j) => j !== i) } })
  }

  return (
    <div className="xf-overlay mask-ov">
      {ask && <TrackDialog clip={clip} state={state} media={media} dispatch={dispatch} onClose={() => setAsk(false)} />}
      <svg width={BW} height={BH} viewBox={`0 0 ${BW} ${BH}`}>
        <polygon points={outline.map((p) => p.join(',')).join(' ')} className="mask-line" onPointerDown={tracked ? undefined : dragBody} onDoubleClick={tracked ? undefined : addPoint} style={tracked ? { pointerEvents: 'none' } : { pointerEvents: 'all', cursor: 'move' }} />
        {rotPt && <line x1={(outline[0][0] + outline[1][0]) / 2} y1={(outline[0][1] + outline[1][1]) / 2} x2={rotPt[0]} y2={rotPt[1]} className="xf-line" />}
      </svg>
      <div className="xf-handle xf-rot" style={{ left: centre[0], top: centre[1], width: 8, height: 8, margin: '-4px 0 0 -4px', pointerEvents: 'none' }} />
      {m.shape === 'poly' && !tracked && outline.map((p, i) => <div key={i} className="xf-handle xf-corner" style={{ left: p[0], top: p[1] }} onPointerDown={(e) => dragPoint(e, i)} onContextMenu={(e) => removePoint(e, i)} title="Drag to move this point. Right-click to remove it. Double-click the outline to add a point." />)}
      {handles.map((p, i) => <div key={i} className="xf-handle xf-corner" style={{ left: p[0], top: p[1] }} onPointerDown={dragCorner} title="Drag to resize the mask" />)}
      {rotPt && <div className="xf-handle xf-rot" style={{ left: rotPt[0], top: rotPt[1] }} onPointerDown={dragRotate} title="Turn the mask" />}
    </div>
  )
}