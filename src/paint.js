// Paint layers of the image editor: brush strokes drawn onto a canvas of their own. The strokes are kept in the project
// (clip.paint = {w, h, strokes}), so undo, redo and saving work like for everything else; the canvas is rebuilt from them.
//   stroke = { tool: 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse', color, size (px), opacity (0..1), hardness (0..1),
//              fill (shapes), pts: [[x, y], ...] in pixels of the layer }

const cache = new Map() // layer id -> { canvas, list (the strokes drawn into it), view (a copy with the stroke being drawn) }

const make = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

// one stroke onto a canvas context
export function drawStroke(ctx, s) {
  if (!s.pts || !s.pts.length) return
  const soft = s.tool === 'brush' || s.tool === 'eraser' ? Math.max(0, 1 - (s.hardness == null ? 1 : s.hardness)) * s.size * 0.3 : 0
  const pad = s.size + soft * 3 + 4
  const xs = s.pts.map((p) => p[0])
  const ys = s.pts.map((p) => p[1])
  const x0 = Math.floor(Math.min(...xs) - pad)
  const y0 = Math.floor(Math.min(...ys) - pad)
  const bw = Math.ceil(Math.max(...xs) + pad) - x0
  const bh = Math.ceil(Math.max(...ys) + pad) - y0
  if (bw < 1 || bh < 1) return
  // drawn alone on a small canvas first, so that overlapping parts of one stroke do not get darker with opacity < 1
  const t = make(bw, bh)
  const g = t.getContext('2d')
  g.translate(-x0, -y0)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.lineWidth = s.size
  g.strokeStyle = s.tool === 'eraser' ? '#000' : s.color
  g.fillStyle = s.tool === 'eraser' ? '#000' : s.color
  const p = s.pts
  if (s.tool === 'brush' || s.tool === 'eraser') {
    if (p.length === 1) {
      g.beginPath()
      g.arc(p[0][0], p[0][1], s.size / 2, 0, Math.PI * 2)
      g.fill()
    } else {
      g.beginPath()
      g.moveTo(p[0][0], p[0][1])
      for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1])
      g.stroke()
    }
  } else if (p.length >= 2) {
    const [a, b] = [p[0], p[p.length - 1]]
    if (s.tool === 'line') {
      g.beginPath()
      g.moveTo(a[0], a[1])
      g.lineTo(b[0], b[1])
      g.stroke()
    } else if (s.tool === 'rect') {
      const x = Math.min(a[0], b[0])
      const y = Math.min(a[1], b[1])
      if (s.fill) g.fillRect(x, y, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
      else g.strokeRect(x, y, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
    } else if (s.tool === 'ellipse') {
      g.beginPath()
      g.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(0.5, Math.abs(b[0] - a[0]) / 2), Math.max(0.5, Math.abs(b[1] - a[1]) / 2), 0, 0, Math.PI * 2)
      if (s.fill) g.fill()
      else g.stroke()
    }
  }
  ctx.save()
  ctx.globalAlpha = s.opacity == null ? 1 : s.opacity
  if (s.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out'
  if (soft > 0.3) ctx.filter = `blur(${soft}px)`
  ctx.drawImage(t, x0, y0)
  ctx.restore()
}

// The canvas of a paint layer (clip.paint). `live` = the stroke that is being drawn right now (not in the list yet).
export function paintCanvas(clip, live) {
  const { w, h, strokes } = clip.paint
  let e = cache.get(clip.id)
  if (!e || e.canvas.width !== w || e.canvas.height !== h) {
    e = { canvas: make(w, h), list: [], view: null }
    cache.set(clip.id, e)
  }
  const ctx = e.canvas.getContext('2d')
  // normally one stroke was added; after undo, redo or a clear everything is drawn again
  const prefix = e.list.length <= strokes.length && e.list.every((s, i) => s === strokes[i])
  if (!prefix) {
    ctx.clearRect(0, 0, w, h)
    e.list = []
  }
  for (let i = e.list.length; i < strokes.length; i++) drawStroke(ctx, strokes[i])
  e.list = strokes.slice()
  if (!live) return e.canvas
  if (!e.view || e.view.width !== w || e.view.height !== h) e.view = make(w, h)
  const vg = e.view.getContext('2d')
  vg.clearRect(0, 0, w, h)
  vg.drawImage(e.canvas, 0, 0)
  drawStroke(vg, live)
  return e.view
}

export const forgetPaint = (id) => cache.delete(id)

// A paint layer as a PNG data URL (for saving the project), and back
export const paintToDataUrl = (clip) => paintCanvas(clip).toDataURL('image/png')
