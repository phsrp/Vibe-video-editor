import { EASES, DEFAULT_BEZ, bezierFn } from './motion.js'

const W = 220
const H = 170
const PAD = 16
const YMIN = -0.6
const YMAX = 1.6

const px = (x) => PAD + x * (W - 2 * PAD)
const py = (y) => PAD + (1 - (y - YMIN) / (YMAX - YMIN)) * (H - 2 * PAD)

// Easing picker. Choosing "Custom curve" shows a graph: drag the two round handles to draw your own curve
// (the line shows how fast the value changes between two keyframes; steeper = faster).
// onChange(ease, bez, live): live is true while a handle is being dragged.
export default function EaseEditor({ ease, bez, onChange, onStart }) {
  const b = bez && bez.length === 4 ? bez : DEFAULT_BEZ
  const f = bezierFn(b)
  const pts = []
  for (let i = 0; i <= 40; i++) pts.push(`${px(i / 40).toFixed(1)},${py(f(i / 40)).toFixed(1)}`)

  const drag = (e, which) => {
    e.preventDefault()
    const svg = e.currentTarget.ownerSVGElement
    const r = svg.getBoundingClientRect()
    onStart && onStart()
    const move = (ev) => {
      const x = Math.min(1, Math.max(0, ((ev.clientX - r.left) / r.width * W - PAD) / (W - 2 * PAD)))
      const yy = YMIN + (1 - ((ev.clientY - r.top) / r.height * H - PAD) / (H - 2 * PAD)) * (YMAX - YMIN)
      const y = Math.min(YMAX, Math.max(YMIN, yy))
      const nb = [...b]
      nb[which * 2] = +x.toFixed(3)
      nb[which * 2 + 1] = +y.toFixed(3)
      onChange('custom', nb, true)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="ease-editor">
      <select value={ease || 'easeInOut'} onChange={(e) => onChange(e.target.value, e.target.value === 'custom' ? b : undefined, false)} title="How the value changes from this keyframe to the next">
        {Object.entries(EASES).map(([k, e]) => (
          <option key={k} value={k}>{e.label}</option>
        ))}
      </select>
      {ease === 'custom' && (
        <svg className="ease-graph" viewBox={`0 0 ${W} ${H}`} width="100%">
          <rect x={px(0)} y={py(1)} width={px(1) - px(0)} height={py(0) - py(1)} className="ease-box" />
          <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="ease-diag" />
          <polyline points={pts.join(' ')} className="ease-curve" />
          <line x1={px(0)} y1={py(0)} x2={px(b[0])} y2={py(b[1])} className="ease-arm" />
          <line x1={px(1)} y1={py(1)} x2={px(b[2])} y2={py(b[3])} className="ease-arm" />
          <circle cx={px(b[0])} cy={py(b[1])} r="7" className="ease-pt" onPointerDown={(e) => drag(e, 0)} />
          <circle cx={px(b[2])} cy={py(b[3])} r="7" className="ease-pt" onPointerDown={(e) => drag(e, 1)} />
          <text x={px(0)} y={H - 2} className="ease-lab">start</text>
          <text x={px(1)} y={H - 2} className="ease-lab" textAnchor="end">end</text>
        </svg>
      )}
    </div>
  )
}
