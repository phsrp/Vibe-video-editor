import { useEffect, useState } from 'react'
import { layout, overlayLayout, soleVideoClip, srcAt, tlOf, speedOf, fmtDur, aspectRatio } from './state.js'
import Icon from './Icon.jsx'
import { PROPS, evalProp, keyAt, KEY_EPS } from './motion.js'
import EaseEditor from './EaseEditor.jsx'
import { FX_SLIDERS, KEY_DEFAULTS } from './effects.js'
import { TEXT_DEFAULTS, TEXT_FONTS, TEXT_ANIMS, TEXT_PRESETS } from './textRender.js'
import { LABELS } from './labels.js'

const label = (n) => n.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// Speed (slow motion / fast forward) and playing a clip backwards.
function SpeedPanel({ clip, dispatch }) {
  const sp = speedOf(clip)
  const pos = Math.round((100 * Math.log(sp / 0.1)) / Math.log(80))
  const set = (v, live) => dispatch({ type: 'setSpeed', id: clip.id, speed: v, live })
  return (
    <Section id="speed" title="Speed and direction">
      <div className="mtop">
        <span className="mlabel">Speed</span>
        <span className="minput speed-in">
          <input type="number" min="0.1" max="8" step="0.05" value={+sp.toFixed(2)} onChange={(e) => e.target.value !== '' && set(+e.target.value)} />
          <span className="unit">×</span>
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={pos}
        onPointerDown={() => dispatch({ type: 'checkpoint' })}
        onChange={(e) => set(0.1 * Math.pow(80, +e.target.value / 100), true)}
      />
      <div className="mtop btnrow">
        {[0.25, 0.5, 1, 2, 4].map((v) => (
          <button key={v} className={'mini wide' + (Math.abs(sp - v) < 0.005 ? ' on' : '')} onClick={() => set(v)}>{v}×</button>
        ))}
      </div>
      <div className="mtop btnrow">
        <button className={'mini wide' + (clip.reverse ? ' on' : '')} onClick={() => dispatch({ type: 'setReverse', id: clip.id, value: !clip.reverse })} title="Play this clip backwards">
          <Icon name="rewind" size={13} /> Reverse
        </button>
      </div>
      <div className="hint left">
        Lasts {fmtDur(clip.dur)} on the timeline. {clip.reverse ? 'A reversed clip takes a moment to prepare for the preview and is silent there; the export has its reversed sound. ' : ''}Speed changes the sound's speed too, and keeps its pitch.
      </div>
    </Section>
  )
}

