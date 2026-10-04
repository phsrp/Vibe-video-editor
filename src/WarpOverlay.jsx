import { layout, overlayLayout, soleVideoClip } from './state.js'
import { evalTransform, evalWarp, warpQuad, rectToFrame, frameToRect, WARP_ZERO } from './motion.js'

const RATIO = 16 / 9
const BASE = [[0, 1], [1, 1], [1, 0], [0, 0]]
const NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

// The four corner handles drawn over the preview for the selected clip. Drag a corner to warp the
// picture; with keyframes on, dragging at a new moment adds a keyframe there.
export default function WarpOverlay({ state, dispatch }) {
  const id = soleVideoClip(state)
  const clip = id && (layout(state.clips).find((c) => c.id === id) || overlayLayout(state.overlayClips).find((c) => c.id === id))
  if (!clip) return null
  if (state.playhead < clip.start - 0.001 || state.playhead > clip.start + clip.dur + 0.001) return null
  const media = state.media.find((m) => m.id === clip.mediaId)
  if (!media || !media.width || !media.height) return null
  const ts = Math.min(clip.out, Math.max(clip.in, clip.in + (state.playhead - clip.start)))
  const ma = media.width / media.height
  const s = [Math.max(1, RATIO / ma), Math.max(1, ma / RATIO)]
  const tf = evalTransform(clip, ts)
  const c = evalWarp(clip, ts) || WARP_ZERO
  const pts = warpQuad(c).map((q) => rectToFrame(q, s, tf, RATIO)).map(([u, v]) => [u * 100, (1 - v) * 100])

  const startDrag = (e, i) => {
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.parentElement.getBoundingClientRect()
    dispatch({ type: 'checkpoint' })
    const move = (ev) => {
      const uv = [(ev.clientX - box.left) / box.width, 1 - (ev.clientY - box.top) / box.height]
      const q = frameToRect(uv, s, tf, RATIO)
      const next = [...c]
      next[i * 2] = Math.max(-200, Math.min(200, (q[0] - BASE[i][0]) * 100))
      next[i * 2 + 1] = Math.max(-200, Math.min(200, -(q[1] - BASE[i][1]) * 100))
      dispatch({ type: 'warpSet', id: clip.id, t: ts, c: next })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="warp-overlay">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points={pts.map((p) => p.join(',')).join(' ')} />
      </svg>
      {pts.map((p, i) => (
        <div key={i} className="warp-handle" style={{ left: p[0] + '%', top: p[1] + '%' }} onPointerDown={(e) => startDrag(e, i)} title={`Drag the ${NAMES[i]} corner`} />
      ))}
    </div>
  )
}