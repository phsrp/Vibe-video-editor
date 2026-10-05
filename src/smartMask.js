// Smart mask: draw a loop around a subject and an AI model (MobileSAM, run on your own PC by onnxruntime-web)
// finds its exact outline. The model files are downloaded once from Hugging Face (see electron/main.js, 'models:*').
import { toUrl } from './state.js'
import { MAX_POLY, polyCentre } from './masks.js'

// The AI runs on the graphics card (WebGPU) when this PC has one that works, otherwise on the processor (WebAssembly).
// window.__smartEngine says which one was used.
let ortCache = {}
async function getOrt(kind) {
  if (!ortCache[kind]) {
    ortCache[kind] = (kind === 'gpu' ? import('onnxruntime-web/webgpu') : import('onnxruntime-web/wasm')).then((ort) => {
      ort.env.wasm.wasmPaths = new URL('./ort/', document.baseURI).href
      ort.env.wasm.numThreads = kind === 'gpu' ? 1 : 1
      return ort
    })
  }
  return ortCache[kind]
}

let sessions = null
async function getSessions(paths) {
  if (sessions) return sessions
  const buffers = {}
  const buf = async (p) => buffers[p] || (buffers[p] = await (await fetch(toUrl(p))).arrayBuffer())
  const build = async (kind) => {
    const ort = await getOrt(kind)
    const eps = kind === 'gpu' ? ['webgpu'] : ['wasm']
    const load = async (p) => ort.InferenceSession.create(await buf(p), { executionProviders: eps })
    return { ort, kind, encoder: await load(paths.encoder), decoder: await load(paths.decoder) }
  }
  let made = null
  if (!window.__smartForceCpu && typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
      if (ad) made = await build('gpu')
    } catch (e) {
      window.__smartGpuError = String((e && e.message) || e)
      made = null
    }
  }
  if (!made) made = await build('cpu')
  window.__smartEngine = made.kind
  sessions = made
  return sessions
}
// 'gpu' or 'cpu': which engine runs the AI on this PC (loads the models if they are not loaded yet)
export async function engineKind(paths) {
  return (await getSessions(paths)).kind
}
// forget the loaded models (developer self-test: compare the two engines)
export function resetEngine() {
  sessions = null
  cache.embeddings = null
}

// names of the inputs and outputs of the two models (used by the developer self-test)
export async function describeModels(paths) {
  const s = await getSessions(paths)
  return { encoder: { in: s.encoder.inputNames, out: s.encoder.outputNames }, decoder: { in: s.decoder.inputNames, out: s.decoder.outputNames } }
}

// The picture as the model wants it: longest side 1024, as raw 0..255 values in height x width x 3 order (the model
// subtracts the mean and pads to a square itself).
function prepare(el, w, h) {
  const scale = 1024 / Math.max(w, h)
  const nw = Math.round(w * scale)
  const nh = Math.round(h * scale)
  const cv = document.createElement('canvas')
  cv.width = nw
  cv.height = nh
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(el, 0, 0, nw, nh)
  const px = g.getImageData(0, 0, nw, nh).data
  const data = new Float32Array(nw * nh * 3)
  for (let i = 0, n = nw * nh; i < n; i++) {
    data[i * 3] = px[i * 4]
    data[i * 3 + 1] = px[i * 4 + 1]
    data[i * 3 + 2] = px[i * 4 + 2]
  }
  return { data, scale, nw, nh }
}
// polygon helpers (points are [x, y] in 0..1 picture coordinates)
const inside = (p, poly) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}

