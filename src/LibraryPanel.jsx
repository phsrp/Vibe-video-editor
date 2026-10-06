import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { fmtTime, toUrl } from './state.js'

// The Library: videos, images and sounds you use again and again, kept in Documents > Vibe Video Editor
// Library. Drag one onto the timeline (or double-click it) to use it in the project.
export default function LibraryPanel({ open, setOpen, onAddMedia, onUse, usedPaths = [] }) {
  const [files, setFiles] = useState(null) // [{path, name}] or null while loading
  const [items, setItems] = useState({}) // path -> described media (thumbnail, length...)
  const loading = useRef(0)

  const refresh = async () => {
    const list = await window.api.libraryList()
    setFiles(list)
    const token = ++loading.current
    // describe them one by one so the list fills in as thumbnails become ready
    for (const f of list) {
      if (token !== loading.current) return
      try {
        const [it] = await window.api.describeFiles([f.path])
        if (it) setItems((m) => ({ ...m, [f.path]: it }))
      } catch {}
    }
  }
  useEffect(() => {
    if (open) refresh()
  }, [open])

  const add = async () => {
    const n = await window.api.libraryAdd()
    if (n) refresh()
  }

  // delete a file from the library folder: it goes to the Recycle Bin
  const remove = async (f) => {
    const inProject = usedPaths.includes(f.path)
    const nl = '\n\n'
    const msg =
      `Delete "${f.name}" from your library?${nl}It moves to the Recycle Bin, so you can get it back from there.` +
      (inProject ? `${nl}It is also in this project: its clips will show as missing until you put the file back.` : '')
    if (!window.confirm(msg)) return
    await window.api.libraryDelete(f.path)
    refresh()
  }

  return (
    <aside className={'library' + (open ? '' : ' collapsed')}>
      {!open && (
        <button className="collapse-strip" onClick={() => setOpen(true)} title="Show your library">
          <Icon name="right" size={14} />
          <span>Library</span>
        </button>
      )}
      <div className="panel-title">
        <span className="title-left">
          <button className="mini" onClick={() => setOpen(false)} title="Hide the library"><Icon name="left" size={12} /></button>
          Library
        </span>
        <span className="btn-row">
          <button className="mini" onClick={refresh} title="Look for new files in the library folder"><Icon name="refresh" size={12} /></button>
          <button className="mini" onClick={() => window.api.libraryFolder()} title="Open the library folder"><Icon name="folder" size={12} /></button>
        </span>
      </div>
      <div className="bin-list">
        {files && files.length === 0 && (
          <div className="lib-empty">
            <Icon name="folder" size={26} />
            <b>Upload your own</b>
            <span>Keep the videos, images and sounds you use a lot here (an intro, a logo, music, sound effects) and they are always one click away.</span>
            <button className="primary" onClick={() => window.api.libraryFolder()}>
              <Icon name="folder" size={13} /> Open library folder
            </button>
            <button onClick={add}>Add files…</button>
          </div>
        )}
        {files && files.length > 0 && (
          <>
            {files.map((f) => {
              const m = items[f.path]
              return (
                <div
                  key={f.path}
                  className="bin-item"
                  draggable={!!m}
                  onDragStart={(e) => {
                    if (!m) return
                    onAddMedia([m])
                    e.dataTransfer.setData('text/vibe-media', m.id)
                  }}
                  onDoubleClick={() => m && onUse(m)}
                  title={m ? (m.type === 'audio' ? 'Drag onto an audio track, or double-click to add at the playhead' : 'Drag to the timeline, or double-click to add at the end') : 'Getting this file ready…'}
                >
                  <div className="thumb" style={{ backgroundImage: m && m.thumb ? `url("${toUrl(m.thumb)}")` : undefined }}>
                    {m && m.type === 'audio' && <span className="note"><Icon name="music" size={22} /></span>}
                    {m && <span className="badge">{m.type}</span>}
                  </div>
                  <button className="bin-x" title="Delete from the library (Recycle Bin)" onClick={(e) => { e.stopPropagation(); remove(f) }}>×</button>
                  <div className="meta">
                    <div className="name">{f.name}</div>
                    <div className="sub">{m ? (m.type !== 'image' ? fmtTime(m.duration).slice(0, 5) : `${m.width}×${m.height}`) : 'getting ready…'}</div>
                  </div>
                </div>
              )
            })}
            <button className="lib-add" onClick={add}>+ Add files…</button>
          </>
        )}
        {!files && <div className="hint">Looking…</div>}
      </div>
    </aside>
  )
}
