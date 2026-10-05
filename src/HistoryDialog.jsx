import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { fmtDur } from './state.js'

const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return Math.round(s / 60) + ' minutes ago'
  if (s < 86400) return Math.round(s / 3600) + ' hours ago'
  return Math.round(s / 86400) + ' days ago'
}

// Version history: earlier copies of this project, kept when you save and while you work.
export default function HistoryDialog({ projectKey, onRestore, onOpenNew, onClose }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    window.api.historyList(projectKey).then(setList)
  }, [projectKey])
  const read = (v) => window.api.historyRead({ key: projectKey, id: v.id })
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal history-modal" onPointerDown={(e) => e.stopPropagation()}>
        <h3><Icon name="history" size={18} /> Version history</h3>
        <div className="hint left">Earlier copies of this project. Opening one as a new project leaves what you have now untouched. Restoring here replaces this project with that version (the current one is kept in the history first).</div>
        {list == null && <div className="hint">Looking…</div>}
        {list && list.length === 0 && <div className="hint">Nothing here yet. A copy is kept each time you save, and now and then while you work.</div>}
        <div className="history-list">
          {(list || []).map((v) => (
            <div key={v.id} className="history-row">
              <div className="history-info">
                <b>{ago(v.time)}</b> <span className="hint">{new Date(v.time).toLocaleString()}</span>
                <div className="hint left">
                  {v.label ? v.label + ' · ' : ''}
                  {v.clips} clip{v.clips === 1 ? '' : 's'}, {v.audio} audio clip{v.audio === 1 ? '' : 's'}, {fmtDur(v.seconds)}
                </div>
              </div>
              <button className="mini wide" onClick={async () => onOpenNew(await read(v))}>Open as new project</button>
              <button className="mini wide" onClick={async () => onRestore(await read(v))}>Restore here</button>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button onClick={onClose}>Close</button>
          <span />
        </div>
      </div>
    </div>
  )
}