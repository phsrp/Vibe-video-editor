import Icon from './Icon.jsx'

// Pops up when a new version exists. Nothing is downloaded until the user clicks Download.
export default function UpdateDialog({ update, onDownload, onLater, onHide, onInstall }) {
  return (
    <div className="modal-bg top">
      <div className="modal update-modal">
        {update.state === 'available' && (
          <>
            <h3>A new version is available</h3>
            <p className="upd-text">
              Vibe Video Editor <b>{update.version}</b> is ready to download. You have {update.current}.
            </p>
            {update.notes && update.notes.length > 0 && (
              <>
                <div className="upd-new">What's new</div>
                <ul className="upd-notes">
                  {update.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="hint left">Your projects and settings are not affected.</div>
            <div className="modal-foot">
              <button onClick={onLater}>Remind me later</button>
              <button className="primary" onClick={onDownload}>
                <Icon name="download" /> Download
              </button>
            </div>
          </>
        )}

        {update.state === 'downloading' && (
          <>
            <h3>Downloading {update.version}…</h3>
            <div className="bar"><div className="bar-fill" style={{ width: `${update.percent || 0}%` }} /></div>
            <div className="exp-pct">{update.percent || 0}%</div>
            <div className="modal-foot">
              <span />
              <button onClick={onHide}>Hide (keeps downloading)</button>
            </div>
          </>
        )}

        {update.state === 'ready' && (
          <>
            <h3>Ready to install</h3>
            <p className="upd-text">
              Version <b>{update.version}</b> has been downloaded. The editor will close, update and reopen.
            </p>
            <div className="hint left">If you choose later, it installs when you next close the editor. Unsaved work is never lost: you will be asked about it first.</div>
            <div className="modal-foot">
              <button onClick={onHide}>Later</button>
              <button className="primary" onClick={onInstall}>
                <Icon name="refresh" /> Restart now
              </button>
            </div>
          </>
        )}

        {update.state === 'error' && (
          <>
            <h3>Update problem</h3>
            <p className="upd-text">The update could not be downloaded. Check your internet connection and try again later.</p>
            <div className="modal-foot">
              <span />
              <button className="primary" onClick={onHide}>OK</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
