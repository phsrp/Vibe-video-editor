import { useEffect, useRef } from 'react'

// A thin overview of the whole project under the timeline. The bright box is what you currently see;
// click or drag anywhere on it to jump there.
export default function MiniMap({ rows, markers, total, playhead, zoom, scrollRef, labelW, pad }) {
  const boxRef = useRef(null)
  const wrapRef = useRef(null)
  const span = Math.max(total, 1)

  // keep the bright box in step with the timeline's scroll position
  useEffect(() => {
    const el = scrollRef.current
    const upd = () => {
      const box = boxRef.current
      if (!box || !el) return
      const visible = Math.max(0.01, (el.clientWidth - labelW) / zoom)
      const start = Math.max(0, (el.scrollLeft - pad) / zoom)
      const s = Math.max(span, start + visible)
      box.style.left = (start / s) * 100 + '%'
      box.style.width = Math.min(100, (visible / s) * 100) + '%'
    }
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    const ro = new ResizeObserver(upd)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', upd)
      ro.disconnect()
    }
  }, [zoom, span, labelW, pad])

  const jump = (e) => {
    const r = wrapRef.current.getBoundingClientRect()
    const el = scrollRef.current
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * span
    el.scrollLeft = Math.max(0, labelW + pad + t * zoom - el.clientWidth / 2)
  }
  const down = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    jump(e)
    const move = (ev) => jump(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const n = Math.max(1, rows.length)
  return (
    <div className="minimap" ref={wrapRef} onPointerDown={down} title="Overview of the whole project: click or drag to move around">
      {rows.map((r, i) => (
        <div key={r.key} className="mm-row" style={{ top: `${(i / n) * 100}%`, height: `${100 / n}%` }}>
          {r.items.map((it, j) => (
            <div key={j} className={'mm-item ' + r.kind} style={{ left: `${(it.start / span) * 100}%`, width: `${Math.max(0.15, (it.dur / span) * 100)}%` }} />
          ))}
        </div>
      ))}
      {markers.map((m) => (
        <div key={m.id} className="mm-marker" style={{ left: `${(m.t / span) * 100}%` }} />
      ))}
      <div className="mm-play" style={{ left: `${(Math.min(playhead, span) / span) * 100}%` }} />
      <div className="mm-box" ref={boxRef} />
    </div>
  )
}