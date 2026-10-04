import { evalTransform, evalProp, evalWarp, hasTransform, keyAt, PROPS, DEFAULTS, DEFAULT_EASE, KEY_EPS, WARP_ZERO } from './motion.js'

export const uid = () => Math.random().toString(36).slice(2, 9)
export const MIN_CLIP = 0.1

export const initialState = {
  media: [],
  // Main video track, played back to back: {id, mediaId, in, out, transition, noAudio, groupId}.
  // A video clip's audio streams are "attached" to it (they follow it around) except the stream
  // numbers listed in noAudio (detached to their own clip, or deleted).
  clips: [],
  // Extra audio clips on their own tracks: {id, mediaId, trackId, in, out, start, groupId,
  // stream?, origin?}. stream = audio stream number when the clip is the detached audio of a
  // video; origin = id of the video clip it was detached from (lets it be grouped back).
  audioClips: [],
  audioTracks: [], // {id, name, kind:'free', volume, mute}
  streamSettings: {}, // volume/mute/name for the attached audio streams: {[n]: {volume, mute, name}}
  // Overlay video: extra video tracks whose clips sit on top of the main video and can start at any
  // time: {id, mediaId, trackId, in, out, start, groupId, tf, anim, warp}. A video clip's own audio
  // is added as grouped detached audio clips when it is dropped there.
  videoTracks: [], // {id, name}
  overlayClips: [],
  mainName: 'Video 1', // name shown on the main video track
  // Vertical order of every row of the timeline (top to bottom): 'main', 'v:<trackId>', 's:<stream>', 'a:<trackId>'.
  // Rows that are not listed yet are placed by rowKeys(). Video rows higher up are drawn on top.
  rowOrder: [],
  past: [],
  future: [],
  // Selected items: video clip ids, audio clip ids, or 'sa:<videoClipId>:<stream>' for one attached audio stream.
  selection: [],
  playhead: 0,
  playing: false,
  seekId: 0,
}

// Adds start/dur/ov to every clip. Clips are rippled (no gaps). A clip with `transition`
// overlaps the tail of the previous clip by `ov` seconds (limited by the clips' lengths).
export function layout(clips) {
  const out = []
  let end = 0
  clips.forEach((c, i) => {
    const dur = c.out - c.in
    let ov = 0
    if (i > 0 && c.transition && c.transition.name) {
      const prev = out[i - 1]
      ov = Math.min(c.transition.duration, prev.dur - prev.ov, dur)
      if (ov < 0.05) ov = 0
    }
    const start = i === 0 ? 0 : end - ov
    out.push({ ...c, dur, ov, start })
    end = start + dur
  })
  return out
}

export function totalDuration(clips) {
  const l = layout(clips)
  return l.length ? l[l.length - 1].start + l[l.length - 1].dur : 0
}

export const audioLayout = (audioClips) => audioClips.map((a) => ({ ...a, dur: a.out - a.in }))
export const overlayLayout = (overlayClips) => overlayClips.map((c) => ({ ...c, dur: c.out - c.in, ov: 0 }))

// Length of the whole project: the main video, or an overlay clip that runs past it.
export function projectDuration(state) {
  let end = totalDuration(state.clips)
  for (const c of state.overlayClips || []) end = Math.max(end, c.start + (c.out - c.in))
  return end
}

// Every row of the timeline, top to bottom. Remembers the user's order; new rows go to the top
// (overlay video, so it sits above the main video) or the bottom (audio).
export function rowKeys(state) {
  const have = ['main', ...Array.from({ length: streamCount(state) }, (_, n) => 's:' + n), ...(state.videoTracks || []).map((t) => 'v:' + t.id), ...state.audioTracks.map((t) => 'a:' + t.id)]
  const order = (state.rowOrder || []).filter((k) => have.includes(k))
  const out = [...order]
  for (const k of have) {
    if (out.includes(k)) continue
    if (k.startsWith('v:')) out.unshift(k)
    else out.push(k)
  }
  return out
}
// The one video clip (main or overlay) that is selected, if there is exactly one. Its grouped audio may
// be selected along with it: that still counts as "one clip" for the Inspector and the warp handles.
export function soleVideoClip(state) {
  const v = state.selection.filter((id) => state.clips.some((c) => c.id === id) || state.overlayClips.some((c) => c.id === id))
  const others = state.selection.filter((id) => !v.includes(id) && !state.audioClips.some((c) => c.id === id))
  return v.length === 1 && !others.length ? v[0] : null
}

// the video rows, bottom layer first (what gets drawn first)
export const videoRowsBottomUp = (state) => rowKeys(state).filter((k) => k === 'main' || k.startsWith('v:')).reverse()

// The file to play for an audio clip (a detached video stream, or a plain audio file).
export function audioSource(a, media) {
  if (!media) return null
  if (a.stream != null) return (media.audioFiles || [])[a.stream] || null
  return media.path
}

