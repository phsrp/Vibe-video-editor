// Masks: show only part of a clip's picture (a rectangle, an ellipse or a shape you draw around something),
// with a soft edge and optional invert. The shape is stored in picture coordinates (0..1, y down) and moves
// with the picture. The Mask X / Y / size sliders are normal keyframe properties, so a mask can follow a subject.
//   clip.mask = { shape: 'rect' | 'ellipse' | 'poly', cx, cy, w, h, rot, pts: [[x, y], ...], feather, expand, invert }

export const MASK_DEFAULT = { shape: 'ellipse', cx: 0.5, cy: 0.5, w: 0.5, h: 0.6, rot: 0, pts: [], feather: 8, expand: 0, invert: false }
export const MAX_POLY = 64

const NONE = { mk: [0, 0, 0, 0], mb: [0, 0, 0, 0], mr: [1, 0], pts: new Float32Array((MAX_POLY + 1) * 2), n: 0 }

export const polyCentre = (pts) => {
  if (!pts.length) return [0.5, 0.5]
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
}

// the mask moved / scaled by the animated Mask X / Y / size values (percent), in picture coordinates (y down)
export function maskPlaced(mask, tf) {
  const ox = ((tf && tf.mx) || 0) / 100
  const oy = ((tf && tf.my) || 0) / 100
  const sc = Math.max(0.01, ((tf && tf.ms) != null ? tf.ms : 100) / 100)
  if (mask.shape === 'poly') {
    const c = polyCentre(mask.pts)
    return { ...mask, pts: mask.pts.map((p) => [c[0] + (p[0] - c[0]) * sc + ox, c[1] + (p[1] - c[1]) * sc + oy]) }
  }
  return { ...mask, cx: mask.cx + ox, cy: mask.cy + oy, w: mask.w * sc, h: mask.h * sc }
}

// mask (+ animated tf) -> the numbers the shader wants
export function maskUniforms(mask, tf) {
  if (!mask || !mask.shape) return NONE
  if (mask.shape === 'poly' && (!mask.pts || mask.pts.length < 3)) return NONE
  const m = maskPlaced(mask, tf)
  const type = m.shape === 'rect' ? 1 : m.shape === 'ellipse' ? 2 : 3
  const rad = ((m.rot || 0) * Math.PI) / 180
  const pts = new Float32Array((MAX_POLY + 1) * 2)
  let n = 0
  if (type === 3) {
    n = Math.min(MAX_POLY, m.pts.length)
    for (let i = 0; i <= n; i++) {
      const p = m.pts[i % n]
      pts[i * 2] = p[0]
      pts[i * 2 + 1] = 1 - p[1]
    }
  }
  return {
    mk: [type, ((m.feather || 0) / 100) * 0.15, m.invert ? 1 : 0, ((m.expand || 0) / 100) * 0.3],
    mb: [m.cx, 1 - m.cy, m.w / 2, m.h / 2],
    mr: [Math.cos(rad), Math.sin(rad)],
    pts,
    n,
  }
}