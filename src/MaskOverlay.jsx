import { useState } from 'react'
import { layout, overlayLayout, soleVideoClip, srcAt, aspectRatio } from './state.js'
import { evalTransform, evalProp, keyAt, PROPS, rectToFrame, frameToRect } from './motion.js'
import { maskPlaced, polyCentre, MAX_POLY } from './masks.js'


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
  const RATIO = aspectRatio(state)
  const id = soleVideoClip(state)
  const clip = id && (layout(state.clips).find((c) => c.id === id) || overlayLayout(state.overlayClips).find((c) => c.id === id))
  if (!clip) return null
  const smart = mode === 'maskdrawsmart' // the AI finds the subject's outline inside the loop that is drawn
  const drawing = mode === 'maskdraw' || smart
  if (!clip.mask && !drawing) return null
  if (state.playhead < clip.start - 0.001 || state.playhead > clip.start + clip.dur + 0.001) return null
  const media = clip.text ? { width: RATIO * 1000, height: 1000 } : state.media.find((m) => m.id === clip.mediaId)
  if (!media || !media.width || !media.height) return null
  const ts = srcAt(clip, state.playhead)
  const ma = media.width / media.height
  const s = [Math.max(1, RATIO / ma), Math.max(1, ma / RATIO)]
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
          dispatch({ type: 'setMask', id: clip.id, patch: { shape: 'poly', pts: fewPoints(raw), ...keep } })
          setMode('mask')
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
            const pts = await findSubject({ el: frame.el, w: frame.w, h: frame.h, lasso: fewPoints(raw), paths: st.paths, frameKey: clip.id + ':' + ts.toFixed(3) })
            if (pts && pts.length >= 3) {
              dispatch({ type: 'setMask', id: clip.id, patch: { shape: 'poly', pts, ...keep } })
              setMode('mask')
              setBusy('')
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

  const m = maskPlaced(clip.mask, tf)
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

  return (
    <div className="xf-overlay mask-ov">
      <svg width={BW} height={BH} viewBox={`0 0 ${BW} ${BH}`}>
        <polygon points={outline.map((p) => p.join(',')).join(' ')} className="mask-line" onPointerDown={dragBody} style={{ pointerEvents: 'all', cursor: 'move' }} />
        {rotPt && <line x1={(outline[0][0] + outline[1][0]) / 2} y1={(outline[0][1] + outline[1][1]) / 2} x2={rotPt[0]} y2={rotPt[1]} className="xf-line" />}
      </svg>
      <div className="xf-handle xf-rot" style={{ left: centre[0], top: centre[1], width: 8, height: 8, margin: '-4px 0 0 -4px', pointerEvents: 'none' }} />
      {m.shape === 'poly' && outline.map((p, i) => <div key={i} className="xf-handle xf-corner" style={{ left: p[0], top: p[1] }} onPointerDown={(e) => dragPoint(e, i)} title="Drag to reshape" />)}
      {handles.map((p, i) => <div key={i} className="xf-handle xf-corner" style={{ left: p[0], top: p[1] }} onPointerDown={dragCorner} title="Drag to resize the mask" />)}
      {rotPt && <div className="xf-handle xf-rot" style={{ left: rotPt[0], top: rotPt[1] }} onPointerDown={dragRotate} title="Turn the mask" />}
    </div>
  )
}