// Is audio stream n of this video clip still attached to it?
export const hasAttached = (c, media, n) =>
  !!media && media.type === 'video' && n < (media.audioStreams || []).length && !(c.noAudio || []).includes(n)

// How many audio lanes the timeline needs (highest attached stream number + 1).
export function streamCount(state) {
  let n = 0
  for (const c of state.clips) {
    const m = state.media.find((x) => x.id === c.mediaId)
    if (!m || m.type !== 'video') continue
    for (let i = 0; i < (m.audioStreams || []).length; i++) if (hasAttached(c, m, i)) n = Math.max(n, i + 1)
  }
  return n
}

const snap = (s) => ({ clips: s.clips, audioClips: s.audioClips, overlayClips: s.overlayClips })
const hist = (s) => [...s.past, snap(s)].slice(-100)
function commit(state, patch) {
  return { ...state, ...patch, past: hist(state), future: [] }
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// After undo/redo, make sure every audio / overlay clip still has a track to live on.
function ensureTracks(state) {
  let out = state
  const tracks = [...state.audioTracks]
  for (const c of state.audioClips) {
    if (tracks.some((t) => t.id === c.trackId)) continue
    const name = c.trackId.startsWith('ug') ? `Video audio ${+c.trackId.slice(2) + 1} (detached)` : 'Audio'
    tracks.push({ id: c.trackId, name, kind: 'free', volume: 1, mute: false })
  }
  if (tracks.length !== state.audioTracks.length) out = { ...out, audioTracks: tracks }
  const vt = [...state.videoTracks]
  for (const c of state.overlayClips) if (!vt.some((t) => t.id === c.trackId)) vt.push({ id: c.trackId, name: nextVideoName(vt) })
  if (vt.length !== state.videoTracks.length) out = { ...out, videoTracks: vt }
  return out
}

// "Video 2", "Video 3"...: the first number not used yet ("Video 1" is the main track)
function nextVideoName(tracks, mainName = 'Video 1') {
  const used = new Set([mainName, ...tracks.map((t) => t.name)])
  let n = 2
  while (used.has(`Video ${n}`)) n++
  return `Video ${n}`
}
const nextAudioName = (tracks) => {
  const used = new Set(tracks.map((t) => t.name))
  let n = 1
  while (used.has(`Audio ${n}`)) n++
  return `Audio ${n}`
}

// apply f to the video clip or overlay clip with this id
const mapClips = (state, f) => ({ clips: state.clips.map(f), overlayClips: state.overlayClips.map(f) })

// ---- groups: every item (video clip, overlay clip or audio clip) may carry a groupId
const itemOf = (state, id) => state.clips.find((x) => x.id === id) || state.overlayClips.find((x) => x.id === id) || state.audioClips.find((x) => x.id === id)

// Clicking any member of a group selects the whole group. (Attached-audio ids are never expanded.)
function expand(state, ids) {
  const gids = new Set()
  for (const id of ids) {
    const it = itemOf(state, id)
    if (it && it.groupId) gids.add(it.groupId)
  }
  if (!gids.size) return ids
  const out = new Set(ids)
  state.clips.forEach((c) => gids.has(c.groupId) && out.add(c.id))
  state.overlayClips.forEach((c) => gids.has(c.groupId) && out.add(c.id))
  state.audioClips.forEach((c) => gids.has(c.groupId) && out.add(c.id))
  return [...out]
}

const newClip = (c, patch) => ({ id: c.id, mediaId: c.mediaId, in: c.in, out: c.out, transition: c.transition || null, noAudio: c.noAudio || [], groupId: c.groupId, tf: c.tf, anim: c.anim, warp: c.warp, ...patch })

const sortKeys = (list) => [...list].sort((a, b) => a.t - b.t)

export function reducer(state, a) {
  switch (a.type) {
    case 'addMedia': {
      const items = a.items.filter((i) => !state.media.some((m) => m.id === i.id))
      return items.length ? { ...state, media: [...state.media, ...items] } : state
    }

    // replace the whole project (open / new)
    case 'loadProject':
      return {
        ...initialState,
        media: a.media || [],
        clips: a.clips || [],
        audioClips: a.audioClips || [],
        audioTracks: a.audioTracks || [],
        streamSettings: a.streamSettings || {},
        overlayClips: a.overlayClips || [],
        videoTracks: a.videoTracks || [],
        mainName: a.mainName || 'Video 1',
        rowOrder: a.rowOrder || [],
      }

    case 'updateMedia':
      return { ...state, media: state.media.map((m) => (m.id === a.id ? { ...m, ...a.patch } : m)) }

    case 'addClip': {
      const m = state.media.find((x) => x.id === a.mediaId)
      if (!m || m.type === 'audio') return state
      const clip = { id: uid(), mediaId: m.id, in: 0, out: m.duration, transition: null, noAudio: [] }
      const clips = [...state.clips]
      const idx = a.index == null ? clips.length : clamp(a.index, 0, clips.length)
      clips.splice(idx, 0, clip)
      return { ...commit(state, { clips }), selection: [clip.id] }
    }

    // Move one or more video clips (a selection or a group) so they sit together at toIndex
    // (an index into the clips that are NOT being moved). Grouped audio shifts by the same time.
    case 'moveClips': {
      const ids = new Set(a.ids)
      const moving = state.clips.filter((c) => ids.has(c.id))
      if (!moving.length) return state
      const rest = state.clips.filter((c) => !ids.has(c.id))
      const idx = clamp(a.toIndex, 0, rest.length)
      const clips = [...rest.slice(0, idx), ...moving, ...rest.slice(idx)]
      if (clips.every((x, i) => x.id === state.clips[i].id)) return state
      const before = layout(state.clips)
      const after = layout(clips)
      const delta = new Map() // groupId -> seconds the group's first moved clip shifted
      for (const c of moving) {
        if (!c.groupId || delta.has(c.groupId)) continue
        delta.set(c.groupId, after.find((x) => x.id === c.id).start - before.find((x) => x.id === c.id).start)
      }
      const audioClips = state.audioClips.map((x) => (x.groupId && delta.has(x.groupId) ? { ...x, start: Math.max(0, x.start + delta.get(x.groupId)) } : x))
      return commit(state, { clips, audioClips })
    }

    // Call once at the start of a drag so the whole drag is a single undo step.
    case 'checkpoint':
      return { ...state, past: hist(state), future: [] }

    case 'trim': {
      const clips = state.clips.map((c) => {
        if (c.id !== a.id) return c
        const m = state.media.find((x) => x.id === c.mediaId)
        const maxOut = m.type === 'video' ? m.duration : 3600
        if (a.side === 'in') return { ...c, in: Math.max(0, Math.min(a.value, c.out - MIN_CLIP)) }
        return { ...c, out: Math.max(c.in + MIN_CLIP, Math.min(a.value, maxOut)) }
      })
      return { ...state, clips }
    }

    case 'split': {
      // a selected overlay clip under the playhead is split instead of the main video (its grouped audio too)
      const ol = overlayLayout(state.overlayClips).find((x) => state.selection.includes(x.id) && a.t > x.start + MIN_CLIP && a.t < x.start + x.dur - MIN_CLIP)
      if (ol) {
        const cut = ol.in + (a.t - ol.start)
        const left = { ...ol, out: cut }
        const rightId = uid()
        const gid = ol.groupId ? uid() : undefined
        const right = { ...ol, id: rightId, in: cut, start: a.t, groupId: gid }
        delete left.dur
        delete left.ov
        delete right.dur
        delete right.ov
        const overlayClips = state.overlayClips.flatMap((x) => (x.id === ol.id ? [left, right] : [x]))
        let audioClips = state.audioClips
        if (ol.groupId) {
          audioClips = state.audioClips.flatMap((x) => {
            if (x.groupId !== ol.groupId || !(a.t > x.start + MIN_CLIP && a.t < x.start + (x.out - x.in) - MIN_CLIP)) return [x]
            const c2 = x.in + (a.t - x.start)
            return [{ ...x, out: c2 }, { ...x, id: uid(), in: c2, start: a.t, groupId: gid }]
          })
        }
        return { ...commit(state, { overlayClips, audioClips }), selection: [rightId] }
      }
      const l = layout(state.clips)
      const c = l.find((x) => a.t > x.start + MIN_CLIP && a.t < x.start + x.dur - MIN_CLIP)
      if (!c) return state
      const cut = c.in + (a.t - c.start)
      const left = newClip(c, { out: cut })
      const right = newClip(c, { id: uid(), in: cut, transition: null })
      const clips = state.clips.flatMap((x) => (x.id === c.id ? [left, right] : [x]))
      return { ...commit(state, { clips }), selection: [right.id] }
    }

    // Insert a freeze-frame image at time t (splitting the clip there if needed).
    case 'insertFreeze': {
      const l = layout(state.clips)
      const media = state.media.some((m) => m.id === a.item.id) ? state.media : [...state.media, a.item]
      const fc = { id: uid(), mediaId: a.item.id, in: 0, out: a.duration || 2, transition: null, noAudio: [] }
      const hit = l.filter((x) => a.t >= x.start && a.t < x.start + x.dur)
      const c = hit.length ? hit[hit.length - 1] : l[l.length - 1]
      // the frozen picture keeps the look the clip had at that moment
      if (c && hasTransform(c)) {
        const ts = Math.min(c.in + (a.t - c.start), c.out)
        fc.tf = evalTransform(c, ts)
        const wp = evalWarp(c, ts)
        if (wp) fc.warp = { fixed: wp, keys: [] }
      }
      let clips
      if (!c) clips = [fc]
      else {
        const idx = state.clips.findIndex((x) => x.id === c.id)
        const local = a.t - c.start
        if (local <= MIN_CLIP) {
          clips = [...state.clips.slice(0, idx), fc, ...state.clips.slice(idx)]
        } else if (local >= c.dur - MIN_CLIP) {
          clips = [...state.clips.slice(0, idx + 1), fc, ...state.clips.slice(idx + 1)]
        } else {
          const cut = c.in + local
          const left = newClip(c, { out: cut })
          const right = newClip(c, { id: uid(), in: cut, transition: null })
          clips = [...state.clips.slice(0, idx), left, fc, right, ...state.clips.slice(idx + 1)]
        }
      }
      return { ...commit(state, { clips, media }), selection: [fc.id] }
    }

    // Delete everything selected. Deleting an attached audio stream ('sa:') just silences it.
    case 'deleteSelection': {
      if (!state.selection.length) return state
      const sel = new Set(state.selection)
      const gone = new Map() // clipId -> streams deleted
      for (const id of state.selection) {
        if (!id.startsWith('sa:')) continue
        const [, cid, n] = id.split(':')
        gone.set(cid, [...(gone.get(cid) || []), +n])
      }
      const clips = state.clips
        .filter((c) => !sel.has(c.id))
        .map((c) => (gone.has(c.id) ? { ...c, noAudio: [...new Set([...(c.noAudio || []), ...gone.get(c.id)])] } : c))
      const audioClips = state.audioClips.filter((c) => !sel.has(c.id))
      const overlayClips = state.overlayClips.filter((c) => !sel.has(c.id))
      return { ...commit(state, { clips, audioClips, overlayClips }), selection: [] }
    }

    // ---- keyframes (t = source time in seconds; see motion.js). They work on main and overlay clips.
    // Change a property at time t. With no keyframes it changes the fixed value; with keyframes it
    // edits the keyframe at t, or adds one there. Live: call 'checkpoint' first.
    case 'setProp': {
      const f = (c) => {
        if (c.id !== a.id) return c
        const list = (c.anim && c.anim[a.prop]) || []
        if (!list.length) return { ...c, tf: { ...DEFAULTS, ...c.tf, [a.prop]: a.value } }
        const hit = keyAt(list, a.t)
        const next = hit
          ? list.map((k) => (k === hit ? { ...k, v: a.value } : k))
          : sortKeys([...list, { t: a.t, v: a.value, ease: DEFAULT_EASE }])
        return { ...c, anim: { ...c.anim, [a.prop]: next } }
      }
      return { ...state, ...mapClips(state, f) }
    }

    // add a keyframe at t (with the value the property has there), or remove the one that is there
    case 'toggleKey': {
      const f = (c) => {
        if (c.id !== a.id) return c
        const list = (c.anim && c.anim[a.prop]) || []
        const hit = keyAt(list, a.t)
        if (hit) {
          const rest = list.filter((k) => k !== hit)
          const anim = { ...c.anim }
          if (rest.length) anim[a.prop] = rest
          else delete anim[a.prop]
          // the last keyframe's value becomes the fixed value
          return { ...c, anim, tf: rest.length ? c.tf : { ...DEFAULTS, ...c.tf, [a.prop]: hit.v } }
        }
        const v = evalProp(c, a.prop, a.t)
        return { ...c, anim: { ...c.anim, [a.prop]: sortKeys([...list, { t: a.t, v, ease: DEFAULT_EASE }]) } }
      }
      return commit(state, mapClips(state, f))
    }

    case 'setEase': {
      const f = (c) => {
        if (c.id !== a.id) return c
        const list = (c.anim && c.anim[a.prop]) || []
        const hit = keyAt(list, a.t)
        if (!hit) return c
        return { ...c, anim: { ...c.anim, [a.prop]: list.map((k) => (k === hit ? { ...k, ease: a.ease, bez: a.bez || k.bez } : k)) } }
      }
      return a.live ? { ...state, ...mapClips(state, f) } : commit(state, mapClips(state, f))
    }

    // one keyframe for ALL the motion properties at once (add them all here, or remove those that are here)
    case 'toggleKeyAll': {
      const f = (c) => {
        if (c.id !== a.id) return c
        const anyHere = PROPS.some((p) => keyAt(c.anim && c.anim[p.id], a.t))
        const anim = { ...c.anim }
        let tf = c.tf
        for (const p of PROPS) {
          const list = anim[p.id] || []
          const hit = keyAt(list, a.t)
          if (anyHere) {
            if (!hit) continue
            const rest = list.filter((k) => k !== hit)
            if (rest.length) anim[p.id] = rest
            else {
              delete anim[p.id]
              tf = { ...DEFAULTS, ...tf, [p.id]: hit.v }
            }
          } else {
            anim[p.id] = sortKeys([...list, { t: a.t, v: evalProp(c, p.id, a.t), ease: DEFAULT_EASE }])
          }
        }
        return { ...c, anim, tf }
      }
      return commit(state, mapClips(state, f))
    }
    // easing of every motion keyframe at time t
    case 'setEaseAll': {
      const f = (c) => {
        if (c.id !== a.id || !c.anim) return c
        const anim = {}
        for (const [p, list] of Object.entries(c.anim)) {
          anim[p] = (list || []).map((k) => (Math.abs(k.t - a.t) < KEY_EPS ? { ...k, ease: a.ease, bez: a.bez || k.bez } : k))
        }
        return { ...c, anim }
      }
      return a.live ? { ...state, ...mapClips(state, f) } : commit(state, mapClips(state, f))
    }

    // remove all keyframes of a property and put it back to its default
    case 'clearProp': {
      const f = (c) => {
        if (c.id !== a.id) return c
        const anim = { ...c.anim }
        delete anim[a.prop]
        return { ...c, anim, tf: { ...DEFAULTS, ...c.tf, [a.prop]: DEFAULTS[a.prop] } }
      }
      return commit(state, mapClips(state, f))
    }

    // ---- warp (corner pin). a.c = the 8 corner numbers (see motion.js). Live: call 'checkpoint' first.
    // With no keyframes it sets the fixed warp; with keyframes it edits the one at t or adds one there.
    case 'warpSet': {
      const f = (c) => {
        if (c.id !== a.id) return c
        const w = c.warp || { keys: [] }
        const keys = w.keys || []
        if (!keys.length) return { ...c, warp: { ...w, fixed: a.c, keys: [] } }
        const hit = keyAt(keys, a.t)
        const next = hit ? keys.map((k) => (k === hit ? { ...k, c: a.c } : k)) : sortKeys([...keys, { t: a.t, c: a.c, ease: DEFAULT_EASE }])
        return { ...c, warp: { ...w, keys: next } }
      }
      return { ...state, ...mapClips(state, f) }
    }
    // add a warp keyframe here (keeping the current shape), or remove the one that is here
    case 'warpToggleKey': {
      const f = (c) => {
        if (c.id !== a.id) return c
        const w = c.warp || { keys: [] }
        const keys = w.keys || []
        const hit = keyAt(keys, a.t)
        if (hit) {
          const rest = keys.filter((k) => k !== hit)
          return { ...c, warp: { fixed: rest.length ? w.fixed : hit.c, keys: rest } }
        }
        const cur = evalWarp(c, a.t) || WARP_ZERO
        return { ...c, warp: { ...w, keys: sortKeys([...keys, { t: a.t, c: cur, ease: DEFAULT_EASE }]) } }
      }
      return commit(state, mapClips(state, f))
    }
    case 'warpEase': {
      const f = (c) => {
        if (c.id !== a.id || !c.warp) return c
        const hit = keyAt(c.warp.keys, a.t)
        if (!hit) return c
        return { ...c, warp: { ...c.warp, keys: c.warp.keys.map((k) => (k === hit ? { ...k, ease: a.ease, bez: a.bez || k.bez } : k)) } }
      }
      return a.live ? { ...state, ...mapClips(state, f) } : commit(state, mapClips(state, f))
    }
    case 'warpReset': {
      const f = (c) => {
        if (c.id !== a.id) return c
        const { warp, ...rest } = c
        return rest
      }
      return commit(state, mapClips(state, f))
    }

    // live: retime all keyframes sitting at time `from` to time `to` (call 'checkpoint' first)
    case 'moveKeyframes': {
      const f = (c) => {
        if (c.id !== a.id) return c
        let out = c
        if (c.anim) {
          const anim = {}
          for (const [p, list] of Object.entries(c.anim)) {
            anim[p] = sortKeys((list || []).map((k) => (Math.abs(k.t - a.from) < KEY_EPS ? { ...k, t: a.to } : k)))
          }
          out = { ...out, anim }
        }
        if (c.warp && c.warp.keys && c.warp.keys.length) {
          out = { ...out, warp: { ...c.warp, keys: sortKeys(c.warp.keys.map((k) => (Math.abs(k.t - a.from) < KEY_EPS ? { ...k, t: a.to } : k))) } }
        }
        return out
      }
      return { ...state, ...mapClips(state, f) }
    }    case 'setTransition': {
      const clips = state.clips.map((c) => (c.id === a.id ? { ...c, transition: a.transition } : c))
      return commit(state, { clips })
    }

    // live slider updates (call 'checkpoint' first)
    case 'setTransitionDuration': {
      const clips = state.clips.map((c) =>
        c.id === a.id && c.transition ? { ...c, transition: { ...c.transition, duration: a.duration } } : c
      )
      return { ...state, clips }
    }

    // ---- group / ungroup
    // Group, in two steps:
    //  1. detached audio is attached back to its video (when selected with that video, or alone);
    //     deleted audio of a single selected video clip is restored
    //  2. whatever else is selected (video clips and audio clips, 2 or more) becomes one group
    case 'group': {
      const sel = new Set(state.selection)
      let clips = state.clips
      let audioClips = state.audioClips
      let changed = false

      // attach back: detached audio selected together with its own video, or selected on its own
      const single = state.selection.length === 1
      const back = audioClips.filter((x) => x.origin && sel.has(x.id) && clips.some((c) => c.id === x.origin) && (single || sel.has(x.origin)))
      if (back.length) {
        const ids = new Set(back.map((x) => x.id))
        audioClips = audioClips.filter((x) => !ids.has(x.id))
        clips = clips.map((c) => {
          const ns = back.filter((x) => x.origin === c.id).map((x) => x.stream)
          return ns.length ? { ...c, noAudio: (c.noAudio || []).filter((n) => !ns.includes(n)) } : c
        })
        changed = true
      }
      clips = clips.map((c) => {
        if (!single || !sel.has(c.id) || !(c.noAudio || []).length) return c
        const keep = (c.noAudio || []).filter((n) => audioClips.some((x) => x.origin === c.id && x.stream === n))
        if (keep.length === c.noAudio.length) return c
        changed = true
        return { ...c, noAudio: keep }
      })

      let overlayClips = state.overlayClips
      const memberOf = (id) => clips.find((c) => c.id === id) || overlayClips.find((c) => c.id === id) || audioClips.find((x) => x.id === id)
      const members = [...sel].filter((id) => memberOf(id))
      const gids = new Set(members.map((id) => memberOf(id).groupId))
      const alreadyOne = gids.size === 1 && !gids.has(undefined)
      let selection = members
      if (members.length >= 2 && !alreadyOne) {
        const gid = uid()
        const mset = new Set(members)
        clips = clips.map((c) => (mset.has(c.id) ? { ...c, groupId: gid } : c))
        overlayClips = overlayClips.map((c) => (mset.has(c.id) ? { ...c, groupId: gid } : c))
        audioClips = audioClips.map((x) => (mset.has(x.id) ? { ...x, groupId: gid } : x))
        changed = true
      }
      if (!changed) return state
      // drop detached-audio tracks that ended up empty
      const audioTracks = state.audioTracks.filter((t) => !t.id.startsWith('ug') || audioClips.some((x) => x.trackId === t.id))
      return { ...commit(state, { clips, audioClips, overlayClips }), audioTracks, selection }
    }

    // Ungroup:
    //  - if anything selected is in a group, the group(s) are dissolved
    //  - otherwise attached audio is detached: just the selected streams, or every stream of a
    //    selected video clip. Each stream becomes its own audio clip on its own track.
    case 'ungroup': {
      const sel = new Set(state.selection)
      const gids = new Set()
      for (const id of sel) {
        const it = itemOf(state, id)
        if (it && it.groupId) gids.add(it.groupId)
      }
      if (gids.size) {
        const clips = state.clips.map((c) => (gids.has(c.groupId) ? { ...c, groupId: undefined } : c))
        const audioClips = state.audioClips.map((x) => (gids.has(x.groupId) ? { ...x, groupId: undefined } : x))
        const overlayClips = state.overlayClips.map((c) => (gids.has(c.groupId) ? { ...c, groupId: undefined } : c))
        return commit(state, { clips, audioClips, overlayClips })
      }

      const lay = layout(state.clips)
      const tracks = [...state.audioTracks]
      const added = []
      const detached = new Map() // clipId -> streams detached
      for (const c of lay) {
        const m = state.media.find((x) => x.id === c.mediaId)
        if (!m || m.type !== 'video') continue
        const streams = []
        for (let n = 0; n < (m.audioStreams || []).length; n++) {
          if (!hasAttached(c, m, n)) continue
          if (sel.has(c.id) || sel.has(`sa:${c.id}:${n}`)) streams.push(n)
        }
        for (const n of streams) {
          const tid = 'ug' + n
          if (!tracks.some((t) => t.id === tid)) tracks.push({ id: tid, name: `Video audio ${n + 1} (detached)`, kind: 'free', volume: 1, mute: false })
          added.push({ id: uid(), mediaId: m.id, stream: n, trackId: tid, in: c.in, out: c.out, start: c.start, origin: c.id, groupId: c.groupId })
        }
        if (streams.length) detached.set(c.id, streams)
      }
      if (!added.length) return state
      const clips = state.clips.map((c) => (detached.has(c.id) ? { ...c, noAudio: [...new Set([...(c.noAudio || []), ...detached.get(c.id)])] } : c))
      return { ...commit(state, { clips, audioClips: [...state.audioClips, ...added] }), audioTracks: tracks, selection: added.map((x) => x.id) }
    }

    // ---- overlay video tracks & clips
    case 'addVideoTrack': {
      const keys = rowKeys(state)
      return {
        ...state,
        videoTracks: [...state.videoTracks, { id: a.id, name: nextVideoName(state.videoTracks, state.mainName) }],
        rowOrder: ['v:' + a.id, ...keys],
      }
    }
    case 'removeVideoTrack': {
      if (!state.videoTracks.some((x) => x.id === a.id)) return state
      const gone = new Set(state.overlayClips.filter((c) => c.trackId === a.id).map((c) => c.id))
      return {
        ...commit(state, { overlayClips: state.overlayClips.filter((c) => c.trackId !== a.id), audioClips: state.audioClips.filter((c) => !gone.has(c.origin)) }),
        videoTracks: state.videoTracks.filter((x) => x.id !== a.id),
        selection: [],
      }
    }
    // rename any row: key = 'main' | 'v:<id>' | 's:<n>' | 'a:<id>'
    case 'renameRow': {
      const name = String(a.name || '').trim().slice(0, 40)
      if (!name) return state
      if (a.key === 'main') return { ...state, mainName: name }
      if (a.key.startsWith('v:')) return { ...state, videoTracks: state.videoTracks.map((t) => (t.id === a.key.slice(2) ? { ...t, name } : t)) }
      if (a.key.startsWith('a:')) return { ...state, audioTracks: state.audioTracks.map((t) => (t.id === a.key.slice(2) ? { ...t, name } : t)) }
      if (a.key.startsWith('s:')) {
        const n = +a.key.slice(2)
        return { ...state, streamSettings: { ...state.streamSettings, [n]: { volume: 1, mute: false, ...state.streamSettings[n], name } } }
      }
      return state
    }
    // drag a row to a new place: toIndex counts in the list of rows with this one taken out
    case 'moveRow': {
      const keys = rowKeys(state)
      if (!keys.includes(a.key)) return state
      const rest = keys.filter((k) => k !== a.key)
      const idx = clamp(a.toIndex, 0, rest.length)
      const next = [...rest.slice(0, idx), a.key, ...rest.slice(idx)]
      if (next.every((k, i) => k === keys[i])) return state
      return { ...state, rowOrder: next }
    }

    // drop media on an overlay track (the first one, or a new one, if trackId is missing)
    case 'addOverlayClip': {
      const m = state.media.find((x) => x.id === a.mediaId)
      if (!m || m.type === 'audio') return state
      let videoTracks = state.videoTracks
      let rowOrder = state.rowOrder
      let trackId = a.trackId
      if (!trackId) {
        if (videoTracks.length) trackId = videoTracks[0].id
        else {
          trackId = a.newTrackId || uid()
          rowOrder = ['v:' + trackId, ...rowKeys(state)]
          videoTracks = [...videoTracks, { id: trackId, name: nextVideoName(videoTracks, state.mainName) }]
        }
      }
      const gid = m.type === 'video' && (m.audioStreams || []).length ? uid() : undefined
      const clip = { id: uid(), mediaId: m.id, trackId, in: 0, out: m.duration || 3, start: Math.max(0, a.start || 0), groupId: gid }
      if (m.type === 'image') clip.out = 3
      // the video's own sound goes to detached audio clips grouped with it
      const tracks = [...state.audioTracks]
      const added = []
      if (gid) {
        for (let n = 0; n < m.audioStreams.length; n++) {
          const tid = 'ug' + n
          if (!tracks.some((t) => t.id === tid)) tracks.push({ id: tid, name: `Video audio ${n + 1} (detached)`, kind: 'free', volume: 1, mute: false })
          added.push({ id: uid(), mediaId: m.id, stream: n, trackId: tid, in: 0, out: clip.out, start: clip.start, origin: clip.id, groupId: gid })
        }
      }
      return {
        ...commit(state, { overlayClips: [...state.overlayClips, clip], audioClips: [...state.audioClips, ...added] }),
        videoTracks,
        rowOrder,
        audioTracks: tracks,
        selection: [clip.id, ...added.map((x) => x.id)],
      }
    }

    // live drag of overlay and audio clips (call 'checkpoint' first); moves = [{id, start, trackId?}]
    case 'moveItems': {
      const to = new Map(a.moves.map((m) => [m.id, m]))
      return {
        ...state,
        overlayClips: state.overlayClips.map((c) => (to.has(c.id) ? { ...c, start: Math.max(0, to.get(c.id).start), trackId: to.get(c.id).trackId || c.trackId } : c)),
        audioClips: state.audioClips.map((c) => (to.has(c.id) ? { ...c, start: Math.max(0, to.get(c.id).start) } : c)),
      }
    }
    // live trim of an overlay clip; value = new absolute in/out (source seconds)
    case 'trimOverlay': {
      const overlayClips = state.overlayClips.map((c) => {
        if (c.id !== a.id) return c
        const m = state.media.find((x) => x.id === c.mediaId)
        const maxOut = m && m.type === 'video' ? m.duration : 3600
        if (a.side === 'out') return { ...c, out: clamp(a.value, c.in + MIN_CLIP, maxOut) }
        const nin = clamp(a.value, 0, c.out - MIN_CLIP)
        return { ...c, in: nin, start: Math.max(0, c.start + (nin - c.in)) }
      })
      return { ...state, overlayClips }
    }

    // ---- audio tracks & clips
    case 'addAudioTrack': {
      return { ...state, audioTracks: [...state.audioTracks, { id: a.id, name: nextAudioName(state.audioTracks), kind: 'free', volume: 1, mute: false }] }
    }
    case 'removeAudioTrack': {
      if (!state.audioTracks.some((x) => x.id === a.id)) return state
      return {
        ...commit(state, { audioClips: state.audioClips.filter((c) => c.trackId !== a.id) }),
        audioTracks: state.audioTracks.filter((x) => x.id !== a.id),
        selection: [],
      }
    }
    case 'setTrack':
      return { ...state, audioTracks: state.audioTracks.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) }
    case 'setStream':
      return { ...state, streamSettings: { ...state.streamSettings, [a.n]: { volume: 1, mute: false, ...state.streamSettings[a.n], ...a.patch } } }

    case 'addAudioClip': {
      const m = state.media.find((x) => x.id === a.mediaId)
      if (!m || m.type !== 'audio') return state
      let tracks = state.audioTracks
      let trackId = a.trackId
      if (!trackId) {
        const free = tracks.find((t) => !t.id.startsWith('ug'))
        if (free) trackId = free.id
        else {
          trackId = a.newTrackId || uid()
          tracks = [...tracks, { id: trackId, name: 'Audio 1', kind: 'free', volume: 1, mute: false }]
        }
      }
      const clip = { id: uid(), mediaId: m.id, trackId, in: 0, out: m.duration, start: Math.max(0, a.start || 0) }
      return { ...commit(state, { audioClips: [...state.audioClips, clip] }), audioTracks: tracks, selection: [clip.id] }
    }

    // live drag of one or more audio clips (call 'checkpoint' first); moves = [{id, start}]
    case 'moveAudioBatch': {
      const to = new Map(a.moves.map((m) => [m.id, m.start]))
      return { ...state, audioClips: state.audioClips.map((c) => (to.has(c.id) ? { ...c, start: Math.max(0, to.get(c.id)) } : c)) }
    }

    // live trim; value = new absolute in/out (source seconds). Trimming the left edge keeps the
    // remaining sound where it was on the timeline.
    case 'trimAudio': {
      const audioClips = state.audioClips.map((c) => {
        if (c.id !== a.id) return c
        const m = state.media.find((x) => x.id === c.mediaId)
        if (a.side === 'out') return { ...c, out: clamp(a.value, c.in + MIN_CLIP, m ? m.duration : c.out) }
        const nin = clamp(a.value, 0, c.out - MIN_CLIP)
        const d = nin - c.in
        return { ...c, in: nin, start: Math.max(0, c.start + d) }
      })
      return { ...state, audioClips }
    }

    // ---- selection (selecting a group member selects the whole group)
    case 'select': {
      if (a.id == null) return state.selection.length ? { ...state, selection: [] } : state
      const members = expand(state, [a.id])
      if (a.additive) {
        const has = state.selection.includes(a.id)
        const rest = state.selection.filter((x) => !members.includes(x))
        return { ...state, selection: has ? rest : [...rest, ...members] }
      }
      return { ...state, selection: members }
    }
    case 'selectMany':
      return { ...state, selection: expand(state, a.ids) }

    case 'setPlayhead':
      return {
        ...state,
        playhead: Math.max(0, a.t),
        seekId: a.user ? state.seekId + 1 : state.seekId,
      }

    case 'setPlaying':
      return { ...state, playing: a.value }

    case 'undo': {
      if (!state.past.length) return state
      const prev = state.past[state.past.length - 1]
      return ensureTracks({ ...state, ...prev, past: state.past.slice(0, -1), future: [snap(state), ...state.future] })
    }
    case 'redo': {
      if (!state.future.length) return state
      const next = state.future[0]
      return ensureTracks({ ...state, ...next, past: [...state.past, snap(state)], future: state.future.slice(1) })
    }
    default:
      return state
  }
}

// Used to enable/disable the toolbar buttons: an action is possible if it would change something.
export const canGroup = (state) => reducer(state, { type: 'group' }) !== state
export const canUngroup = (state) => reducer(state, { type: 'ungroup' }) !== state

export function toUrl(p) {
  return 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

// a clip length for the timeline: 12.3s, then 52m 19s, then 1h 05m 12s
export function fmtDur(t) {
  if (t < 60) return t.toFixed(1) + 's'
  const total = Math.round(t)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export function fmtTime(t) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const f = Math.floor((t % 1) * 30)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}
