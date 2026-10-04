import { layout, overlayLayout, soleVideoClip } from './state.js'
import Icon from './Icon.jsx'
import { PROPS, evalProp, keyAt, KEY_EPS } from './motion.js'
import EaseEditor from './EaseEditor.jsx'

const label = (n) => n.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())


// Position / scale / stretch / rotation / opacity with keyframes for one clip, at the current playhead.
// The same things can be dragged on the preview (see TransformOverlay).
function MotionPanel({ clip, playhead, dispatch, mode, setMode, freeMode, setFreeMode }) {
  const ts = Math.min(clip.out, Math.max(clip.in, clip.in + (playhead - clip.start)))
  const inside = playhead >= clip.start - 0.001 && playhead <= clip.start + clip.dur + 0.001
  const seek = (t) => dispatch({ type: 'setPlayhead', t: clip.start + (t - clip.in), user: true })
  // all the motion keyframe times together
  const times = []
  for (const list of Object.values(clip.anim || {})) for (const k of list || []) if (!times.some((x) => Math.abs(x - k.t) < KEY_EPS)) times.push(k.t)
  times.sort((x, y) => x - y)
  const here = times.find((x) => Math.abs(x - ts) < KEY_EPS)
  const prevT = [...times].reverse().find((x) => x < ts - KEY_EPS)
  const nextT = times.find((x) => x > ts + KEY_EPS)
  const firstKey = here != null ? PROPS.map((p) => keyAt(clip.anim && clip.anim[p.id], ts)).find(Boolean) : null
  return (
    <>
      <div className="insp-section">Transform</div>
      {!inside && <div className="hint warn">Move the playhead over this clip to edit it.</div>}
      <div className="mtop">
        <button className={'mini wide' + (mode === 'transform' ? ' on' : '')} onClick={() => setMode(mode === 'transform' ? 'none' : 'transform')} title="Show the box on the preview: drag inside to move, drag a corner to resize, drag the round handle to rotate">
          {mode === 'transform' ? 'Hide box' : 'Show box on preview'}
        </button>
        <button className={'mini wide' + (freeMode ? ' on' : '')} onClick={() => setFreeMode(!freeMode)} title="Free transform: the corners stretch the picture wider or taller instead of keeping its shape">
          Free transform
        </button>
      </div>
      <div className="mtop kfall">
        <span className="mlabel">Keyframe</span>
        <span className="kfctl">
          <button className="mini" disabled={prevT == null} onClick={() => seek(prevT)} title="Previous keyframe"><Icon name="left" size={12} /></button>
          <button className={'mini kf-btn' + (here != null ? ' on' : '')} onClick={() => dispatch({ type: 'toggleKeyAll', id: clip.id, t: ts })} title={here != null ? 'Remove the keyframe here' : 'Add a keyframe here (keeps everything as it is now)'}>
            <Icon name="diamond" size={11} fill={here != null} />
          </button>
          <button className="mini" disabled={nextT == null} onClick={() => seek(nextT)} title="Next keyframe"><Icon name="right" size={12} /></button>
        </span>
      </div>
      {here != null ? (
        <EaseEditor
          ease={firstKey ? firstKey.ease : 'easeInOut'}
          bez={firstKey && firstKey.bez}
          onStart={() => dispatch({ type: 'checkpoint' })}
          onChange={(ease, bez, live) => dispatch({ type: 'setEaseAll', id: clip.id, t: ts, ease, bez, live })}
        />
      ) : (
        <div className="hint left">
          {times.length
            ? `${times.length} keyframe${times.length > 1 ? 's' : ''}. Stand on one to change its easing. Changing something at a new moment adds a keyframe there.`
            : 'To animate: add a keyframe, move the playhead, then change the picture (drag it on the preview or use the sliders).'}
        </div>
      )}
      {PROPS.map((p) => {
        const list = (clip.anim && clip.anim[p.id]) || []
        const val = evalProp(clip, p.id, ts)
        const kf = keyAt(list, ts)
        const set = (v) => dispatch({ type: 'setProp', id: clip.id, prop: p.id, value: v, t: ts })
        const shown = Math.round(val * 100) / 100
        return (
          <div className="mrow" key={p.id}>
            <div className="mtop">
              <span className="mlabel">{p.label}</span>
              <span className="kfctl">
                {list.length > 0 && <button className="mini" onClick={() => dispatch({ type: 'clearProp', id: clip.id, prop: p.id })} title="Remove this property's keyframes and reset it">Reset</button>}
                <button
                  className={'mini kf-btn' + (kf ? ' on' : '')}
                  onClick={() => dispatch({ type: 'toggleKey', id: clip.id, prop: p.id, t: ts })}
                  title={kf ? 'Remove this keyframe' : 'Add a keyframe for just this property'}
                >
                  <Icon name="diamond" size={11} fill={!!kf} />
                </button>
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
          </div>
        )
      })}
    </>
  )
}

