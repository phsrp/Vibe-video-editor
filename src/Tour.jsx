import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// The first-run tutorial: dims everything, lights up one part of the editor and explains it in a small card.
const KEY = (kind) => 'vibe.tour.' + kind
export const tourSeen = (kind) => {
  try {
    return localStorage.getItem(KEY(kind)) === '1'
  } catch {
    return true
  }
}
export const markTourSeen = (kind) => {
  try {
    localStorage.setItem(KEY(kind), '1')
  } catch {}
}

const CARD_W = 340
const GAP = 14

export default function Tour({ steps, rootRef, onClose, onStep }) {
  const [i, setI] = useState(0)
  const [hole, setHole] = useState(null) // the lit-up rectangle (window pixels), or null for a centred card
  const [pos, setPos] = useState({ left: 0, top: 0, ready: false })
  const cardRef = useRef(null)
  const step = steps[i]
  const last = i === steps.length - 1
  const stepRef = useRef(onStep)
  stepRef.current = onStep

  // a step may ask for a clip to be selected (so the Inspector has something to show) and for one of its tabs to be opened
  useEffect(() => {
    if (step.select && stepRef.current) stepRef.current(step)
    if (!step.tab) return
    const open = () => {
      const b = rootRef.current && rootRef.current.querySelector(`.insp-tabs button[data-tab="${step.tab}"]`)
      if (b) b.click()
    }
    const t1 = setTimeout(open, 250)
    const t2 = setTimeout(open, 700)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [i])

  // find the target of this step and keep measuring it (panels open and close, the window is resized)
  useEffect(() => {
    let scrolled = false
    const measure = () => {
      const root = rootRef.current
      let found = null
      if (root) {
        for (const sel of [].concat(step.target || [])) {
          const el = root.querySelector(sel)
          if (!el) continue
          if (!scrolled) {
            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch {}
          }
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) {
            // keep the lit-up box inside the window and inside every scrolling panel around it
            // (a section can be taller than the part of the panel you can see)
            let [l, t, rr, bb] = [Math.max(8, r.left), Math.max(8, r.top), Math.min(window.innerWidth - 8, r.right), Math.min(window.innerHeight - 8, r.bottom)]
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              const o = getComputedStyle(p)
              if (!/(auto|scroll|hidden)/.test(o.overflowY + o.overflowX)) continue
              const pr = p.getBoundingClientRect()
              l = Math.max(l, pr.left)
              t = Math.max(t, pr.top)
              rr = Math.min(rr, pr.right)
              bb = Math.min(bb, pr.bottom)
            }
            if (rr - l < 4 || bb - t < 4) continue
            found = { left: l, top: t, width: rr - l, height: bb - t }
            break
          }
        }
      }
      scrolled = true
      setHole((old) => {
        if (!found) return old === null ? old : null
        if (old && old.left === found.left && old.top === found.top && old.width === found.width && old.height === found.height) return old
        return found
      })
    }
    measure()
    const id = setInterval(measure, 250)
    window.addEventListener('resize', measure)
    return () => {
      clearInterval(id)
      window.removeEventListener('resize', measure)
    }
  }, [i])

  // where the card goes: beside the lit-up part if it fits, otherwise in the middle
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const w = card.offsetWidth || CARD_W
    const h = card.offsetHeight
    const W = window.innerWidth
    const H = window.innerHeight
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
    if (!hole) return setPos({ left: (W - w) / 2, top: (H - h) / 2, ready: true })
    const right = hole.left + hole.width
    const bottom = hole.top + hole.height
    const cx = clamp(hole.left + hole.width / 2 - w / 2, 12, W - w - 12)
    const cy = clamp(hole.top + hole.height / 2 - h / 2, 12, H - h - 12)
    const sides = {
      below: [cx, bottom + GAP, bottom + GAP + h <= H - 8],
      above: [cx, hole.top - GAP - h, hole.top - GAP - h >= 8],
      right: [right + GAP, cy, right + GAP + w <= W - 8],
      left: [hole.left - GAP - w, clamp(hole.top, 12, H - h - 12), hole.left - GAP - w >= 8],
    }
    // (a step can say which side it prefers, for example to keep the card off the thing it explains)
    const order = [step.side, 'below', 'above', 'right', 'left'].filter(Boolean)
    const ok = order.map((s) => sides[s]).find((t) => t && t[2])
    if (ok) setPos({ left: ok[0], top: ok[1], ready: true })
    else setPos({ left: clamp(hole.left + 16, 12, W - w - 12), top: clamp(hole.top + 16, 12, H - h - 12), ready: true }) // a very big target: card sits inside it
  }, [hole, i])

  const next = () => (last ? onClose() : setI(i + 1))
  const back = () => setI(Math.max(0, i - 1))

  // the keyboard drives the tour; nothing reaches the editor underneath
  useEffect(() => {
    const onKey = (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') back()
      if (e.key !== 'F5' && e.key !== 'F12') e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const pad = 6
  return (
    <div className="tour" role="dialog" aria-label="Tutorial">
      <div className={'tour-bg' + (hole ? '' : ' dim')} />
      {hole && <div className="tour-hole" style={{ left: hole.left - pad, top: hole.top - pad, width: hole.width + pad * 2, height: hole.height + pad * 2 }} />}
      <div className="tour-card" ref={cardRef} style={{ left: pos.left, top: pos.top, width: CARD_W, opacity: pos.ready ? 1 : 0 }}>
        <div className="tour-count">{i + 1} / {steps.length}</div>
        <h4>{step.title}</h4>
        <p>{step.text}</p>
        <div className="tour-actions">
          {!last ? <button onClick={onClose} title="Close the tutorial (Esc)">Skip tour</button> : <span />}
          <span className="tour-nav">
            {i > 0 && <button onClick={back}>Back</button>}
            <button className="primary" onClick={next} autoFocus>{last ? 'Done' : 'Next'}</button>
          </span>
        </div>
      </div>
    </div>
  )
}
