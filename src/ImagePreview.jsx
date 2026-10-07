import { useEffect, useRef, useState } from 'react'
import TransformOverlay from './TransformOverlay.jsx'
import WarpOverlay from './WarpOverlay.jsx'
import MaskOverlay from './MaskOverlay.jsx'
import { aspectRatio, soleVideoClip, overlayLayout, clipPicture, uid, isLocked } from './state.js'
import { evalTransform, rectToFrame, frameToRect } from './motion.js'
import { buildLayers, backgroundOf, makeImageRenderer, imageFor } from './imageRender.js'

export const PAINT_TOOLS = ['brush', 'eraser', 'line', 'rect', 'ellipse']

// The picture of the image editor: the layers drawn with WebGL, zoomable (Ctrl + mouse wheel, or the buttons) and
// scrollable (middle mouse button drags it), with the transform / warp / mask handles and the painting tools on top.
export default function ImagePreview({ state, dispatch, mode, setMode, freeMode, tool, brush, setBrush, canvasRef }) {
  const areaRef = useRef(null)
  const wrapRef = useRef(null)
  const innerRef = useRef(null)
  const glRef = useRef(null)
  const ratio = aspectRatio(state)
  const [zoom, setZoomState] = useState(1)
  const zoomRef = useRef(1)
  const [fitBox, setFitBox] = useState({ w: 640, h: 360 })
  const [tick, setTick] = useState(0) // bumps when a picture finishes loading
  const [hover, setHover] = useState(null) // where the pointer is over the picture (for the brush circle)
  const [live, setLive] = useState(null) // {id, stroke}: a brush stroke being drawn
  const cap = Math.min(1, 4096 / Math.max(state.canvas.w, state.canvas.h))
  const cw = Math.max(1, Math.round(state.canvas.w * cap))
  const ch = Math.max(1, Math.round(state.canvas.h * cap))
  const box = { w: fitBox.w * zoom, h: fitBox.h * zoom }

  useEffect(() => {
    const el = areaRef.current
    const fit = () => {
      const pad = 28
      const w = Math.max(1, Math.min(el.clientWidth - pad, (el.clientHeight - pad) * ratio))
      setFitBox({ w, h: w / ratio })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ratio])

  // zoom keeping the point under (px, py) (pixels inside the scroll area) where it is
  const setZoom = (z, px, py) => {
    const wrap = wrapRef.current
    const nz = Math.min(32, Math.max(0.1, z))
    const old = zoomRef.current
    if (nz === old) return
    const cx = px == null ? wrap.clientWidth / 2 : px
    const cy = py == null ? wrap.clientHeight / 2 : py
    const fx = (wrap.scrollLeft + cx) / old
    const fy = (wrap.scrollTop + cy) / old
    zoomRef.current = nz
    setZoomState(nz)
    requestAnimationFrame(() => {
      wrap.scrollLeft = fx * nz - cx
      wrap.scrollTop = fy * nz - cy
    })
  }
  const onWheel = (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    const r = wrapRef.current.getBoundingClientRect()
    setZoom(zoomRef.current * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left, e.clientY - r.top)
  }
  const onPan = (e) => {
    if (e.button !== 1) return
    e.preventDefault()
    const wrap = wrapRef.current
    const [x0, y0, sl, st] = [e.clientX, e.clientY, wrap.scrollLeft, wrap.scrollTop]
    const move = (ev) => {
      wrap.scrollLeft = sl - (ev.clientX - x0)
      wrap.scrollTop = st - (ev.clientY - y0)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // the renderer (made once, when the canvas exists)
  useEffect(() => {
    const cv = innerRef.current
    glRef.current = makeImageRenderer(cv)
    if (canvasRef) canvasRef.current = cv
    return () => {
      glRef.current = null
    }
  }, [])

  // draw whenever anything that shows changes
  useEffect(() => {
    const r = glRef.current
    if (!r) return
    r.renderLayers(buildLayers(state, cw, ch, live, () => setTick((t) => t + 1)), backgroundOf(state))
  }, [state.overlayClips, state.media, state.videoTracks, state.rowOrder, state.hiddenRows, state.canvas, cw, ch, live, tick])

  // ---- painting and picking colours
  const sel = soleVideoClip(state)
  const layer = sel && overlayLayout(state.overlayClips).find((c) => c.id === sel)
  const painting = PAINT_TOOLS.includes(tool)
  const pointer = (e) => {
    const r = e.currentTarget.closest('.xf-overlay').getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  // a point on the screen -> a pixel of the layer (through the layer's own move / scale / turn)
  const layerPoint = (clip, W, H, x, y) => {
    const pic = clipPicture(state, clip, ratio)
    const ma = pic.width / pic.height
    const s = [Math.max(1, ratio / ma), Math.max(1, ma / ratio)]
    const tf = evalTransform(clip, 0)
    const q = frameToRect([x / box.w, 1 - y / box.h], s, tf, ratio)
    return [q[0] * W, (1 - q[1]) * H]
  }
  const startPaint = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (tool === 'eyedropper') return pick(e)
    const ov = e.currentTarget.closest('.xf-overlay') // (kept: the event is gone by the time the pointer moves)
    let clip = layer && layer.paint ? layer : null
    let id = clip && clip.id
    if (!clip || isLocked(state, clip.id)) {
      if (clip) return // a locked paint layer
      // no paint layer chosen: make one
      id = uid()
      dispatch({ type: 'imgAddPaint', id })
      clip = { id, paint: { w: state.canvas.w, h: state.canvas.h, strokes: [] } }
    }
    const { w: W, h: H } = clip.paint
    const first = layerPoint(clip, W, H, ...pointer(e))
    const stroke = { tool, color: brush.color, size: brush.size, opacity: brush.opacity, hardness: brush.hardness, fill: brush.fill, pts: [first] }
    setLive({ id, stroke })
    let cur = stroke
    const move = (ev) => {
      const rect = ov.getBoundingClientRect()
      const p = layerPoint(clip, W, H, ev.clientX - rect.left, ev.clientY - rect.top)
      const last = cur.pts[cur.pts.length - 1]
      if (tool === 'brush' || tool === 'eraser') {
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < Math.max(0.5, brush.size * 0.08)) return
        cur = { ...cur, pts: [...cur.pts, p] }
      } else cur = { ...cur, pts: [cur.pts[0], p] }
      setLive({ id, stroke: cur })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLive(null)
      dispatch({ type: 'paintStroke', id, stroke: cur })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // eyedropper: the colour of the picture under the pointer
  const pick = (e) => {
    const [x, y] = pointer(e)
    const src = innerRef.current
    const t = document.createElement('canvas')
    t.width = 1
    t.height = 1
    const g = t.getContext('2d', { willReadFrequently: true })
    g.drawImage(src, Math.floor((x / box.w) * src.width), Math.floor((y / box.h) * src.height), 1, 1, 0, 0, 1, 1)
    const d = g.getImageData(0, 0, 1, 1).data
    const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
    setBrush({ ...brush, color: hex })
  }

  // brush / eraser: the pointer is hidden and a circle of the brush size follows it (size is in canvas pixels, scaled by the layer)
  const round = tool === 'brush' || tool === 'eraser'
  const layerScale = layer && layer.paint ? evalTransform(layer, 0).scale / 100 : 1
  const ringR = (brush.size * (box.w / state.canvas.w) * layerScale) / 2
  const lockedLayer = !!layer && isLocked(state, layer.id) // a locked layer cannot be changed
  const maskMode = mode === 'mask' || mode === 'maskdraw' || mode === 'maskpoly' || mode === 'maskdrawsmart'
  const getFrame = (id) => {
    const c = overlayLayout(state.overlayClips).find((x) => x.id === id)
    if (!c) return null
    if (c.paint || c.text) return { el: innerRef.current, w: cw, h: ch } // (the whole picture, for those)
    const m = state.media.find((x) => x.id === c.mediaId)
    const e = m && imageFor(m.path)
    return e && e.ready ? { el: e.img, w: e.img.naturalWidth, h: e.img.naturalHeight } : null
  }

  return (
    <div className="preview-area" ref={areaRef}>
      <div className="preview-wrap" ref={wrapRef} onWheel={onWheel} onPointerDown={onPan} onAuxClick={(e) => e.preventDefault()}>
        <div className={'preview-box' + (state.canvas.bg === 'transparent' ? ' checker' : '')} style={{ width: box.w, height: box.h }}>
          <canvas ref={innerRef} width={cw} height={ch} className="preview-canvas" />
          {tool === 'move' && !lockedLayer && mode === 'warp' && <WarpOverlay state={state} dispatch={dispatch} />}
          {tool === 'move' && !lockedLayer && mode === 'transform' && <TransformOverlay state={state} dispatch={dispatch} free={freeMode} box={box} />}
          {tool === 'move' && !lockedLayer && maskMode && <MaskOverlay state={state} dispatch={dispatch} mode={mode} setMode={setMode} box={box} getFrame={getFrame} noTrack />}
          {(painting || tool === 'eyedropper') && (
            <div className="xf-overlay paint-ov">
              <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`}>
                <rect
                  width={box.w}
                  height={box.h}
                  fill="transparent"
                  style={{ pointerEvents: 'all', cursor: round ? 'none' : 'crosshair' }}
                  onPointerDown={startPaint}
                  onPointerMove={(e) => round && setHover(pointer(e))}
                  onPointerLeave={() => setHover(null)}
                />
                {round && hover && (
                  <g style={{ pointerEvents: 'none' }}>
                    <circle cx={hover[0]} cy={hover[1]} r={Math.max(1.5, ringR)} fill="none" stroke="#fff" strokeWidth="2.5" opacity="0.9" />
                    <circle cx={hover[0]} cy={hover[1]} r={Math.max(1.5, ringR)} fill="none" stroke="#000" strokeWidth="1" />
                  </g>
                )}
              </svg>
            </div>
          )}
        </div>
      </div>
      <div className="zoom-bar">
        <button className="mini" onClick={() => setZoom(zoomRef.current / 1.5)} title="Zoom out">−</button>
        <span title="Ctrl + mouse wheel zooms towards the pointer; drag with the middle mouse button to move around">{Math.round(zoom * 100)}%</span>
        <button className="mini" onClick={() => setZoom(zoomRef.current * 1.5)} title="Zoom in">+</button>
        <button className="mini" onClick={() => setZoom(1)} title="Fit the picture in the window">Fit</button>
      </div>
    </div>
  )
}