// The text of a text clip: what it says, its look and how it appears and disappears.
function TextPanel({ clip, dispatch, noAnim }) {
  const tx = { ...TEXT_DEFAULTS, ...clip.text }
  const set = (patch) => dispatch({ type: 'setText', id: clip.id, patch })
  const live = (patch) => dispatch({ type: 'setText', id: clip.id, patch, live: true })
  const start = () => dispatch({ type: 'checkpoint' })
  return (
    <Section id="text" title="Text">
      <textarea
        className="text-edit"
        rows="3"
        value={tx.content}
        onFocus={start}
        onChange={(e) => live({ content: e.target.value })}
        placeholder="Type your text here"
      />
      <div className="mtop btnrow">
        {TEXT_PRESETS.map((p) => (
          <button key={p.name} className="mini wide" onClick={() => dispatch({ type: 'applyTextPreset', id: clip.id, text: p.text, y: p.y })}>{p.name}</button>
        ))}
      </div>
      <div className="mtop">
        <span className="mlabel">Font</span>
        <select value={tx.font} onChange={(e) => set({ font: e.target.value })}>
          {TEXT_FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
          ))}
        </select>
      </div>
      <FxSlider label="Size" value={tx.size} min={2} max={30} step={0.5} onStart={start} onChange={(v) => live({ size: v })} />
      <div className="mtop btnrow">
        <button className={'mini wide' + (tx.bold ? ' on' : '')} onClick={() => set({ bold: !tx.bold })}><b>B</b></button>
        <button className={'mini wide' + (tx.italic ? ' on' : '')} onClick={() => set({ italic: !tx.italic })}><i>I</i></button>
        {['left', 'center', 'right'].map((al) => (
          <button key={al} className={'mini wide' + (tx.align === al ? ' on' : '')} onClick={() => set({ align: al })}>{al}</button>
        ))}
        <input type="color" value={tx.color} onPointerDown={start} onChange={(e) => live({ color: e.target.value })} title="Text colour" />
      </div>
      <label className="chk"><input type="checkbox" checked={!!tx.outline.on} onChange={(e) => set({ outline: { on: e.target.checked } })} />Outline</label>
      {tx.outline.on && (
        <div className="mtop">
          <input type="color" value={tx.outline.color} onPointerDown={start} onChange={(e) => live({ outline: { color: e.target.value } })} />
          <input type="range" min="1" max="20" value={tx.outline.width} onPointerDown={start} onChange={(e) => live({ outline: { width: +e.target.value } })} />
        </div>
      )}
      <label className="chk"><input type="checkbox" checked={!!tx.shadow.on} onChange={(e) => set({ shadow: { on: e.target.checked } })} />Shadow / glow</label>
      {tx.shadow.on && (
        <div className="mtop">
          <input type="color" value={tx.shadow.color} onPointerDown={start} onChange={(e) => live({ shadow: { color: e.target.value } })} />
          <input type="range" min="0" max="40" value={tx.shadow.blur} onPointerDown={start} onChange={(e) => live({ shadow: { blur: +e.target.value } })} />
        </div>
      )}
      <label className="chk"><input type="checkbox" checked={!!tx.bg.on} onChange={(e) => set({ bg: { on: e.target.checked } })} />Background box</label>
      {tx.bg.on && (
        <div className="mtop">
          <input type="color" value={tx.bg.color} onPointerDown={start} onChange={(e) => live({ bg: { color: e.target.value } })} />
          <input type="range" min="0" max="100" value={tx.bg.opacity} onPointerDown={start} onChange={(e) => live({ bg: { opacity: +e.target.value } })} />
        </div>
      )}
      {!noAnim && (
        <>
      <div className="mtop">
        <span className="mlabel">Appears</span>
        <select value={tx.animIn} onChange={(e) => set({ animIn: e.target.value })}>
          {TEXT_ANIMS.map((an) => (
            <option key={an.id} value={an.id}>{an.label}</option>
          ))}
        </select>
      </div>
      <div className="mtop">
        <span className="mlabel">Disappears</span>
        <select value={tx.animOut} onChange={(e) => set({ animOut: e.target.value })}>
          {TEXT_ANIMS.filter((an) => an.id !== 'type').map((an) => (
            <option key={an.id} value={an.id}>{an.label}</option>
          ))}
        </select>
      </div>
      <FxSlider label="Animation length (seconds)" value={tx.animDur} min={0.1} max={2} step={0.05} onStart={start} onChange={(v) => live({ animDur: v })} />
        </>
      )}
      <div className="hint left">{noAnim ? "Drag the text on the preview to move it, or use the Transform sliders." : "Drag the text on the preview to move it, or use the Transform sliders. Change how long it lasts by dragging its ends on the timeline."}</div>
    </Section>
  )
}

