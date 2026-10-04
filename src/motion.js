// Clip motion: position, scale, rotation and opacity, each of which can be animated with keyframes.
//
// A clip stores
//   tf:   {x, y, scale, rot, opacity}   the fixed value of each property
//   anim: {x: [{t, v, ease}], ...}      keyframes of the properties that are animated
// Keyframe times `t` are in SOURCE seconds (the position in the video file), so the animation stays
// attached to the footage when the clip is trimmed or split.
//
// Units: x / y in % of the frame (y positive = down), scale in %, rotation in degrees
// (positive = clockwise), opacity in %.

export const PROPS = [
  { id: 'x', label: 'Position X', unit: '%', def: 0, min: -100, max: 100, step: 0.5 },
  { id: 'y', label: 'Position Y', unit: '%', def: 0, min: -100, max: 100, step: 0.5 },
  { id: 'scale', label: 'Scale', unit: '%', def: 100, min: 0, max: 400, step: 1 },
  { id: 'sx', label: 'Stretch width', unit: '%', def: 100, min: 5, max: 400, step: 1 },
  { id: 'sy', label: 'Stretch height', unit: '%', def: 100, min: 5, max: 400, step: 1 },
  { id: 'rot', label: 'Rotation', unit: '°', def: 0, min: -360, max: 360, step: 1 },
  { id: 'opacity', label: 'Opacity', unit: '%', def: 100, min: 0, max: 100, step: 1 },
]
export const DEFAULTS = Object.fromEntries(PROPS.map((p) => [p.id, p.def]))

const easeOutBounce = (u) => {
  const n = 7.5625
  const d = 2.75
  if (u < 1 / d) return n * u * u
  if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75
  if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375
  return n * (u -= 2.625 / d) * u + 0.984375
}

// Custom curve: a cubic bezier like the ones in CSS / other editors. bez = [x1, y1, x2, y2] (the two control
// points; the curve starts at 0,0 and ends at 1,1). y may go outside 0..1 for overshoot.
export const DEFAULT_BEZ = [0.42, 0, 0.58, 1]
export function bezierFn(bez) {
  const [x1, y1, x2, y2] = bez && bez.length === 4 ? bez : DEFAULT_BEZ
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const X = (t) => ((ax * t + bx) * t + cx) * t
  const Y = (t) => ((ay * t + by) * t + cy) * t
  return (u) => {
    if (u <= 0) return 0
    if (u >= 1) return 1
    let lo = 0
    let hi = 1
    let t = u
    for (let i = 0; i < 24; i++) {
      const x = X(t)
      if (Math.abs(x - u) < 1e-6) break
      if (x < u) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return Y(t)
  }
}
// the easing of one keyframe (k = {ease, bez}) at progress u (0..1) towards the next keyframe
export const easeOf = (k, u) => (k.ease === 'custom' ? bezierFn(k.bez)(u) : (EASES[k.ease] || EASES.linear).fn(u))

// The easing is applied to the stretch from a keyframe to the NEXT one.
export const EASES = {
  linear: { label: 'Linear', fn: (u) => u },
  easeInOut: { label: 'Ease in-out (smooth)', fn: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2) },
  easeIn: { label: 'Ease in (start slow)', fn: (u) => u * u * u },
  easeOut: { label: 'Ease out (end slow)', fn: (u) => 1 - Math.pow(1 - u, 3) },
  back: { label: 'Overshoot', fn: (u) => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2) },
  bounce: { label: 'Bounce', fn: easeOutBounce },
  hold: { label: 'Hold (jump at next key)', fn: () => 0 },
  custom: { label: 'Custom curve…', fn: (u) => bezierFn(DEFAULT_BEZ)(u) },
}
export const DEFAULT_EASE = 'easeInOut'

export const KEY_EPS = 0.02 // two keyframes closer than this (seconds) count as the same one

export function evalProp(clip, prop, t) {
  const list = clip.anim && clip.anim[prop]
  if (!list || !list.length) return clip.tf && clip.tf[prop] != null ? clip.tf[prop] : DEFAULTS[prop]
  if (t <= list[0].t) return list[0].v
  const last = list[list.length - 1]
  if (t >= last.t) return last.v
  let i = 0
  while (i < list.length - 2 && t >= list[i + 1].t) i++
  const a = list[i]
  const b = list[i + 1]
  const u = (t - a.t) / (b.t - a.t)
  const e = easeOf(a, u)
  return a.v + (b.v - a.v) * e
}

export function evalTransform(clip, t) {
  return {
    x: evalProp(clip, 'x', t),
    y: evalProp(clip, 'y', t),
    scale: evalProp(clip, 'scale', t),
    sx: evalProp(clip, 'sx', t),
    sy: evalProp(clip, 'sy', t),
    rot: evalProp(clip, 'rot', t),
    opacity: evalProp(clip, 'opacity', t),
  }
}

// ---- Warp: the four corners of the picture can be pulled anywhere (corner pin), with keyframes.
// clip.warp = { fixed: [8 numbers] | undefined, keys: [{t (source seconds), c: [8 numbers], ease}] }
// c = [dx, dy] for the corners top-left, top-right, bottom-right, bottom-left, in % of the picture's
// width / height (dx positive = right, dy positive = down).
export const WARP_ZERO = [0, 0, 0, 0, 0, 0, 0, 0]
const WARP_BASE = [[0, 1], [1, 1], [1, 0], [0, 0]] // the corners in shader space (y up)
const isZero = (c) => !c || c.every((v) => Math.abs(v) < 1e-9)

