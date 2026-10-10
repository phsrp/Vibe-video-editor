import { envAt, fadeAt } from './state.js'

// The volume line of a selected audio clip, drawn over its waveform:
//  - click the line to add a keyframe, drag a keyframe up (louder) or down (quieter) and sideways, double-click it to remove it
//  - the two small squares in the top corners are the fade handles: drag them inwards to fade in / fade out
// The middle of the clip is 100% (no change); the top is 200%, the bottom is silence.
//   env = [{t, v}] keyframes (t in seconds of the file, v 0..2); toX(t) -> pixel, toKey(x) -> t
//   dur = the clip's length on the timeline (seconds), width / height in pixels
//   onChange(patch, live): patch = {env} or {fadeIn} or {fadeOut}; onStart() = once at the start of a drag (one undo step)
export default function VolumeEdit({ width, height, dur, env = [], fadeIn = 0, fadeOut = 0, toX, toKey, onChange, onStart }) {
  if (width < 24) return null
  const ppx = width / Math.max(0.01, dur) // pixels per second of the clip
  const yOf = (v) => height * (1 - Math.max(0, Math.min(2, v)) / 2)
  const vOf = (y) => Math.max(0, Math.min(2, 2 * (1 - y / height)))
  const gainAtX = (x) => envAt(env, toKey(x)) * fadeAt(x / ppx, dur, fadeIn, fadeOut)
  // the line: every 3 pixels (the fades are straight lines, so this is enough)
  const pts = []
  for (let x = 0; x <= width; x += 3) pts.push(`${x},${yOf(gainAtX(x)).toFixed(1)}`)
  pts.push(`${width},${yOf(gainAtX(width)).toFixed(1)}`)

  const local = (e) => {
    const r = e.currentTarget.ownerSVGElement ? e.currentTarget.ownerSVGElement.getBoundingClientRect() : e.currentTarget.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  // drag helper: calls move(x, y) while the pointer is down
  const drag = (e, svg, move) => {
    const r = svg.getBoundingClientRect()
    const mv = (ev) => move(ev.clientX - r.left, ev.clientY - r.top)
    const up = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
  }
  const sorted = (list) => list.slice().sort((a, b) => a.t - b.t)

  // add a keyframe where the line was clicked and carry on dragging it
  const addKey = (e) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const svg = e.currentTarget.ownerSVGElement
    const [x, y] = local(e)
    onStart && onStart()
    const k = { t: toKey(Math.max(0, Math.min(width, x))), v: vOf(y) }
    let list = sorted([...env, k])
    onChange({ env: list }, true)
    drag(e, svg, (mx, my) => {
      const t = toKey(Math.max(0, Math.min(width, mx)))
      k.t = t
      k.v = vOf(my)
      list = sorted(list)
      onChange({ env: list.slice() }, true)
    })
  }
  const dragKey = (e, i) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const svg = e.currentTarget.ownerSVGElement
    onStart && onStart()
    const k = env[i]
    let list = env.slice()
    drag(e, svg, (mx, my) => {
      const t = toKey(Math.max(0, Math.min(width, mx)))
      const next = { t, v: vOf(my) }
      list = env.map((p) => (p === k ? next : p))
      onChange({ env: sorted(list) }, true)
    })
  }
  const removeKey = (e, i) => {
    e.stopPropagation()
    e.preventDefault()
    onChange({ env: env.filter((_, j) => j !== i) }, false)
  }
  const dragFade = (e, side) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const svg = e.currentTarget.ownerSVGElement
    onStart && onStart()
    const other = side === 'fadeIn' ? fadeOut : fadeIn
    drag(e, svg, (mx) => {
      const px = side === 'fadeIn' ? mx : width - mx
      const s = Math.max(0, Math.min(dur - other, px / ppx))
      onChange({ [side]: s < 0.05 ? 0 : Math.round(s * 100) / 100 }, true)
    })
  }

  const hx = Math.max(0, Math.min(width - 8, fadeIn * ppx))
  const ox = Math.max(0, Math.min(width - 8, width - fadeOut * ppx - 8))
  return (
    <svg className="vol-edit" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <line x1="0" x2={width} y1={yOf(1)} y2={yOf(1)} className="vol-mid" />
      <polyline points={pts.join(' ')} className="vol-line" />
      {/* a wide invisible stroke to click on */}
      <polyline points={pts.join(' ')} className="vol-hit" onPointerDown={addKey} />
      {env.map((k, i) => (
        <circle key={i} cx={toX(k.t)} cy={yOf(k.v)} r="4.5" className="vol-key" onPointerDown={(e) => dragKey(e, i)} onDoubleClick={(e) => removeKey(e, i)} onContextMenu={(e) => removeKey(e, i)}>
          <title>Drag to change the volume here. Double-click to remove it.</title>
        </circle>
      ))}
      <rect x={hx} y="0" width="8" height="8" rx="1.5" className="vol-fade" onPointerDown={(e) => dragFade(e, 'fadeIn')}>
        <title>Drag to fade the sound in</title>
      </rect>
      <rect x={ox} y="0" width="8" height="8" rx="1.5" className="vol-fade" onPointerDown={(e) => dragFade(e, 'fadeOut')}>
        <title>Drag to fade the sound out</title>
      </rect>
    </svg>
  )
}