// A mask shows only part of the clip: a rectangle, an ellipse or a shape you draw around a subject.
function MaskPanel({ clip, dispatch, mode, setMode, still }) {
  const mk = clip.mask
  // the AI model for the smart mask is downloaded once, on request
  const [models, setModels] = useState(null) // {ready, totalBytes}
  const [gpu, setGpu] = useState(null) // the graphics card: {ok, weak, name}; the AI needs one
  const [dl, setDl] = useState(null) // {received, total} while downloading
  const [dlErr, setDlErr] = useState('')
  useEffect(() => {
    window.api.modelsStatus().then(setModels)
    import('./smartMask.js').then((m) => m.gpuInfo()).then(setGpu)
    return window.api.onModelsProgress(setDl)
  }, [])
  const download = async () => {
    setDlErr('')
    setDl({ received: 0, total: models ? models.totalBytes : 1 })
    const r = await window.api.modelsDownload()
    setDl(null)
    setModels(r)
    if (r.error) setDlErr(r.error)
  }
  const info = models // the AI model (downloaded on request)
  const noGpu = gpu !== null && !gpu.ok // no usable graphics card: the AI cannot run
  const ready = !!(info && info.ready) && !noGpu
  const start = () => dispatch({ type: 'checkpoint' })
  const set = (patch, live) => dispatch({ type: 'setMask', id: clip.id, patch, live })
  const shapeBtn = (shape, label) => (
    <button
      className={'mini wide' + (mk && mk.shape === shape ? ' on' : '')}
      onClick={() => {
        set({ shape })
        setMode('mask')
      }}
    >
      {label}
    </button>
  )
  return (
    <Section id="mask" title="Mask">
      <div className="mtop btnrow">
        {shapeBtn('rect', 'Rectangle')}
        {shapeBtn('ellipse', 'Ellipse')}
        <button className={'mini wide' + (mode === 'maskdraw' ? ' on' : '')} onClick={() => setMode(mode === 'maskdraw' ? 'mask' : 'maskdraw')} title="Draw freehand around the subject you want to keep">
          <Icon name="wand" size={13} /> Draw around subject
        </button>
      </div>
      <div className="mtop btnrow">
        <button className={'mini wide' + (mode === 'maskpoly' ? ' on' : '')} onClick={() => setMode(mode === 'maskpoly' ? 'mask' : 'maskpoly')} title="Click to place the points of a shape, then drag the points to adjust it">
          <Icon name="wand" size={13} /> Click points
        </button>
      </div>
      {!clip.text && (
        <div className="mtop btnrow">
          <button
            className={'mini wide' + (mode === 'maskdrawsmart' ? ' on' : '')}
            disabled={!ready}
            onClick={() => setMode(mode === 'maskdrawsmart' ? 'mask' : 'maskdrawsmart')}
            title={ready ? 'Draw a loop around the subject and the AI finds its exact edges on this frame' : noGpu ? 'Needs a graphics card' : 'Download the AI model first (below)'}
          >
            <Icon name="star" size={13} /> Smart select (AI)
          </button>
        </div>
      )}
      {!clip.text && noGpu && (
        <div className="hint warn">{still ? "Smart select needs a graphics card" : "Smart select and tracking need a graphics card"}, and this computer does not seem to have a usable one, so {still ? "it cannot" : "they cannot"} run here. The rectangle, ellipse, draw and click-points masks still work.</div>
      )}
      {!clip.text && !noGpu && gpu && gpu.weak && (
        <div className="hint warn">This computer's graphics ({gpu.name || 'basic integrated graphics'}) look basic. {still ? 'Smart select will run, but slowly.' : 'Smart select and tracking will run, but slowly: tracking can take minutes rather than seconds.'}</div>
      )}
      {!clip.text && !noGpu && !(info && info.ready) && (
        <>
          <div className="hint left">
            {still ? "Smart select uses" : "Smart select and tracking use"} an AI model (about {info ? Math.round(info.totalBytes / 1e6) : 112} MB). It is downloaded once from the internet and then works without it.
          </div>
          {dl ? (
            <>
              <div className="bar"><div className="bar-fill" style={{ width: Math.min(100, (dl.received / Math.max(1, dl.total)) * 100) + '%' }} /></div>
              <div className="hint left">Downloading… {Math.round((dl.received / Math.max(1, dl.total)) * 100)}%</div>
            </>
          ) : (
            <button className="mini wide" disabled={!info} onClick={download}><Icon name="download" size={13} /> Download the AI model</button>
          )}
          {dlErr && <div className="hint warn">{dlErr}</div>}
        </>
      )}
      {mode === 'maskdraw' && <div className="hint left">Draw a loop around the subject on the preview, then let go.</div>}
      {mode === 'maskpoly' && <div className="hint left">Click around the subject to place points. Click the first point, double-click or press Enter to finish. Afterwards drag any point to adjust it, double-click the outline to add a point, right-click a point to remove it.</div>}
      {mode === 'maskdrawsmart' && <div className="hint left">Draw a loose loop around the subject you want. The AI works out its exact edges.{still ? '' : ' When you let go, you can choose to track it through the video.'}</div>}
      {mk && (
        <>
          <FxSlider label="Soft edge" value={mk.feather || 0} min={0} max={100} onStart={start} onChange={(v) => set({ feather: v }, true)} />
          <FxSlider label="Grow / shrink" value={mk.expand || 0} min={-100} max={100} onStart={start} onChange={(v) => set({ expand: v }, true)} />
          <label className="chk"><input type="checkbox" checked={!!mk.invert} onChange={(e) => set({ invert: e.target.checked })} />Invert (keep everything outside)</label>
          <div className="mtop btnrow">
            <button className={'mini wide' + (mode === 'mask' ? ' on' : '')} onClick={() => setMode(mode === 'mask' ? 'transform' : 'mask')}>{mode === 'mask' ? 'Hide mask on preview' : 'Show mask on preview'}</button>
            <button className="mini wide" onClick={() => dispatch({ type: 'clearMask', id: clip.id })}>Remove mask</button>
          </div>
          <div className="hint left">{mk.frames && mk.frames.length ? "This mask is tracked: it has its own outline for every moment. To fix a bad moment, show the mask on the preview, go to that moment, drag its points (double-click the outline to add one, right-click to remove one), then press Re-track from here." : (still ? "Drag inside the mask to move it, drag its points to reshape it." : "Drag inside the mask to move it. To make it follow the subject, draw the mask around it and choose Track.")}</div>
          {!clip.text && (
            <button className="mini wide" onClick={() => dispatch({ type: 'maskCopyAbove', id: clip.id })} title="Makes a copy of this clip on a new track at the top, with the same mask, so the subject shows in front of text on the tracks below">
              <Icon name="layers" size={13} /> Subject in front of text
            </button>
          )}
        </>
      )}
    </Section>
  )
}