// Funny warp: drag the four corners of the picture anywhere (corner pin). One keyframe holds the whole shape.
function WarpPanel({ clip, playhead, dispatch, mode, setMode }) {
  const ts = Math.min(clip.out, Math.max(clip.in, clip.in + (playhead - clip.start)))
  const inside = playhead >= clip.start - 0.001 && playhead <= clip.start + clip.dur + 0.001
  const seek = (t) => dispatch({ type: 'setPlayhead', t: clip.start + (t - clip.in), user: true })
  const keys = (clip.warp && clip.warp.keys) || []
  const kf = keyAt(keys, ts)
  const prev = [...keys].reverse().find((k) => k.t < ts - KEY_EPS)
  const next = keys.find((k) => k.t > ts + KEY_EPS)
  const warped = !!clip.warp && (keys.length > 0 || (clip.warp.fixed || []).some((v) => v !== 0))
  const on = mode === 'warp'
  return (
    <>
      <div className="insp-section">Funny warp</div>
      <div className="mtop">
        <button className={'mini wide' + (on ? ' on' : '')} onClick={() => setMode(on ? 'transform' : 'warp')} title="Show four handles on the preview and drag them to bend the picture">
          <Icon name="diamond" size={11} /> {on ? 'Hide handles' : 'Funny warp on preview'}
        </button>
        <span className="kfctl">
          <button className="mini" disabled={!prev} onClick={() => seek(prev.t)} title="Previous warp keyframe"><Icon name="left" size={12} /></button>
          <button className={'mini kf-btn' + (kf ? ' on' : '')} onClick={() => dispatch({ type: 'warpToggleKey', id: clip.id, t: ts })} title={kf ? 'Remove this warp keyframe' : 'Add a warp keyframe here (keeps the current shape)'}>
            <Icon name="diamond" size={11} fill={!!kf} />
          </button>
          <button className="mini" disabled={!next} onClick={() => seek(next.t)} title="Next warp keyframe"><Icon name="right" size={12} /></button>
        </span>
      </div>
      {!inside && on && <div className="hint warn">Move the playhead over this clip to warp it.</div>}
      {kf && (
        <EaseEditor
          ease={kf.ease}
          bez={kf.bez}
          onStart={() => dispatch({ type: 'checkpoint' })}
          onChange={(ease, bez, live) => dispatch({ type: 'warpEase', id: clip.id, t: ts, ease, bez, live })}
        />
      )}
      {keys.length > 0 && !kf && <div className="hint left">{keys.length} keyframe{keys.length > 1 ? 's' : ''}. Stand on one to change its easing.</div>}
      {warped && (
        <button className="mini wide" onClick={() => dispatch({ type: 'warpReset', id: clip.id })} title="Remove the warp and its keyframes">Reset warp</button>
      )}
    </>
  )
}
export default function Inspector({ state, dispatch, transitions, errors, onReload, onOpenFolder, mode, setMode, freeMode, setFreeMode, open = true, setOpen }) {
  const lay = layout(state.clips)
  const only = soleVideoClip(state)
  const idx = lay.findIndex((c) => c.id === only)
  const oclip = overlayLayout(state.overlayClips).find((c) => c.id === only)
  const clip = lay[idx] || oclip
  const media = clip && state.media.find((m) => m.id === clip.mediaId)
  const cur = clip && clip.transition && clip.transition.name

  const preview = () => {
    dispatch({ type: 'setPlayhead', t: Math.max(0, clip.start - 0.7), user: true })
    dispatch({ type: 'setPlaying', value: true })
  }

  return (
    <aside className={'inspector' + (open ? '' : ' collapsed')}>
      {!open && (
        <button className="collapse-strip" onClick={() => setOpen(true)} title="Show the inspector">
          <Icon name="left" size={14} />
          <span>Inspector</span>
        </button>
      )}
      <div className="panel-title">
        Inspector
        <button className="mini" onClick={() => setOpen(false)} title="Hide the inspector"><Icon name="right" size={12} /></button>
      </div>
      <div className="insp-body">
        {state.selection.length === 0 && (
          <div className="hint">Select a clip on the timeline to edit it or give it a transition from the previous clip. Drag a box around items to select several.</div>
        )}
        {state.selection.length > 1 && !clip && <div className="hint">{state.selection.length} items selected. Use the timeline toolbar to Group, Ungroup or Delete them.</div>}
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
                    if (v > 0) dispatch({ type: oclip ? 'trimOverlay' : 'trim', id: clip.id, side: 'out', value: clip.in + v })
                  }}
                />
              </label>
            )}

            <MotionPanel clip={clip} playhead={state.playhead} dispatch={dispatch} mode={mode} setMode={setMode} freeMode={freeMode} setFreeMode={setFreeMode} />
            <WarpPanel clip={clip} playhead={state.playhead} dispatch={dispatch} mode={mode} setMode={setMode} />

            {oclip && <div className="hint left">This clip is on an overlay track. Drag it along its track to choose when it appears; transitions only work on the main video track.</div>}
            {!oclip && <div className="insp-section">Transition</div>}
            {oclip ? null : idx === 0 ? (
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
