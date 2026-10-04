import { useEffect, useRef, useState } from 'react'
import Editor from './Editor.jsx'
import Home from './Home.jsx'
import Icon from './Icon.jsx'
import SettingsDialog from './SettingsDialog.jsx'
import UpdateDialog from './UpdateDialog.jsx'
import { loadBinds, saveBinds } from './keybinds.js'

let tabCounter = 0
const newId = () => `p${Date.now().toString(36)}${tabCounter++}`

// The window: a tab bar (Home + one tab per open project), and the global things
// (theme, settings, updates). Each open project is its own <Editor>.
export default function App() {
  const [tabs, setTabs] = useState([]) // [{id, title, path, dirty, initial}]
  const [activeId, setActiveId] = useState('home')
  const handles = useRef({})
  const [binds, setBinds] = useState(loadBinds)
  const [showSettings, setShowSettings] = useState(false)
  const [version, setVersion] = useState('')
  const [settings, setSettingsState] = useState({ autoUpdate: true })
  const [update, setUpdate] = useState({ state: 'idle' })
  const [hidden, setHidden] = useState(false) // update popup dismissed for now
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('vibe.theme') || 'dark'
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('vibe.theme', theme)
    } catch {}
  }, [theme])
  useEffect(() => {
    saveBinds(binds)
  }, [binds])

  // ---- settings & updates
  useEffect(() => {
    window.api.appVersion().then(setVersion)
    window.api.getSettings().then(setSettingsState)
    return window.api.onUpdateStatus((s) => {
      setUpdate(s)
      if (s.state === 'available' || s.state === 'ready' || s.state === 'error') setHidden(false)
    })
  }, [])
  const setSettings = async (patch) => setSettingsState(await window.api.setSettings(patch))
  const checkNow = () => window.api.checkForUpdates()
  const showPopup = !hidden && (['available', 'downloading', 'ready'].includes(update.state) || (update.state === 'error' && update.during === 'download'))
  const updatePending = ['snoozed'].includes(update.state) || (hidden && ['available', 'downloading', 'ready'].includes(update.state))

  // ---- tabs
  const newTab = (initial = null) => {
    const id = newId()
    setTabs((t) => [...t, { id, title: 'Untitled', path: initial && initial.file, dirty: false, initial }])
    setActiveId(id)
  }
  const onMeta = (id, meta) => setTabs((t) => t.map((x) => (x.id === id ? { ...x, ...meta } : x)))
  const registerHandle = (id, h) => {
    if (h) handles.current[id] = h
    else delete handles.current[id]
  }

  const openFile = (file, json) => {
    const existing = tabs.find((t) => t.path === file)
    if (existing) setActiveId(existing.id)
    else newTab({ file, json })
  }
  const openDialog = async () => {
    const res = await window.api.openProject()
    if (res) openFile(res.file, res.json)
  }
  const openRecent = async (r) => {
    try {
      const res = await window.api.readProject(r.path)
      openFile(res.file, res.json)
    } catch {
      window.alert('That project file could not be opened. It may have been moved or deleted.')
      window.api.recentRemove(r.path)
    }
  }

  const closeTab = async (id) => {
    const tab = tabs.find((t) => t.id === id)
    const h = handles.current[id]
    if (tab && h && h.isDirty()) {
      const choice = await window.api.askSave(tab.title)
      if (choice === 2) return
      if (choice === 0 && !(await h.save())) return
    }
    window.api.clearAutosave(id)
    const idx = tabs.findIndex((t) => t.id === id)
    const rest = tabs.filter((t) => t.id !== id)
    setTabs(rest)
    if (activeId === id) setActiveId(rest.length ? rest[Math.max(0, idx - 1)].id : 'home')
  }

  // the window warns on close if any project has unsaved changes
  useEffect(() => {
    window.api.setDirty(tabs.some((t) => t.dirty))
  }, [tabs])

  const activeTab = tabs.find((t) => t.id === activeId)
  useEffect(() => {
    document.title = activeTab ? `${activeTab.dirty ? '• ' : ''}${activeTab.title} - Vibe Video Editor` : 'Vibe Video Editor'
  }, [activeTab && activeTab.title, activeTab && activeTab.dirty, activeId])

  // start-up: bring back projects that were open but never saved
  useEffect(() => {
    ;(async () => {
      if (await window.api.isTest()) {
        newTab() // tests drive a project directly
        return
      }
      const saved = (await window.api.listAutosaves()).filter((a) => {
        try {
          const d = JSON.parse(a.json)
          return (d.clips || []).length || (d.audioClips || []).length
        } catch {
          return false
        }
      })
      if (!saved.length) return window.api.clearAutosave()
      const n = saved.length
      if (window.confirm(`Restore ${n === 1 ? 'the project' : n + ' projects'} you had open last time (not saved)?`)) {
        window.api.clearAutosave()
        saved.forEach((a, i) => {
          const id = newId()
          setTabs((t) => [...t, { id, title: 'Untitled', path: null, dirty: true, initial: { file: null, json: a.json } }])
          if (i === 0) setActiveId(id)
        })
      } else window.api.clearAutosave()
    })()
  }, [])

  return (
    <div className="shell">
      <div className="tabbar">
        <button className={'tab home-tab' + (activeId === 'home' ? ' on' : '')} onClick={() => setActiveId('home')} title="Home">
          <Icon name="home" /> Home
        </button>
        {tabs.map((t) => (
          <div key={t.id} className={'tab' + (activeId === t.id ? ' on' : '')} onClick={() => setActiveId(t.id)} title={t.path || 'Not saved yet'}>
            <span className="tab-title">{t.title}</span>
            {t.dirty && <span className="tab-dot" title="Unsaved changes" />}
            <button
              className="tab-x"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
              title="Close this project"
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        ))}
        <button className="tab-plus" onClick={() => newTab()} title="New project">
          <Icon name="plus" size={14} />
        </button>

        <span className="spacer" />
        {updatePending && (
          <button className="primary upd-badge" onClick={() => {
              setHidden(false)
              if (update.state === 'snoozed') window.api.checkForUpdates()
            }} title="A new version is available">
            <Icon name="download" size={13} /> Update {update.version}
          </button>
        )}
        <button className="ver" onClick={() => setShowSettings(true)} title="Settings">
          v{version}
        </button>
        <button onClick={() => setShowSettings(true)} title="Settings">
          <Icon name="sliders" /> Settings
        </button>
      </div>

      <div className="host">
        <Home active={activeId === 'home'} onNew={() => newTab()} onOpen={openDialog} onOpenRecent={openRecent} />
        {tabs.map((t) => (
          <Editor
            key={t.id}
            tabId={t.id}
            active={activeId === t.id}
            initial={t.initial}
            binds={binds}
            setBinds={setBinds}
            onMeta={onMeta}
            onNew={() => newTab()}
            onOpen={openDialog}
            registerHandle={registerHandle}
          />
        ))}
      </div>

      {showPopup && (
        <UpdateDialog
          update={update}
          onDownload={() => window.api.downloadUpdate()}
          onLater={() => {
            window.api.snoozeUpdate()
            setHidden(true)
          }}
          onHide={() => setHidden(true)}
          onInstall={() => window.api.installUpdate()}
        />
      )}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          setSettings={setSettings}
          theme={theme}
          setTheme={setTheme}
          version={version}
          onCheck={checkNow}
          update={update}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
