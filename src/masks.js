// Masks: show only part of a clip's picture (a rectangle, an ellipse or a shape you draw around something),
// with a soft edge and optional invert. The shape is stored in picture coordinates (0..1, y down) and moves
// with the picture. The Mask X / Y / size sliders are normal keyframe properties, so a mask can follow a subject.
//   clip.mask = { shape: 'rect' | 'ellipse' | 'poly', cx, cy, w, h, rot, pts: [[x, y], ...], feather, expand, invert }

export const MASK_DEFAULT = { shape: 'ellipse', cx: 0.5, cy: 0.5, w: 0.5, h: 0.6, rot: 0, pts: [], feather: 8, expand: 0, invert: false }
export const MAX_POLY = 256 // points of a drawn or tracked shape (the shader reads them from a texture)
// where a tracked subject is not in the picture: a tiny shape outside it, so the mask shows nothing
const OFF_PICTURE = [[-2, -2], [-1.99, -2], [-2, -1.99]]

const NONE = { mk: [0, 0, 0, 0], mb: [0, 0, 0, 0], mr: [1, 0], bb: [-10, -10, 10, 10], pts: new Float32Array((MAX_POLY + 1) * 4), n: 0 }

// A mask can last only part of a clip: mask.from / mask.to are seconds of the ORIGINAL file (like keyframes).
// Without them it lasts the whole clip. maskAt gives the mask that is active at source second ts (or undefined).
export const maskAt = (clip, ts) => {
  const m = clip && clip.mask
  if (!m) return undefined
  if (m.from != null && ts < m.from - 0.0005) return undefined
  if (m.to != null && ts > m.to + 0.0005) return undefined
  // a tracked outline: the shape this moment has (the nearest look), instead of the one fixed shape
  if (m.frames && m.frames.length) {
    const pts = frameAt(m.frames, ts).pts
    return { ...m, pts: pts && pts.length >= 3 ? pts : OFF_PICTURE }
  }
  return m
}
// the tracked look nearest to second ts of the file (frames are sorted by t): its place in the list
export function frameIndexAt(frames, ts) {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid].t < ts) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(frames[lo - 1].t - ts) <= Math.abs(frames[lo].t - ts)) lo--
  return lo
}
export const frameAt = (frames, ts) => frames[frameIndexAt(frames, ts)]
// the part of the clip (source seconds) the mask covers
export const maskSpan = (clip) => {
  const m = clip.mask
  return [Math.max(clip.in, m.from != null ? m.from : clip.in), Math.min(clip.out, m.to != null ? m.to : clip.out)]
}

export const polyCentre =(pts) => {
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
  const pts = new Float32Array((MAX_POLY + 1) * 4) // one RGBA texel per point: x, y
  let n = 0
  let bb = [-10, -10, 10, 10]
  if (type === 3) {
    n = Math.min(MAX_POLY, m.pts.length)
    let x0 = 9
    let y0 = 9
    let x1 = -9
    let y1 = -9
    for (let i = 0; i <= n; i++) {
      const p = m.pts[i % n]
      pts[i * 4] = p[0]
      pts[i * 4 + 1] = 1 - p[1]
      x0 = Math.min(x0, p[0])
      x1 = Math.max(x1, p[0])
      y0 = Math.min(y0, 1 - p[1])
      y1 = Math.max(y1, 1 - p[1])
    }
    // the box around the shape with room for the soft edge and growing, so far-away pixels skip the edge loop
    const pad = ((m.feather || 0) / 100) * 0.15 + Math.max(0, ((m.expand || 0) / 100) * 0.3) + 0.01
    bb = [x0 - pad, y0 - pad, x1 + pad, y1 + pad]
  }
  return {
    mk: [type, ((m.feather || 0) / 100) * 0.15, m.invert ? 1 : 0, ((m.expand || 0) / 100) * 0.3],
    mb: [m.cx, 1 - m.cy, m.w / 2, m.h / 2],
    mr: [Math.cos(rad), Math.sin(rad)],
    bb,
    pts,
    n,
  }
}