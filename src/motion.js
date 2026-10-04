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

// The easing is applied to the stretch from a keyframe to the NEXT one.
export const EASES = {
  linear: { label: 'Linear', fn: (u) => u },
  easeInOut: { label: 'Ease in-out (smooth)', fn: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2) },
  easeIn: { label: 'Ease in (start slow)', fn: (u) => u * u * u },
  easeOut: { label: 'Ease out (end slow)', fn: (u) => 1 - Math.pow(1 - u, 3) },
  back: { label: 'Overshoot', fn: (u) => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2) },
  bounce: { label: 'Bounce', fn: easeOutBounce },
  hold: { label: 'Hold (jump at next key)', fn: () => 0 },
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
  const e = (EASES[a.ease] || EASES.linear).fn(u)
  return a.v + (b.v - a.v) * e
}

export function evalTransform(clip, t) {
  return {
    x: evalProp(clip, 'x', t),
    y: evalProp(clip, 'y', t),
    scale: evalProp(clip, 'scale', t),
    rot: evalProp(clip, 'rot', t),
    opacity: evalProp(clip, 'opacity', t),
  }
}

// Does the clip need the effects renderer (instead of being copied straight through)?
export function hasTransform(clip) {
  if (clip.anim && Object.values(clip.anim).some((l) => l && l.length)) return true
  return PROPS.some((p) => clip.tf && clip.tf[p.id] != null && clip.tf[p.id] !== p.def)
}

// Sorted unique keyframe times of all properties (for the markers on the timeline).
export function keyTimes(clip) {
  const ts = []
  for (const list of Object.values(clip.anim || {})) for (const k of list || []) if (!ts.some((x) => Math.abs(x - k.t) < KEY_EPS)) ts.push(k.t)
  return ts.sort((a, b) => a - b)
}

export const keyAt = (list, t) => (list || []).find((k) => Math.abs(k.t - t) < KEY_EPS)

// tf -> the numbers the shader wants: [offsetX, offsetY, scale, rotation(rad)], [opacity, active]
export function shaderTransform(tf) {
  if (!tf) return { v: [0, 0, 1, 0], p: [1, 0] }
  const active = tf.x !== 0 || tf.y !== 0 || tf.scale !== 100 || tf.rot !== 0
  return {
    v: [tf.x / 100, -tf.y / 100, Math.max(tf.scale, 0.01) / 100, (tf.rot * Math.PI) / 180],
    p: [Math.min(1, Math.max(0, tf.opacity / 100)), active ? 1 : 0],
  }
}

if (typeof window !== 'undefined') window.__motion = { evalTransform, evalProp } // used by the developer self-test
