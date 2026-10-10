// Which microphone records the voice-overs and which speakers / headphones play the preview.
// The choice is kept in settings.json (audioInputId, audioOutputId); an empty one means "the system default".

let outId = ''
let inId = ''
const subs = new Set()

export const getOutputId = () => outId
export const getInputId = () => inId
export function setDevices({ out, inp }) {
  const o = out || ''
  const i = inp || ''
  if (o === outId && i === inId) return
  outId = o
  inId = i
  subs.forEach((f) => f())
}
export function onDevices(cb) {
  subs.add(cb)
  return () => subs.delete(cb)
}

// send the sound of an AudioContext to the chosen speakers
export function routeOutput(ctx) {
  try {
    if (ctx && ctx.setSinkId) ctx.setSinkId(outId || '').catch(() => {})
  } catch {}
}

// the devices of this PC. (The names only show once the microphone has been allowed, so it is asked for once.)
export async function listDevices() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
  } catch {}
  const all = await navigator.mediaDevices.enumerateDevices()
  const name = (d, i, what) => d.label || `${what} ${i + 1}`
  return {
    inputs: all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => ({ id: d.deviceId, label: name(d, i, 'Microphone') })),
    outputs: all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => ({ id: d.deviceId, label: name(d, i, 'Speakers') })),
  }
}

// the microphone stream for recording: the chosen one, or the default when it is not there any more
export async function openMicrophone(extra = {}) {
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...extra }
  if (inId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: inId } } })
    } catch {
      // unplugged or renamed: use the default
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base })
}
