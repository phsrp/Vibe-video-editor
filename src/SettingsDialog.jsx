import Icon from './Icon.jsx'

export default function SettingsDialog({ settings, setSettings, theme, setTheme, version, onCheck, update, onClose }) {
  const checking = update.state === 'checking'
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
            <div className="hint left">Check for a new version when the editor starts and every few hours, and ask before downloading anything.</div>
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
