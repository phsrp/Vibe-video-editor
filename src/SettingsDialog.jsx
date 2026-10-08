import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

export default function SettingsDialog({ settings, setSettings, theme, setTheme, version, onCheck, update, onClose }) {
  const checking = update.state === 'checking'
  const [px, setPx] = useState(null) // the smooth preview copies on disk: {count, bytes, making}
  const loadPx = () => window.api.proxyInfo().then(setPx).catch(() => {})
  useEffect(() => {
    loadPx()
  }, [])
  const mb = px ? Math.round(px.bytes / 1048576) : 0
  let result = ''
  if (update.state === 'uptodate') result = "You're up to date."
  else if (update.state === 'error') result = 'Could not check (are you online?).'
  else if (update.state === 'dev') result = 'Updates only work in the installed app.'
  else if (update.state === 'available' || update.state === 'snoozed') result = `Version ${update.version} is available.`

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>

        <div className="set-row">
          <div>
            <div className="set-title">Automatic updates</div>
            <div className="hint left">Check for a new version when the editor opens, and ask before downloading anything.</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => setSettings({ autoUpdate: e.target.checked })} />
            <span className="slider" />
          </label>
        </div>

        <div className="set-row">
          <div>
            <div className="set-title">Version {version}</div>
            <div className="hint left">{result || 'You can always check by hand.'}</div>
          </div>
          <button onClick={onCheck} disabled={checking}>
            <Icon name="refresh" /> {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>

        <div className="set-row">
          <div>
            <div className="set-title">Smooth preview for big videos</div>
            <div className="hint left">
              4K and very heavy videos get a small copy in the background, so the preview plays and jumps around smoothly. The export always uses your original file.
              {px && px.count > 0 ? ` Copies on this PC: ${px.count} (${mb} MB).` : ''}
            </div>
          </div>
          <span className="set-col">
            <select value={settings.proxyMode || 'auto'} onChange={(e) => setSettings({ proxyMode: e.target.value })}>
              <option value="auto">Auto (big videos only)</option>
              <option value="always">Every video</option>
              <option value="off">Off</option>
            </select>
            {px && px.count > 0 && (
              <button className="mini" onClick={() => window.api.proxyClear().then(loadPx)} title="Delete the smooth copies. They are made again when a project with big videos is opened.">
                Delete copies
              </button>
            )}
          </span>
        </div>

        <div className="set-row">
          <div className="set-title">Theme</div>
          <div className="seg">
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>
              <Icon name="moon" /> Rosé Pine
            </button>
            <button className={theme === 'dawn' ? 'on' : ''} onClick={() => setTheme('dawn')}>
              <Icon name="sun" /> Dawn
            </button>
          </div>
        </div>

        <div className="modal-foot">
          <span />
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
