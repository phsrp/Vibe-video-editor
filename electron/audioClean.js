// Audio cleanup of one clip: noise reduction, cutting low rumble, and a voice preset.
// clean = { nr: 0..100 (0 = off), rumble: bool, voice: '' | 'clear' | 'podcast' | 'warm' | 'phone' }
// cleanChain() returns an ffmpeg audio filter chain ('' when nothing is switched on). The export puts it in front of the
// clip's speed and volume; the preview plays a copy that was rendered with the very same chain, so both sound alike.
//
// The noise reduction (afftdn) only works well when it is told how loud the noise is ("noise floor", in dB). That differs
// from clip to clip, so estimateFloor() listens to the clip first: the quietest tenth of it is taken as the noise.

const { execFile } = require('child_process')

const VOICES = {
  // a little clearer: less boxiness, more presence, even out loud and quiet words
  clear: 'equalizer=f=220:t=q:w=1:g=-2,equalizer=f=3000:t=q:w=1:g=3,acompressor=threshold=0.1:ratio=3:attack=10:release=150:makeup=2',
  // a full, even radio voice
  podcast: 'highpass=f=80,equalizer=f=120:t=q:w=1:g=2,equalizer=f=4000:t=q:w=1:g=2.5,acompressor=threshold=0.06:ratio=4:attack=5:release=120:makeup=4,alimiter=limit=0.9',
  // rounder and softer
  warm: 'equalizer=f=150:t=q:w=1:g=3,equalizer=f=6000:t=q:w=1.5:g=-3',
  // sounds like a phone call
  phone: 'highpass=f=300,lowpass=f=3400,acompressor=threshold=0.1:ratio=3:makeup=2',
}
const VOICE_NAMES = Object.keys(VOICES)

// nf = the measured noise floor in dB (see estimateFloor); without one a middle value is used
function cleanChain(clean, nf) {
  if (!clean) return ''
  const parts = []
  if (clean.rumble) parts.push('highpass=f=90')
  const nr = Math.max(0, Math.min(100, Math.round(+clean.nr || 0)))
  if (nr > 0) parts.push(`afftdn=nr=${Math.round(4 + nr * 0.28)}:nf=${Math.round(typeof nf === 'number' ? nf : -35)}`)
  if (clean.voice && VOICES[clean.voice]) parts.push(VOICES[clean.voice])
  return parts.join(',')
}

// How loud is the noise in this stretch of sound? Looks at the level of every quarter second and takes the quiet end.
// Returns a noise floor in dB for afftdn (kept between -65 and -28 so that it never gets too aggressive).
function estimateFloor(ffmpegPath, file, stream, start, dur) {
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-nostats', '-v', 'info']
    if (start > 0) args.push('-ss', String(start))
    if (dur > 0) args.push('-t', String(dur))
    args.push('-i', file, '-map', `0:a:${stream || 0}`, '-af', 'aformat=channel_layouts=mono,asetnsamples=n=12000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level', '-f', 'null', '-')
    execFile(ffmpegPath, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (_err, _out, text) => {
      const levels = []
      for (const m of String(text || '').matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-?inf)/g)) {
        const v = parseFloat(m[1])
        if (isFinite(v) && v > -90) levels.push(v)
      }
      if (levels.length < 4) return resolve(-35)
      levels.sort((a, b) => a - b)
      const quiet = levels[Math.floor(levels.length * 0.1)]
      resolve(Math.max(-65, Math.min(-28, Math.round(quiet + 1))))
    })
  })
}

module.exports = { cleanChain, estimateFloor, VOICE_NAMES }