// A slider with a name, for the effects
function FxSlider({ label, value, min, max, step = 1, onChange, onStart }) {
  return (
    <div className="mrow">
      <div className="mtop"><span className="mlabel">{label}</span></div>
      <div className="minput">
        <input type="range" min={min} max={max} step={step} value={value} onPointerDown={onStart} onChange={(e) => onChange(+e.target.value)} />
        <input type="number" min={min} max={max} step={step} value={Math.round(value)} onFocus={onStart} onChange={(e) => e.target.value !== '' && onChange(+e.target.value)} />
      </div>
    </div>
  )
}

// Blur, sharpen, vignette, glow and chroma key (green screen). Colour correction has its own tab.
function EffectsPanel({ clip, dispatch, onOpenColour }) {
  const fx = clip.fx || {}
  const key = { ...KEY_DEFAULTS, ...(fx.key || {}) }
  const start = () => dispatch({ type: 'checkpoint' })
  const set = (patch) => dispatch({ type: 'setFx', id: clip.id, patch, live: true })
  const any = FX_SLIDERS.some((s) => (fx[s.id] || 0) !== 0) || key.on
  return (
    <Section id="effects" title="Effects">
      {FX_SLIDERS.map((s) => (
        <FxSlider key={s.id} label={s.label} value={fx[s.id] || 0} min={s.min} max={s.max} onStart={start} onChange={(v) => set({ [s.id]: v })} />
      ))}
      <label className="chk">
        <input type="checkbox" checked={key.on} onChange={(e) => dispatch({ type: 'setFx', id: clip.id, patch: { key: { on: e.target.checked } } })} />
        Chroma key (green screen)
      </label>
      {key.on && (
        <>
          <div className="mtop">
            <span className="mlabel">Colour to remove</span>
            <input type="color" value={key.color} onChange={(e) => set({ key: { color: e.target.value } })} onPointerDown={start} />
          </div>
          <FxSlider label="Strength (how close a colour must be)" value={key.sim} min={0} max={100} onStart={start} onChange={(v) => set({ key: { sim: v } })} />
          <FxSlider label="Soft edge" value={key.smooth} min={0} max={100} onStart={start} onChange={(v) => set({ key: { smooth: v } })} />
          <FxSlider label="Remove colour spill" value={key.spill} min={0} max={100} onStart={start} onChange={(v) => set({ key: { spill: v } })} />
          <div className="hint left">Put another clip on a track below this one to see it through the removed colour.</div>
        </>
      )}
      {any && <button className="mini wide" onClick={() => dispatch({ type: 'resetFx', id: clip.id, only: 'effects' })}>Reset effects</button>}
      {onOpenColour && (
        <button className="mini wide" onClick={() => onOpenColour(clip.id)} title="Open the Colour tab for this clip">
          <Icon name="palette" size={13} /> Colour correction…{fx.cc && Object.keys(fx.cc).length ? ' (on)' : ''}
        </button>
      )}
    </Section>
  )
}