// The outer outline of the biggest blob of a black / white grid, followed with the "Moore" method.
function outline(grid, gw, gh) {
  // biggest connected blob
  const label = new Int32Array(gw * gh)
  let best = 0
  let bestSize = 0
  let next = 1
  const stack = []
  for (let s = 0; s < gw * gh; s++) {
    if (!grid[s] || label[s]) continue
    let size = 0
    stack.push(s)
    label[s] = next
    while (stack.length) {
      const i = stack.pop()
      size++
      const x = i % gw
      const y = (i / gw) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        const j = ny * gw + nx
        if (grid[j] && !label[j]) {
          label[j] = next
          stack.push(j)
        }
      }
    }
    if (size > bestSize) {
      bestSize = size
      best = next
    }
    next++
  }
  if (!best) return []
  const on = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && label[y * gw + x] === best
  // start: first blob pixel in reading order
  let sx = -1
  let sy = -1
  for (let i = 0; i < gw * gh && sx < 0; i++) if (label[i] === best) {
    sx = i % gw
    sy = (i / gw) | 0
  }
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
  const pts = [[sx, sy]]
  let cx = sx
  let cy = sy
  let d = 6 // we came from above
  for (let guard = 0; guard < gw * gh * 4; guard++) {
    let found = false
    for (let k = 0; k < 8; k++) {
      const nd = (d + 6 + k) % 8 // start looking just after the way we came
      const nx = cx + dirs[nd][0]
      const ny = cy + dirs[nd][1]
      if (on(nx, ny)) {
        cx = nx
        cy = ny
        d = nd
        found = true
        break
      }
    }
    if (!found) break
    if (cx === sx && cy === sy && pts.length > 2) break
    pts.push([cx, cy])
  }
  return pts
}

function simplify(pts, tol) {
  if (pts.length < 4) return pts
  const keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let max = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const [x1, y1] = pts[a]
      const [x2, y2] = pts[b]
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1e-9
      const dd = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len
      if (dd > max) {
        max = dd
        idx = i
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = true
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

// the outline made a little bigger around its middle (used as the "loop" that tells the AI where to look next)
const grow = (pts, k) => {
  const c = polyCentre(pts)
  return pts.map((p) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k])
}
const bboxSize = (pts) => {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return Math.sqrt(Math.max(1e-6, (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))))
}

// Follows a subject through a video. file = the video, startPts = its outline at second t0 of the file, the AI looks
// again at each second in `times` (in the order they should be visited, the first is t0). Returns, for each time,
// how far the outline's middle moved and how much its size changed since the start: [{t, mx, my, ms}] (percent).
export async function trackSubject({ file, startPts, times, paths, onProgress, isCancelled }) {
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  v.src = toUrl(file)
  await new Promise((res, rej) => {
    v.onloadeddata = res
    v.onerror = () => rej(new Error('The video could not be opened'))
  })
  const w = v.videoWidth
  const h = v.videoHeight
  const seek = (t) =>
    new Promise((res) => {
      const done = () => {
        v.removeEventListener('seeked', done)
        res()
      }
      v.addEventListener('seeked', done)
      v.currentTime = t
      setTimeout(done, 4000)
    })
  const c0 = polyCentre(startPts)
  const s0 = bboxSize(startPts)
  const out = []
  let prev = startPts
  let before = null // the middle of the outline one look earlier
  try {
    for (let i = 0; i < times.length; i++) {
      if (isCancelled && isCancelled()) return null
      onProgress && onProgress(i, times.length)
      let pts = startPts
      if (i > 0) {
        await seek(times[i])
        // Look for the subject where it was, with a loop that is only a little bigger (a big loop makes the AI pick up the
        // background). A result that is much bigger or smaller than before, or far away, is wrong: try a small loop
        // in the middle of where it was, and if that is wrong too keep the last place.
        const key = 'trk:' + file + ':' + times[i] + ':' + Math.random()
        const sPrev = bboxSize(prev)
        const good = (f) => {
          if (!f || f.length < 3) return false
          const k = bboxSize(f) / sPrev
          const pc = polyCentre(prev)
          const fc = polyCentre(f)
          return k > 0.65 && k < 1.5 && Math.hypot(fc[0] - pc[0], fc[1] - pc[1]) < sPrev * 1.2
        }
        // where it should be now: the last outline moved on by the speed it had between the last two looks
        const pc = polyCentre(prev)
        const vx = before ? pc[0] - before[0] : 0
        const vy = before ? pc[1] - before[1] : 0
        const moved = prev.map((p) => [p[0] + vx, p[1] + vy])
        let found = await findSubject({ el: v, w, h, lasso: grow(moved, 1.04), paths, frameKey: key })
        if (!good(found)) found = await findSubject({ el: v, w, h, lasso: grow(prev, 1.04), paths, frameKey: key })
        if (!good(found)) found = await findSubject({ el: v, w, h, lasso: grow(moved, 0.5), paths, frameKey: key })
        before = pc
        pts = good(found) ? found : prev
      }
      prev = pts
      const c = polyCentre(pts)
      out.push({ t: times[i], mx: (c[0] - c0[0]) * 100, my: (c[1] - c0[1]) * 100, ms: Math.min(400, Math.max(10, (bboxSize(pts) / s0) * 100)) })
    }
  } finally {
    v.removeAttribute('src')
    v.load()
  }
  onProgress && onProgress(times.length, times.length)
  return out
}

