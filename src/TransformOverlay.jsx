import { layout, overlayLayout, soleVideoClip, srcAt, aspectRatio, clipPicture } from './state.js'
import { evalTransform, evalProp, keyAt, PROPS, rectToFrame } from './motion.js'

// the picture's rectangle (q space, y up): corners, then edge midpoints
const CORNERS = [[0, 1], [1, 1], [1, 0], [0, 0]]
const EDGES = [[0.5, 1, 'sy'], [1, 0.5, 'sx'], [0.5, 0, 'sy'], [0, 0.5, 'sx']]
const ROT_OFFSET = 30 // px, distance of the rotate handle from the top edge

// The box drawn over the preview for the selected clip. Drag inside it to move the picture, drag a corner
// to make it bigger or smaller (the "Free transform" button lets corners stretch it instead), drag a side
// to stretch only that way, and drag the round handle to rotate. If the clip has keyframes, changing it at
// a new moment adds a keyframe there.
export default function TransformOverlay({ state, dispatch, free, box }) {
  const RATIO = aspectRatio(state)
  const id = soleVideoClip(state)
  const clip = id && (layout(state.clips).find((c) => c.id === id) || overlayLayout(state.overlayClips).find((c) => c.id === id))
  if (!clip) return null
  if (state.playhead < clip.start - 0.001 || state.playhead > clip.start + clip.dur + 0.001) return null
  const media = clipPicture(state, clip, RATIO)
  if (!media || !media.width || !media.height) return null
  const ts = srcAt(clip, state.playhead)
  const ma = media.width / media.height
  const s = [Math.max(1, RATIO / ma), Math.max(1, ma / RATIO)]
  const tf = evalTransform(clip, ts)
  const BW = box.w
  const BH = box.h
  const toPx = (q) => {
    const [u, v] = rectToFrame(q, s, tf, RATIO)
    return [u * BW, (1 - v) * BH]
  }
  const C = toPx([0.5, 0.5])
  const corners = CORNERS.map(toPx)
  const edges = EDGES.map((e) => ({ p: toPx([e[0], e[1]]), prop: e[2] }))
  const top = toPx([0.5, 1])
  const dirLen = Math.hypot(top[0] - C[0], top[1] - C[1]) || 1
  const rotPt = [top[0] + ((top[0] - C[0]) / dirLen) * ROT_OFFSET, top[1] + ((top[1] - C[1]) / dirLen) * ROT_OFFSET]

  const anyKeys = PROPS.some((p) => ((clip.anim && clip.anim[p.id]) || []).length)
  const keyHere = PROPS.some((p) => keyAt(clip.anim && clip.anim[p.id], ts))

  // common drag plumbing: onMove(P) gets the pointer in preview pixels
  const begin = (e, onMove) => {
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.closest('.xf-overlay').getBoundingClientRect()
    const P = (ev) => [ev.clientX - r.left, ev.clientY - r.top]
    if (anyKeys && !keyHere) dispatch({ type: 'toggleKeyAll', id: clip.id, t: ts })
    else dispatch({ type: 'checkpoint' })
    const p0 = P(e)
    const move = (ev) => onMove(P(ev), p0)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const set = (prop, value) => dispatch({ type: 'setProp', id: clip.id, prop, value, t: ts })
  const v0 = { x: tf.x, y: tf.y, scale: tf.scale, sx: tf.sx, sy: tf.sy, rot: tf.rot }
  const rad = (tf.rot * Math.PI) / 180
  const ux = [Math.cos(rad), Math.sin(rad)] // the picture's own axes on screen
  const uy = [-Math.sin(rad), Math.cos(rad)]
  const local = (P) => {
    const d = [P[0] - C[0], P[1] - C[1]]
    return [d[0] * ux[0] + d[1] * ux[1], d[0] * uy[0] + d[1] * uy[1]]
  }
  const ratioOf = (a, b) => Math.abs(a) / Math.max(2, Math.abs(b))

  const dragBody = (e) => begin(e, (P, p0) => {
    set('x', v0.x + ((P[0] - p0[0]) / BW) * 100)
    set('y', v0.y + ((P[1] - p0[1]) / BH) * 100)
  })
  const dragCorner = (e) => begin(e, (P, p0) => {
    if (free) {
      const a = local(P)
      const b = local(p0)
      set('sx', Math.max(5, Math.min(400, v0.sx * ratioOf(a[0], b[0]))))
      set('sy', Math.max(5, Math.min(400, v0.sy * ratioOf(a[1], b[1]))))
    } else {
      const k = Math.hypot(P[0] - C[0], P[1] - C[1]) / Math.max(2, Math.hypot(p0[0] - C[0], p0[1] - C[1]))
      set('scale', Math.max(1, Math.min(800, v0.scale * k)))
    }
  })
  const dragEdge = (e, prop) => begin(e, (P, p0) => {
    const a = local(P)
    const b = local(p0)
    if (prop === 'sx') set('sx', Math.max(5, Math.min(400, v0.sx * ratioOf(a[0], b[0]))))
    else set('sy', Math.max(5, Math.min(400, v0.sy * ratioOf(a[1], b[1]))))
  })
  const dragRotate = (e) => begin(e, (P, p0) => {
    const a0 = Math.atan2(p0[1] - C[1], p0[0] - C[0])
    const a1 = Math.atan2(P[1] - C[1], P[0] - C[0])
    let r = v0.rot + ((a1 - a0) * 180) / Math.PI
    while (r > 360) r -= 720
    while (r < -360) r += 720
    set('rot', Math.round(r * 10) / 10)
  })

  const pct = ([x, y]) => ({ left: x, top: y })
  return (
    <div className="xf-overlay">
      <svg width={BW} height={BH} viewBox={`0 0 ${BW} ${BH}`}>
        <polygon points={corners.map((p) => p.join(',')).join(' ')} className="xf-body" onPointerDown={dragBody} />
        <line x1={top[0]} y1={top[1]} x2={rotPt[0]} y2={rotPt[1]} className="xf-line" />
      </svg>
      {edges.map((e, i) => (
        <div key={'e' + i} className="xf-handle xf-edge" style={pct(e.p)} onPointerDown={(ev) => dragEdge(ev, e.prop)} title={e.prop === 'sx' ? 'Stretch wider or narrower' : 'Stretch taller or shorter'} />
      ))}
      {corners.map((p, i) => (
        <div key={'c' + i} className={'xf-handle xf-corner' + (free ? ' free' : '')} style={pct(p)} onPointerDown={dragCorner} title={free ? 'Stretch (free transform)' : 'Drag inwards to make it smaller, outwards to make it bigger'} />
      ))}
      <div className="xf-handle xf-rot" style={pct(rotPt)} onPointerDown={dragRotate} title="Rotate" />
    </div>
  )
}
