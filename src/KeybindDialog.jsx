import { useEffect, useState } from 'react'
import { ACTIONS, comboOf } from './keybinds.js'

export default function KeybindDialog({ binds, setBinds, onClose }) {
  const [capturing, setCapturing] = useState(null)

  useEffect(() => {
    if (!capturing) return
    const onKey = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setCapturing(null)
      const c = comboOf(e)
      if (!c) return
      // a key can only trigger one action: unbind it from any other
      const next = { ...binds }
      for (const k of Object.keys(next)) if (next[k] === c) next[k] = ''
      next[capturing] = c
      setBinds(next)
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, binds, setBinds])

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <p className="hint-sm">Click a shortcut, then press the new key (or combo like Ctrl+B). Esc cancels.</p>
        {ACTIONS.map((a) => (
          <div className="kb-row" key={a.id}>
            <span>{a.label}</span>
            <button className={capturing === a.id ? 'primary' : ''} onClick={() => setCapturing(a.id)}>
              {capturing === a.id ? 'Press a key…' : binds[a.id] || '(none)'}
            </button>
          </div>
        ))}
        <div className="modal-foot">
          <button onClick={() => setBinds(Object.fromEntries(ACTIONS.map((a) => [a.id, a.def])))}>Reset to defaults</button>
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