const cache = { el: null, key: '', embeddings: null, scale: 1 }

// Finds the subject inside a loop drawn around it. el = the picture (video frame or image) of size w x h,
// lasso = the loop as [x, y] points in 0..1 picture coordinates, paths = the two model files.
// Returns the outline as up to MAX_POLY points in 0..1 picture coordinates, or null when nothing was found.
export async function findSubject({ el, w, h, lasso, paths, frameKey }) {
  const { ort, encoder, decoder } = await getSessions(paths)
  const key = frameKey || ''
  if (!cache.embeddings || cache.el !== el || cache.key !== key) {
    const { data, scale, nw, nh } = prepare(el, w, h)
    const out = await encoder.run({ input_image: new ort.Tensor('float32', data, [nh, nw, 3]) })
    cache.embeddings = out.image_embeddings
    cache.scale = scale
    cache.el = el
    cache.key = key
  }
  const scale = cache.scale
  // the loop gives a box and a few points inside it
  const xs = lasso.map((p) => p[0])
  const ys = lasso.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const pos = []
  const cxm = (x0 + x1) / 2
  const cym = (y0 + y1) / 2
  const grid = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.5, 0.15], [0.5, 0.85]]
  for (const [a, b] of grid) {
    const p = [x0 + (x1 - x0) * a, y0 + (y1 - y0) * b]
    if (inside(p, lasso)) pos.push(p)
  }
  if (!pos.length) pos.push([cxm, cym])
  const pts = [[x0, y0], [x1, y1], ...pos.slice(0, 5)]
  const labels = [2, 3, ...pos.slice(0, 5).map(() => 1)]
  const coords = new Float32Array(pts.length * 2)
  pts.forEach((p, i) => {
    coords[i * 2] = p[0] * w * scale
    coords[i * 2 + 1] = p[1] * h * scale
  })
  const res = await decoder.run({
    image_embeddings: cache.embeddings,
    point_coords: new ort.Tensor('float32', coords, [1, pts.length, 2]),
    point_labels: new ort.Tensor('float32', Float32Array.from(labels), [1, labels.length]),
    mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
    orig_im_size: new ort.Tensor('float32', new Float32Array([h, w]), [2]),
  })
  const m = res.masks.data // logits, h x w
  // a small grid of the mask (the longest side about 320 cells) is enough for an outline
  const gs = 320 / Math.max(w, h)
  const gw = Math.max(8, Math.round(w * gs))
  const gh = Math.max(8, Math.round(h * gs))
  const g = new Uint8Array(gw * gh)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) / gw) * w))
      const sy = Math.min(h - 1, Math.floor(((y + 0.5) / gh) * h))
      g[y * gw + x] = m[sy * w + sx] > 0 ? 1 : 0
    }
  }
  const trace = outline(g, gw, gh)
  if (trace.length < 6) return null
  // the cell centres, as 0..1 picture coordinates, then fewer points
  let norm = trace.map(([x, y]) => [(x + 0.5) / gw, (y + 0.5) / gh])
  let tol = 0.002
  let simp = simplify(norm, tol)
  while (simp.length > MAX_POLY && tol < 0.1) {
    tol *= 1.3
    simp = simplify(norm, tol)
  }
  return simp.slice(0, MAX_POLY)
}