// Colour label for the selected clips: a coloured stripe along the top of the clip, to find things at a glance.
function LabelRow({ state, dispatch }) {
  const ids = state.selection.filter((id) => !id.startsWith('sa:'))
  if (!ids.length) return null
  const items = [...state.clips, ...state.overlayClips, ...state.audioClips].filter((c) => ids.includes(c.id))
  const current = items.length && items.every((c) => c.label === items[0].label) ? items[0].label : null
  return (
    <div className="label-row">
      <span className="mlabel">Colour label</span>
      <span className="label-swatches">
        <button className={'swatch none' + (!current ? ' on' : '')} title="No label" onClick={() => dispatch({ type: 'setLabel', ids, color: null })} />
        {Object.entries(LABELS).map(([name, col]) => (
          <button key={name} className={'swatch' + (current === name ? ' on' : '')} style={{ background: col }} title={name} onClick={() => dispatch({ type: 'setLabel', ids, color: name })} />
        ))}
      </span>
    </div>
  )
}

// A section that folds open and closed (a dropdown). Whether it is open is remembered.
function Section({ id, title, children }) {
  const key = 'vibe.sec.' + id
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== '0'
    } catch {
      return true
    }
  })
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(key, open ? '0' : '1')
    } catch {}
  }
  return (
    <div className={'insp-sect' + (open ? ' open' : '')}>
      <button className="sect-head" onClick={toggle} title={open ? 'Fold this section away' : 'Open this section'}>
        <Icon name="right" size={12} />
        <span>{title}</span>
      </button>
      {open && <div className="sect-body">{children}</div>}
    </div>
  )
}

