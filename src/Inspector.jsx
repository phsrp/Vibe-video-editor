import { layout } from './state.js'
import Icon from './Icon.jsx'
import { PROPS, EASES, evalProp, keyAt, KEY_EPS } from './motion.js'

const label = (n) => n.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())


// Position / scale / rotation / opacity with keyframes for one clip, at the current playhead.
function MotionPanel({ clip, playhead, dispatch }) {
  const ts = Math.min(clip.out, Math.max(clip.in, clip.in + (playhead - clip.start)))
  const inside = playhead >= clip.start - 0.001 && playhead <= clip.start + clip.dur + 0.001
  const seek = (t) => dispatch({ type: 'setPlayhead', t: clip.start + (t - clip.in), user: true })
  return (
    <>
      <div className="insp-section">Motion</div>
      {!inside && <div className="hint warn">Move the playhead over this clip to edit its motion.</div>}
      {PROPS.map((p) => {
        const list = (clip.anim && clip.anim[p.id]) || []
        const val = evalProp(clip, p.id, ts)
        const kf = keyAt(list, ts)
        const prev = [...list].reverse().find((k) => k.t < ts - KEY_EPS)
        const next = list.find((k) => k.t > ts + KEY_EPS)
        const set = (v) => dispatch({ type: 'setProp', id: clip.id, prop: p.id, value: v, t: ts })
        const shown = Math.round(val * 100) / 100
        return (
          <div className="mrow" key={p.id}>
            <div className="mtop">
              <span className="mlabel">{p.label}</span>
              <span className="kfctl">
                <button className="mini" disabled={!prev} onClick={() => seek(prev.t)} title="Previous keyframe"><Icon name="left" size={12} /></button>
                <button
                  className={'mini kf-btn' + (kf ? ' on' : '')}
                  onClick={() => dispatch({ type: 'toggleKey', id: clip.id, prop: p.id, t: ts })}
                  title={kf ? 'Remove this keyframe' : 'Add a keyframe here'}
                >
                  <Icon name="diamond" size={11} fill={!!kf} />
                </button>
                <button className="mini" disabled={!next} onClick={() => seek(next.t)} title="Next keyframe"><Icon name="right" size={12} /></button>
              </span>
            </div>
            <div className="minput">
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={Math.min(p.max, Math.max(p.min, val))}
                onPointerDown={() => dispatch({ type: 'checkpoint' })}
                onChange={(e) => set(+e.target.value)}
              />
              <input
                type="number"
                step={p.step}
                value={shown}
                onFocus={() => dispatch({ type: 'checkpoint' })}
                onChange={(e) => e.target.value !== '' && set(+e.target.value)}
              />
              <span className="unit">{p.unit}</span>
            </div>
            {list.length > 0 && (
              <div className="mease">
                {kf ? (
                  <select value={kf.ease} onChange={(e) => dispatch({ type: 'setEase', id: clip.id, prop: p.id, t: ts, ease: e.target.value })} title="How the value changes from this keyframe to the next">
                    {Object.entries(EASES).map(([k, e]) => (
                      <option key={k} value={k}>{e.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="hint left">{list.length} keyframe{list.length > 1 ? 's' : ''}. Stand on one to change its easing.</span>
                )}
                <button className="mini" onClick={() => dispatch({ type: 'clearProp', id: clip.id, prop: p.id })} title="Remove all keyframes and reset">Reset</button>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
export default function Inspector({ state, dispatch, transitions, errors, onReload, onOpenFolder }) {
  const lay = layout(state.clips)
  const only = state.selection.length === 1 ? state.selection[0] : null
  const idx = lay.findIndex((c) => c.id === only)
  const clip = lay[idx]
  const media = clip && state.media.find((m) => m.id === clip.mediaId)
  const cur = clip && clip.transition && clip.transition.name

  const preview = () => {
    dispatch({ type: 'setPlayhead', t: Math.max(0, clip.start - 0.7), user: true })
    dispatch({ type: 'setPlaying', value: true })
  }

  return (
    <aside className="inspector">
      <div className="panel-title">Inspector</div>
      <div className="insp-body">
        {state.selection.length === 0 && (
          <div className="hint">Select a clip on the timeline to edit it or give it a transition from the previous clip. Drag a box around items to select several.</div>
        )}
        {state.selection.length > 1 && <div className="hint">{state.selection.length} items selected. Use the timeline toolbar to Group, Ungroup or Delete them.</div>}
        {state.selection.length === 1 && !clip && <div className="hint">Audio selected. Drag it to move it, drag its edges to trim it, or press Delete.</div>}
        {clip && (
          <>
            <div className="insp-clip">{media ? media.name : 'Clip'}</div>

            {media && media.type === 'image' && (
              <label className="insp-row">
                Show for (seconds)
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={+(clip.out - clip.in).toFixed(2)}
                  onFocus={() => dispatch({ type: 'checkpoint' })}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (v > 0) dispatch({ type: 'trim', id: clip.id, side: 'out', value: clip.in + v })
                  }}
                />
              </label>
            )}

            <MotionPanel clip={clip} playhead={state.playhead} dispatch={dispatch} />

            <div className="insp-section">Transition</div>
            {idx === 0 ? (
              <div className="hint left">This is the first clip. A transition goes <i>between</i> two clips, so select a later clip.</div>
            ) : (
              <>
                <div className="insp-sub">Into this clip, from the previous one:</div>
                <div className="tr-grid">
                  <button className={!cur ? 'on' : ''} onClick={() => dispatch({ type: 'setTransition', id: clip.id, transition: null })}>
                    None (cut)
                  </button>
                  {transitions.map((t) => (
                    <button
                      key={t.name}
                      className={cur === t.name ? 'on' : errors[t.name] ? 'bad' : ''}
                      title={errors[t.name] ? 'This file has a shader error:\n' + errors[t.name] : label(t.name)}
                      onClick={() =>
                        dispatch({
                          type: 'setTransition',
                          id: clip.id,
                          transition: { name: t.name, duration: (clip.transition && clip.transition.duration) || 1 },
                        })
                      }
                    >
                      {errors[t.name] && <Icon name="alert" size={12} />}
                      {label(t.name)}
                    </button>
                  ))}
                </div>
                {cur && (
                  <>
                    <label className="insp-row">
                      Duration: {clip.transition.duration.toFixed(2)}s
                      <input
                        type="range"
                        min="0.2"
                        max="4"
                        step="0.05"
                        value={clip.transition.duration}
                        onPointerDown={() => dispatch({ type: 'checkpoint' })}
                        onChange={(e) => dispatch({ type: 'setTransitionDuration', id: clip.id, duration: +e.target.value })}
                      />
                    </label>
                    {clip.ov < clip.transition.duration - 0.01 && (
                      <div className="hint warn">Limited to {clip.ov.toFixed(2)}s by the length of the neighbouring clips.</div>
                    )}
                    <button className="primary" onClick={preview}><Icon name="play" size={12} fill /> Preview transition</button>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
      <div className="insp-foot">
        <button onClick={onOpenFolder} title="Drop new .glsl transition files in here"><Icon name="folder" /> Transitions folder</button>
        <button onClick={onReload}><Icon name="refresh" /> Reload</button>
      </div>
    </aside>
  )
}