export function evalWarp(clip, t) {
  const w = clip.warp
  if (!w) return null
  const keys = w.keys || []
  if (!keys.length) return isZero(w.fixed) ? null : w.fixed
  if (t <= keys[0].t) return keys[0].c
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.c
  let i = 0
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++
  const a = keys[i]
  const b = keys[i + 1]
  const e = easeOf(a, (t - a.t) / (b.t - a.t))
  return a.c.map((v, j) => v + (b.c[j] - v) * e)
}

// Solve for the 3x3 matrix mapping 4 points onto 4 points (row-major, 9 numbers).
function homography(src, dst) {
  const A = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]
    const [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    if (Math.abs(A[c][c]) < 1e-12) return null
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return [...h, 1]
}

export const warpQuad = (c) => WARP_BASE.map((b, i) => [b[0] + c[i * 2] / 100, b[1] - c[i * 2 + 1] / 100])

const IDENT3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
// matrix (column-major, for WebGL) that maps a point of the warped picture back to the source picture
function warpMatrix(c) {
  const H = homography(warpQuad(c), WARP_BASE)
  if (!H) return null
  return new Float32Array([H[0], H[3], H[6], H[1], H[4], H[7], H[2], H[5], H[8]])
}

// Does the clip need the effects renderer (instead of being copied straight through)?
export function hasTransform(clip) {
  if (clip.warp && ((clip.warp.keys && clip.warp.keys.length) || !isZero(clip.warp.fixed))) return true
  if (clip.anim && Object.values(clip.anim).some((l) => l && l.length)) return true
  return PROPS.some((p) => clip.tf && clip.tf[p.id] != null && clip.tf[p.id] !== p.def)
}

// Sorted unique keyframe times of all properties and the warp (for the markers on the timeline).
export function keyTimes(clip) {
  const ts = []
  const add = (t) => {
    if (!ts.some((x) => Math.abs(x - t) < KEY_EPS)) ts.push(t)
  }
  for (const list of Object.values(clip.anim || {})) for (const k of list || []) add(k.t)
  for (const k of (clip.warp && clip.warp.keys) || []) add(k.t)
  return ts.sort((a, b) => a - b)
}

export const keyAt = (list, t) => (list || []).find((k) => Math.abs(k.t - t) < KEY_EPS)

// tf -> the numbers the shader wants: [offsetX, offsetY, scale, rotation(rad)], [opacity, active], [stretch x, y]
// warp (8 numbers or null) -> h (matrix), w (active)
export function shaderTransform(tf, warp) {
  const wm = warp && !isZero(warp) ? warpMatrix(warp) : null
  const h = wm || IDENT3
  const w = wm ? 1 : 0
  if (!tf) return { v: [0, 0, 1, 0], p: [1, 0], st: [1, 1], h, w }
  const sx = tf.sx != null ? tf.sx : 100
  const sy = tf.sy != null ? tf.sy : 100
  const active = tf.x !== 0 || tf.y !== 0 || tf.scale !== 100 || tf.rot !== 0 || sx !== 100 || sy !== 100
  return {
    v: [tf.x / 100, -tf.y / 100, Math.max(tf.scale, 0.01) / 100, (tf.rot * Math.PI) / 180],
    p: [Math.min(1, Math.max(0, tf.opacity / 100)), active ? 1 : 0],
    st: [Math.max(sx, 0.01) / 100, Math.max(sy, 0.01) / 100],
    h,
    w,
  }
}

// Mapping between the frame (uv, 0..1, y up) and the picture's own rectangle (q, 0..1), the same
// maths as the shader, so handles drawn over the preview line up with the picture.
// s = the letterbox scale of the picture (see glRenderer scaleFor), ratio = frame width / height.
export function frameToRect(uv, s, tf, ratio) {
  const st = shaderTransform(tf)
  let cx = uv[0] - 0.5
  let cy = uv[1] - 0.5
  if (st.p[1] > 0.5) {
    const [ox, oy, sc, rot] = st.v
    cx = cx * ratio - ox * ratio
    cy -= oy
    const cs = Math.cos(rot)
    const sn = Math.sin(rot)
    ;[cx, cy] = [(cs * cx - sn * cy) / (sc * st.st[0]), (sn * cx + cs * cy) / (sc * st.st[1])]
    cx /= ratio
  }
  return [cx * s[0] + 0.5, cy * s[1] + 0.5]
}
export function rectToFrame(q, s, tf, ratio) {
  const st = shaderTransform(tf)
  let cx = (q[0] - 0.5) / s[0]
  let cy = (q[1] - 0.5) / s[1]
  if (st.p[1] > 0.5) {
    const [ox, oy, sc, rot] = st.v
    const cs = Math.cos(rot)
    const sn = Math.sin(rot)
    cx *= ratio
    cx *= sc * st.st[0]
    cy *= sc * st.st[1]
    ;[cx, cy] = [cs * cx + sn * cy, -sn * cx + cs * cy]
    cx = (cx + ox * ratio) / ratio
    cy += oy
  }
  return [cx + 0.5, cy + 0.5]
}

if (typeof window !== 'undefined') window.__motion = { evalTransform, evalProp, evalWarp, shaderTransform, frameToRect, rectToFrame } // used by the developer self-test