// Position / scale / stretch / rotation / opacity with keyframes for one clip, at the current playhead.
// The same things can be dragged on the preview (see TransformOverlay).
function MotionPanel({ clip, playhead, dispatch, mode, setMode, freeMode, setFreeMode, fill }) {
  const ts = srcAt(clip, playhead)
  const inside = playhead >= clip.start - 0.001 && playhead <= clip.start + clip.dur + 0.001
  const seek = (t) => dispatch({ type: 'setPlayhead', t: tlOf(clip, t), user: true })
  // all the motion keyframe times together
  const times = []
  for (const list of Object.values(clip.anim || {})) for (const k of list || []) if (!times.some((x) => Math.abs(x - k.t) < KEY_EPS)) times.push(k.t)
  times.sort((x, y) => x - y)
  const here = times.find((x) => Math.abs(x - ts) < KEY_EPS)
  const prevT = [...times].reverse().find((x) => x < ts - KEY_EPS)
  const nextT = times.find((x) => x > ts + KEY_EPS)
  const firstKey = here != null ? PROPS.map((p) => keyAt(clip.anim && clip.anim[p.id], ts)).find(Boolean) : null
  return (
    <Section id="transform" title="Transform and keyframes">
      {!inside && <div className="hint warn">Move the playhead over this clip to edit it.</div>}
      <div className="mtop btnrow">
        <button className={'mini wide' + (mode === 'transform' ? ' on' : '')} onClick={() => setMode(mode === 'transform' ? 'none' : 'transform')} title="Show the box on the preview: drag inside to move, drag a corner to resize, drag the round handle to rotate">
          {mode === 'transform' ? 'Hide box' : 'Show box on preview'}
        </button>
        <button className={'mini wide' + (freeMode ? ' on' : '')} onClick={() => setFreeMode(!freeMode)} title="Free transform: the corners stretch the picture wider or taller instead of keeping its shape">
          Free transform
        </button>
        <button className={'mini wide' + (mode === 'warp' ? ' on' : '')} onClick={() => setMode(mode === 'warp' ? 'transform' : 'warp')} title="Funny warp: drag the four corners of the picture anywhere to bend it">
          Funny warp
        </button>
      </div>
      {mode === 'warp' ? (
        <WarpControls clip={clip} playhead={playhead} dispatch={dispatch} />
      ) : (
        <>
      {fill && Math.abs(fill - 100) > 0.5 && (
        <div className="mtop btnrow">
          <button className="mini wide" onClick={() => dispatch({ type: 'setProp', id: clip.id, prop: 'scale', value: Math.round(fill * 10) / 10, t: ts })} title="Make the picture big enough to cover the whole frame (the edges are cropped)">Fill the frame</button>
          <button className="mini wide" onClick={() => dispatch({ type: 'setProp', id: clip.id, prop: 'scale', value: 100, t: ts })} title="Show the whole picture inside the frame">Fit in the frame</button>
        </div>
      )}
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
      {PROPS.filter((p) => !p.mask || clip.mask).map((p) => {
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
      )}
    </Section>
  )
}

// Funny warp controls (shown while Funny warp is on): drag the four corners on the preview. One keyframe
// holds the whole shape.
function WarpControls({ clip, playhead, dispatch }) {
  const ts = srcAt(clip, playhead)
  const inside = playhead >= clip.start - 0.001 && playhead <= clip.start + clip.dur + 0.001
  const seek = (t) => dispatch({ type: 'setPlayhead', t: tlOf(clip, t), user: true })
  const keys = (clip.warp && clip.warp.keys) || []
  const kf = keyAt(keys, ts)
  const prev = [...keys].reverse().find((k) => k.t < ts - KEY_EPS)
  const next = keys.find((k) => k.t > ts + KEY_EPS)
  const warped = !!clip.warp && (keys.length > 0 || (clip.warp.fixed || []).some((v) => v !== 0))
  return (
    <>
      {!inside && <div className="hint warn">Move the playhead over this clip to warp it.</div>}
      <div className="mtop kfall">
        <span className="mlabel">Warp keyframe</span>
        <span className="kfctl">
          <button className="mini" disabled={!prev} onClick={() => seek(prev.t)} title="Previous warp keyframe"><Icon name="left" size={12} /></button>
          <button className={'mini kf-btn' + (kf ? ' on' : '')} onClick={() => dispatch({ type: 'warpToggleKey', id: clip.id, t: ts })} title={kf ? 'Remove this warp keyframe' : 'Add a warp keyframe here (keeps the current shape)'}>
            <Icon name="diamond" size={11} fill={!!kf} />
          </button>
          <button className="mini" disabled={!next} onClick={() => seek(next.t)} title="Next warp keyframe"><Icon name="right" size={12} /></button>
        </span>
      </div>
      {kf && (
        <EaseEditor
          ease={kf.ease}
          bez={kf.bez}
          onStart={() => dispatch({ type: 'checkpoint' })}
          onChange={(ease, bez, live) => dispatch({ type: 'warpEase', id: clip.id, t: ts, ease, bez, live })}
        />
      )}
      <div className="hint left">
        {keys.length
          ? `${keys.length} keyframe${keys.length > 1 ? 's' : ''}. Move the playhead and drag a corner to add another, then pick its easing.`
          : 'Drag the four corners on the preview. To animate it: add a keyframe, move the playhead, drag the corners again.'}
      </div>
      {warped && (
        <button className="mini wide" onClick={() => dispatch({ type: 'warpReset', id: clip.id })} title="Remove the warp and its keyframes">Reset warp</button>
      )}
    </>
  )
}
// Volume (0 to 200%) and mute for the selected audio. They are the same settings as the sliders in the
// track labels on the timeline, so the two always agree. The setting belongs to the whole lane / track.
function AudioPanel({ state, dispatch }) {
  const id = state.selection[0]
  const [target, setTarget] = useState(-14)
  const [busy, setBusy] = useState(false)
  const [loud, setLoud] = useState('')
  let name = ''
  let st = null
  let patch = null
  let note = ''
  let source = null // what the loudness button measures: {file, from, to}
  if (id.startsWith('sa:')) {
    const n = +id.split(':')[2]
    const vc = state.clips.find((x) => x.id === id.split(':')[1])
    const vm = vc && state.media.find((m) => m.id === vc.mediaId)
    if (vc && vm && (vm.audioFiles || [])[n]) source = { file: vm.audioFiles[n], from: vc.in, to: vc.out }
    st = { volume: 1, mute: false, ...state.streamSettings[n] }
    name = st.name || `Video audio ${n + 1}`
    patch = (p) => dispatch({ type: 'setStream', n, patch: p })
    note = 'This sets the volume of the whole audio lane, for every clip on it.'
  } else {
    const a = state.audioClips.find((x) => x.id === id)
    const tr = a && state.audioTracks.find((x) => x.id === a.trackId)
    const am = a && state.media.find((m) => m.id === a.mediaId)
    const af = a && am ? (a.stream != null ? (am.audioFiles || [])[a.stream] : am.path) : null
    if (af) source = { file: af, from: a.in, to: a.out }
    if (tr) {
      st = tr
      name = tr.name
      patch = (p) => dispatch({ type: 'setTrack', id: tr.id, patch: p })
      note = 'This sets the volume of the whole track, for every clip on it.'
    }
  }
  if (!st) return <div className="hint">Audio selected. Drag it to move it, drag its edges to trim it, or press Delete.</div>
  const pct = Math.round(st.volume * 100)
  // measure how loud the selected clip is and set the volume so it comes out at the target loudness
  const normalise = async () => {
    setBusy(true)
    setLoud('')
    try {
      const r = await window.api.measureLoudness({ ...source, stream: 0 })
      if (r.lufs == null) setLoud('Could not measure this sound (is it silent?).')
      else {
        const factor = Math.pow(10, (target - r.lufs) / 20)
        const v = Math.max(0.05, Math.min(2, factor))
        patch({ volume: v })
        setLoud(`It measured ${r.lufs.toFixed(1)} LUFS. Volume set to ${Math.round(v * 100)}%` + (factor > 2 ? ' (the most the slider allows: it will still be quieter than the target)' : '') + '.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="insp-clip">{name}</div>
      <div className="insp-section">Audio</div>
      <div className="mtop">
        <span className="mlabel">Volume</span>
        <button className={'mini wide' + (st.mute ? ' on' : '')} onClick={() => patch({ mute: !st.mute })} title={st.mute ? 'Unmute' : 'Mute'}>
          <Icon name={st.mute ? 'mute' : 'volume'} size={13} /> {st.mute ? 'Muted' : 'Mute'}
        </button>
      </div>
      <div className="minput">
        <input type="range" min="0" max="200" step="1" value={pct} className={pct > 100 ? 'boosted' : ''} onChange={(e) => patch({ volume: +e.target.value / 100 })} />
        <input type="number" min="0" max="200" step="1" value={pct} onChange={(e) => e.target.value !== '' && patch({ volume: Math.max(0, Math.min(200, +e.target.value)) / 100 })} />
        <span className="unit">%</span>
      </div>
      <div className="mtop">
        <span className="hint left">{pct > 100 ? 'Boosted above the original. Very loud sound can distort.' : '100% is the original volume.'}</span>
        {pct !== 100 && <button className="mini wide" onClick={() => patch({ volume: 1 })}>Reset</button>}
      </div>
      <div className="hint left">{note}</div>
      {source && (
        <>
          <div className="mtop">
            <span className="mlabel">Match loudness to</span>
            <select value={target} onChange={(e) => setTarget(+e.target.value)}>
              <option value={-14}>-14 LUFS (YouTube, Spotify)</option>
              <option value={-16}>-16 LUFS (podcasts, phones)</option>
              <option value={-23}>-23 LUFS (TV, broadcast)</option>
            </select>
          </div>
          <button className="mini wide" disabled={busy} onClick={normalise} title="Measures this clip and sets the volume so it is as loud as the target">
            {busy ? 'Measuring…' : 'Normalise loudness'}
          </button>
          {loud && <div className="hint left">{loud}</div>}
        </>
      )}
      <div className="hint left">Drag the clip to move it, drag its edges to trim it, or press Delete.</div>
    </>
  )
}
export default function Inspector({ state, dispatch, transitions, errors, onReload, onOpenFolder, mode, setMode, freeMode, setFreeMode, open = true, setOpen, onOpenColour }) {
  const lay = layout(state.clips)
  const only = soleVideoClip(state)
  const idx = lay.findIndex((c) => c.id === only)
  const oclip = overlayLayout(state.overlayClips).find((c) => c.id === only)
  const clip = lay[idx] || oclip
  const media = clip && state.media.find((m) => m.id === clip.mediaId)
  const cur = clip && clip.transition && clip.transition.name
  // how big (in %) the picture must be to cover the whole frame
  const ratio = aspectRatio(state)
  const pic = media && media.width && media.height ? media.width / media.height : null
  const fillScale = pic ? 100 * Math.max(ratio / pic, pic / ratio) : null

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
        <span className="title-left">
          <button className="mini" onClick={() => setOpen(false)} title="Hide the inspector"><Icon name="right" size={12} /></button>
          Inspector
        </span>
      </div>
      <div className="insp-body">
        <LabelRow state={state} dispatch={dispatch} />
        {state.selection.length === 0 && (
          <div className="hint">Select a clip on the timeline to edit it or give it a transition from the previous clip. Drag a box around items to select several.</div>
        )}
        {state.selection.length > 1 && !clip && <div className="hint">{state.selection.length} items selected. Use the timeline toolbar to Group, Ungroup or Delete them.</div>}
        {state.selection.length === 1 && !clip && <AudioPanel state={state} dispatch={dispatch} />}
        {clip && (
          <>
            <div className="insp-clip">{clip.text ? 'Text' : media ? media.name : 'Clip'}</div>

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

            {clip.text && <TextPanel clip={clip} dispatch={dispatch} />}
            <MotionPanel clip={clip} playhead={state.playhead} dispatch={dispatch} mode={mode} setMode={setMode} freeMode={freeMode} setFreeMode={setFreeMode} fill={fillScale} />
            {media && media.type === 'video' && <SpeedPanel clip={clip} dispatch={dispatch} />}
            <MaskPanel clip={clip} dispatch={dispatch} mode={mode} setMode={setMode} />
            <EffectsPanel clip={clip} dispatch={dispatch} onOpenColour={onOpenColour} />

            {oclip && <div className="hint left">This clip is on an overlay track. Drag it along its track to choose when it appears; transitions only work on the main video track.</div>}
            {!oclip && (
            <Section id="transition" title="Transition">
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
            </Section>
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

// the panels the image editor reuses
export { TextPanel, MaskPanel, EffectsPanel, FxSlider, Section }
