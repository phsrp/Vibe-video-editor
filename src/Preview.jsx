import { useEffect, useRef } from 'react'
import { createRenderer } from './glRenderer.js'
import { evalTransform } from './motion.js'
import { layout, audioLayout, audioSource, totalDuration, toUrl } from './state.js'

// Owns the canvas, the playback clock and the <video>/<img> elements.
export default function Preview({ state, dispatch, transitions, onCompiled, active = true }) {
  const activeRef = useRef(active)
  activeRef.current = active
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const els = useRef(new Map()) // clipId -> {el, kind, media}
  const aels = useRef(new Map()) // audio key -> {el}

  useEffect(() => {
    const renderer = createRenderer(canvasRef.current)
    rendererRef.current = renderer
    window.__renderer = renderer
    window.__aels = aels.current // for the developer self-test
    let raf
    let clock = { ms: 0, t0: 0, seek: -1, playing: false }

    function getEl(clip, media) {
      let e = els.current.get(clip.id)
      if (e) return e
      let el
      if (media.type === 'video') {
        el = document.createElement('video')
        el.preload = 'auto'
        el.playsInline = true
        el.muted = true // sound comes from the separately extracted audio streams
        el.src = toUrl(media.path)
      } else {
        el = new Image()
        el.src = toUrl(media.path)
      }
      e = { el, kind: media.type, media }
      els.current.set(clip.id, e)
      return e
    }

    // ---- audio: every video audio stream and every audio clip plays from its own <audio>
    function getAudio(key, file) {
      let e = aels.current.get(key)
      if (!e) {
        const el = new Audio()
        el.preload = 'auto'
        el.src = toUrl(file)
        e = { el }
        aels.current.set(key, e)
      }
      return e
    }

    function audioPass(t, s, clips) {
      const want = new Map() // key -> {file, src, vol}
      const soon = [] // clips starting in the next few seconds: loaded ahead so they start on time
      const valid = new Set()
      const mediaOf = (id) => s.media.find((m) => m.id === id)
      clips.forEach((c, i) => {
        const m = mediaOf(c.mediaId)
        if (!m || m.type !== 'video') return
        const active = t >= c.start && t < c.start + c.dur
        const upcoming = !active && c.start > t && c.start - t < 3
        ;(m.audioFiles || []).forEach((f, n) => {
          if (!f || (c.noAudio || []).includes(n)) return // missing file, or detached/deleted stream
          const key = `v:${c.id}:${n}`
          valid.add(key)
          if (active) {
            // crossfade the audio of the two clips during a transition
            let fade = 1
            if (c.ov > 0 && t < c.start + c.ov) fade *= (t - c.start) / c.ov
            const nx = clips[i + 1]
            if (nx && nx.ov > 0 && t >= nx.start) fade *= 1 - (t - nx.start) / nx.ov
            const st = s.streamSettings[n] || {}
            want.set(key, { file: f, src: c.in + (t - c.start), vol: st.mute ? 0 : (st.volume ?? 1) * fade })
          } else if (upcoming) soon.push({ key, file: f, src: c.in })
        })
      })
      for (const a of audioLayout(s.audioClips)) {
        const file = audioSource(a, mediaOf(a.mediaId))
        if (!file) continue // e.g. a detached stream that is still being prepared
        const key = `a:${a.id}`
        valid.add(key)
        const tr = s.audioTracks.find((x) => x.id === a.trackId)
        const active = t >= a.start && t < a.start + a.dur
        if (active) want.set(key, { file, src: a.in + (t - a.start), vol: tr ? (tr.mute ? 0 : tr.volume) : 1 })
        else if (a.start > t && a.start - t < 3) soon.push({ key, file, src: a.in })
      }
      for (const [key, w] of want) {
        const el = getAudio(key, w.file).el
        el.volume = Math.max(0, Math.min(1, w.vol))
        if (s.playing) {
          if (Math.abs(el.currentTime - w.src) > 0.25) el.currentTime = w.src
          if (el.paused) el.play().catch(() => {})
        } else if (!el.paused) el.pause()
      }
      for (const u of soon) {
        const el = getAudio(u.key, u.file).el
        if (el.paused && el.readyState > 0 && Math.abs(el.currentTime - u.src) > 0.05 && !el.seeking) el.currentTime = u.src
      }
      for (const [key, e] of aels.current) {
        if (!valid.has(key)) {
          e.el.pause()
          e.el.removeAttribute('src')
          e.el.load()
          aels.current.delete(key)
        } else if (!want.has(key) && !e.el.paused) e.el.pause()
      }
    }

    // Keep a clip's <video> in step with the timeline; returns {el,w,h} if a frame is ready.
    function syncClip(clip, t, playing, media) {
      const e = getEl(clip, media)
      if (e.kind === 'video') {
        const v = e.el
        const src = Math.min(clip.in + (t - clip.start), clip.out)
        if (playing) {
          if (Math.abs(v.currentTime - src) > 0.3) v.currentTime = src
          if (v.paused) v.play().catch(() => {})
        } else {
          if (!v.paused) v.pause()
          if (Math.abs(v.currentTime - src) > 0.02 && !v.seeking) v.currentTime = src
        }
        return v.readyState >= 2 ? { el: v, w: v.videoWidth, h: v.videoHeight } : null
      }
      return e.el.complete && e.el.naturalWidth ? { el: e.el, w: e.el.naturalWidth, h: e.el.naturalHeight } : null
    }

    function frame(now) {
      raf = requestAnimationFrame(frame)
      // a project in a background tab does nothing and makes no sound
      if (!activeRef.current) {
        for (const e of els.current.values()) if (e.kind === 'video' && !e.el.paused) e.el.pause()
        for (const e of aels.current.values()) if (!e.el.paused) e.el.pause()
        clock.playing = false
        return
      }
      const s = stateRef.current
      const clips = layout(s.clips)
      const total = totalDuration(s.clips)

      // playback clock
      let t = s.playhead
      if (s.playing) {
        if (!clock.playing || clock.seek !== s.seekId) {
          if (!clock.playing && t >= total - 0.05) t = 0
          clock = { ms: now, t0: t, seek: s.seekId, playing: true }
        }
        t = clock.t0 + (now - clock.ms) / 1000
        if (t >= total) {
          t = total
          dispatch({ type: 'setPlaying', value: false })
          clock.playing = false
        }
        dispatch({ type: 'setPlayhead', t })
      } else {
        clock.playing = false
      }

      // drop elements of deleted clips
      for (const [id, e] of els.current) {
        if (!clips.some((c) => c.id === id)) {
          if (e.kind === 'video') {
            e.el.pause()
            e.el.removeAttribute('src')
            e.el.load()
          }
          els.current.delete(id)
        }
      }

      audioPass(t, s, clips)

      // clips under the playhead: one normally, two during a transition
      let act = clips.filter((c) => t >= c.start && t < c.start + c.dur)
      if (!act.length && clips.length && t >= total) act = [clips[clips.length - 1]]
      act = act.slice(-2)
      const actIds = new Set(act.map((c) => c.id))
      for (const [id, e] of els.current) {
        if (e.kind === 'video' && !actIds.has(id) && !e.el.paused) e.el.pause()
      }
      if (!act.length) return renderer.clear()

      const mediaOf = (c) => s.media.find((m) => m.id === c.mediaId)
      const cA = act[0]
      const cB = act.length > 1 ? act[1] : null
      const mA = mediaOf(cA)
      const mB = cB && mediaOf(cB)
      if (!mA) return renderer.clear()
      const A = syncClip(cA, t, s.playing, mA)
      const B = cB && mB ? syncClip(cB, t, s.playing, mB) : null
      // each clip's motion (position / scale / rotation / opacity) at this moment
      if (A) A.tf = evalTransform(cA, Math.min(cA.in + (t - cA.start), cA.out))
      if (B) B.tf = evalTransform(cB, Math.min(cB.in + (t - cB.start), cB.out))
      if (cB && B && A) {
        renderer.render(A, B, cB.transition && cB.transition.name, (t - cB.start) / cB.ov)
      } else if (A) {
        renderer.render(A, null)
      }

      // warm up the following clip so the cut / transition starts seamlessly
      const last = act[act.length - 1]
      const next = clips[clips.findIndex((c) => c.id === last.id) + 1]
      if (next) {
        const nm = mediaOf(next)
        if (nm) {
          const ne = getEl(next, nm)
          if (ne.kind === 'video' && ne.el.paused && ne.el.readyState > 0 && Math.abs(ne.el.currentTime - next.in) > 0.05 && !ne.el.seeking)
            ne.el.currentTime = next.in
        }
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [dispatch])

  // (re)compile the transition library whenever the list changes
  useEffect(() => {
    const r = rendererRef.current
    if (!r || !transitions) return
    const errors = {}
    for (const tr of transitions) {
      const err = r.addTransition(tr.name, tr.source)
      if (err) errors[tr.name] = err
    }
    onCompiled && onCompiled(errors)
  }, [transitions])

  return (
    <div className="preview-wrap">
      <canvas ref={canvasRef} width={1280} height={720} className="preview-canvas" />
    </div>
  )
}
