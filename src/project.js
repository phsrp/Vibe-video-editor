// Project files: a .json holding the timeline and a list of the source files used.
// Thumbnails and extracted audio are not stored; they are rebuilt when a project is opened.

export function serialize(state) {
  return JSON.stringify({
    app: 'vibe-video-editor',
    kind: 'video',
    version: 1,
    media: state.media.map((m) => ({
      id: m.id,
      path: m.path,
      name: m.name,
      type: m.type,
      duration: m.duration,
      width: m.width,
      height: m.height,
      audioStreams: m.audioStreams,
    })),
    clips: state.clips,
    audioClips: state.audioClips,
    audioTracks: state.audioTracks,
    streamSettings: state.streamSettings,
    transcripts: state.transcripts,
    overlayClips: state.overlayClips,
    videoTracks: state.videoTracks,
    mainName: state.mainName,
    rowOrder: state.rowOrder,
    aspect: state.aspect,
    markers: state.markers,
    lockedRows: state.lockedRows,
    hiddenRows: state.hiddenRows,
  })
}

// Re-reads every source file (fresh thumbnails, audio streams). Files that no longer exist are kept
// in the project, flagged `missing`, so nothing is lost. Returns the project parts for 'loadProject'.
export async function restore(json) {
  const data = JSON.parse(json)
  if (data.app !== 'vibe-video-editor' || !Array.isArray(data.clips)) throw new Error('This is not a project file from this editor.')

  const paths = [...new Set(data.media.map((m) => m.path))]
  const items = paths.length ? await window.api.describeFiles(paths) : []
  const byPath = new Map(items.map((i) => [i.path, i]))

  const idMap = new Map() // saved id -> id of the freshly read file
  const media = []
  const missing = []
  for (const m of data.media) {
    const item = byPath.get(m.path)
    const id = item ? item.id : m.id
    idMap.set(m.id, id)
    if (media.some((x) => x.id === id)) continue
    if (item) media.push(item)
    else {
      missing.push(m.name)
      media.push({ ...m, thumb: null, audioFiles: [], audioPending: false, missing: true })
    }
  }
  const remap = (list) => list.map((x) => ({ ...x, mediaId: idMap.get(x.mediaId) || x.mediaId }))
  return {
    media,
    clips: remap(data.clips),
    audioClips: remap(data.audioClips || []),
    overlayClips: remap(data.overlayClips || []),
    videoTracks: data.videoTracks || [],
    mainName: data.mainName || 'Video 1',
    rowOrder: data.rowOrder || [],
    aspect: data.aspect || '16:9',
    markers: data.markers || [],
    lockedRows: data.lockedRows || [],
    hiddenRows: data.hiddenRows || [],
    audioTracks: data.audioTracks || [],
    streamSettings: data.streamSettings || {},
    // what was said in each video; their file ids may have changed when the files were read again
    transcripts: Object.fromEntries(Object.entries(data.transcripts || {}).map(([k, v]) => [idMap.get(k) || k, v])),
    missing,
    pending: media.filter((m) => m.audioPending),
  }
}

 // used by the developer self-test

// ---- image projects: the canvas, the layers (each an overlay clip on a track) and the pictures they use. Paint layers
// keep their brush strokes inside the clip, so they are saved with it.
export function serializeImage(state) {
  return JSON.stringify({
    app: 'vibe-editing-suite',
    kind: 'image',
    version: 1,
    canvas: state.canvas,
    media: state.media.map((m) => ({ id: m.id, path: m.path, name: m.name, type: m.type, width: m.width, height: m.height })),
    overlayClips: state.overlayClips,
    videoTracks: state.videoTracks,
    rowOrder: state.rowOrder,
    lockedRows: state.lockedRows,
    hiddenRows: state.hiddenRows,
  })
}

export async function restoreImage(json) {
  const data = JSON.parse(json)
  if (data.kind !== 'image' || !data.canvas) throw new Error('This is not an image project.')
  const paths = [...new Set(data.media.map((m) => m.path))]
  const items = paths.length ? await window.api.describeFiles(paths) : []
  const byPath = new Map(items.map((i) => [i.path, i]))
  const idMap = new Map()
  const media = []
  const missing = []
  for (const m of data.media) {
    const item = byPath.get(m.path)
    const id = item ? item.id : m.id
    idMap.set(m.id, id)
    if (media.some((x) => x.id === id)) continue
    if (item) media.push(item)
    else {
      missing.push(m.name)
      media.push({ ...m, thumb: null, audioFiles: [], audioPending: false, missing: true })
    }
  }
  return {
    canvas: data.canvas,
    media,
    overlayClips: (data.overlayClips || []).map((x) => ({ ...x, mediaId: x.mediaId ? idMap.get(x.mediaId) || x.mediaId : x.mediaId })),
    videoTracks: data.videoTracks || [],
    rowOrder: data.rowOrder || [],
    lockedRows: data.lockedRows || [],
    hiddenRows: data.hiddenRows || [],
    missing,
  }
}

// 'image' or 'video': what kind of project a saved file is
export function kindOf(json) {
  try {
    const k = JSON.parse(json).kind
    return k === 'image' ? 'image' : k === 'drawing' ? 'drawing' : 'video'
  } catch {
    return 'video'
  }
}

if (typeof window !== 'undefined') window.__vibeProject = { serialize, restore, serializeImage, restoreImage, kindOf } // used by the developer self-test
