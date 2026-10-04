// Project files: a .json holding the timeline and a list of the source files used.
// Thumbnails and extracted audio are not stored; they are rebuilt when a project is opened.

export function serialize(state) {
  return JSON.stringify({
    app: 'vibe-video-editor',
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
    audioTracks: data.audioTracks || [],
    streamSettings: data.streamSettings || {},
    missing,
    pending: media.filter((m) => m.audioPending),
  }
}

if (typeof window !== 'undefined') window.__vibeProject = { serialize, restore } // used by the developer self-test
