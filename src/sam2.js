// SAM 2.1 video tracking (Meta's open "Segment Anything 2" model), run on the graphics card with onnxruntime-web (WebGPU).
// The model is exported as five ONNX graphs (vision encoder, mask decoder, memory encoder, memory attention, pointer
// positions). How they connect follows Meta's SAM 2 video predictor and the open reference runtime in
// diffusionstudio/editor (packages/sam2, MPL-2.0); this file is our own implementation of that loop.
//
// Use: const sam = await loadSam2(paths)
//      const first = await sam.seed(frameEl, w, h, points, givenLogits)   // the object on the first frame
//      const next = await sam.track(frameEl, w, h, index, totalFrames)    // each following frame, in order
// Every result is { logits (256x256, object where > 0), score (<= 0: the object is not in the picture), iou }.
import { toUrl } from './state.js'

const SIZE = 1024 // input resolution of the exported graphs
const F = SIZE / 16 // 64: the feature grid
const FT = F * F
const HIDDEN = 256
const MEM = 64
const FRAMES = 7 // memory slots: the first frame + the 6 newest
const MAXP = 16 // object pointers
const PTOK = HIDDEN / MEM
const MASK = 256 // the decoder's own mask grid
const R = FRAMES * FT + MAXP * PTOK // rows of the memory input

// a tracked frame enters memory only when the model sees the object and trusts its mask
const RELIABLE_IOU = 0.25
const PLAUSIBLE_IOU = 0.15
export const GIVEN_LOGIT = 10

let ortP = null
async function getOrt() {
  if (!ortP) {
    ortP = import('onnxruntime-web/webgpu').then((ort) => {
      ort.env.wasm.wasmPaths = new URL('./ort/', document.baseURI).href
      return ort
    })
  }
  return ortP
}

export async function loadSam2(paths) {
  // SAM 2 needs a graphics card (WebGPU): on the processor it does not get through loading in a reasonable time
  if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) throw new Error('No graphics card')
  const ort = await getOrt()
  const eps = ['webgpu']
  const get = async (p) => (await fetch(toUrl(p))).arrayBuffer()
  const mk = async (p) => ort.InferenceSession.create(await get(p), { executionProviders: eps })
  const constants = await (await fetch(toUrl(paths.constants))).json()
  const sessions = {
    vision: await mk(paths.visionEncoder),
    // the decoder file is changed a little as it loads so that it also hands over its 3 other candidate masks (DAM4SAM)
    decoder: await ort.InferenceSession.create(exposeCandidates(await get(paths.maskDecoder)), { executionProviders: eps }),
    memEnc: await mk(paths.memoryEncoder),
    memAtt: await mk(paths.memoryAttention),
    ptpos: await mk(paths.pointerTpos),
  }
  return new Sam2(ort, sessions, constants)
}

class Sam2 {
  constructor(ort, s, constants) {
    this.ort = ort
    this.s = s
    this.mean = constants.image_mean
    this.std = constants.image_std
    this.temporal = constants.memory_temporal_positional_encoding // 7 rows of 64
    this.cv = document.createElement('canvas')
    this.cv.width = SIZE
    this.cv.height = SIZE
    this.g = this.cv.getContext('2d', { willReadFrequently: true })
    this.posTokens = null
    this.spatial = null // the memory encoder's position encoding (the same for every frame)
    this.slotPos = null // spatial + temporal row, per slot
    this.reset()
  }

  reset() {
    this.cond = null // { index, tokens, pointer }: the first frame
    this.recent = [] // oldest first
    this.drm = [] // frames kept for good because a lookalike was close (DAM4SAM's distractor-resolving memory)
    this.sizes = [] // how many cells the object covered, frame by frame
    this.lastAdded = -1 // the frame most recently added to drm
  }

  T(type, data, dims) {
    return new this.ort.Tensor(type, data, dims)
  }

  // the picture, stretched to the model's square input (the grid then maps to the whole picture) and normalised
  async encode(el, w, h) {
    this.g.imageSmoothingEnabled = true
    this.g.imageSmoothingQuality = 'high'
    this.g.drawImage(el, 0, 0, w, h, 0, 0, SIZE, SIZE)
    const px = this.g.getImageData(0, 0, SIZE, SIZE).data
    const n = SIZE * SIZE
    const data = new Float32Array(3 * n)
    const [mr, mg, mb] = this.mean
    const [sr, sg, sb] = this.std
    for (let i = 0; i < n; i++) {
      data[i] = (px[i * 4] / 255 - mr) / sr
      data[n + i] = (px[i * 4 + 1] / 255 - mg) / sg
      data[2 * n + i] = (px[i * 4 + 2] / 255 - mb) / sb
    }
    const out = await this.s.vision.run({ pixel_values: this.T('float32', data, [1, 3, SIZE, SIZE]) })
    if (!this.posTokens && out.vision_pos_embed) this.posTokens = toTokens(await out.vision_pos_embed.getData())
    return out
  }

  async decode(v, cond, points, labels) {
    const n = labels.length
    return this.s.decoder.run({
      feats0: v.feats0,
      feats1: v.feats1,
      feats2_cond: cond,
      input_points: this.T('float32', Float32Array.from(points), [1, 1, n, 2]),
      input_labels: this.T('int32', Int32Array.from(labels), [1, 1, n]),
    })
  }

  async unpack(dec) {
    const logits = Float32Array.from(await dec.low_res_mask.getData())
    const score = (await dec.object_score_logits.getData())[0]
    const iou = (await dec.iou.getData())[0]
    return { logits, score, iou }
  }

  // writes the picture into memory (as the first frame, or as the next tracked one)
  async remember(v, dec, index, prompted, given) {
    const mem = await this.s.memEnc.run({
      feats2: v.feats2,
      high_res_mask: given ? this.T('float32', givenHighRes(given), [1, 1, SIZE, SIZE]) : dec.high_res_mask,
      object_score_logits: this.T('float32', given ? Float32Array.of(GIVEN_LOGIT) : Float32Array.from(await dec.object_score_logits.getData()), [1, 1]),
      binarize: this.T('float32', Float32Array.of(prompted ? 1 : 0), []),
    })
    if (!this.slotPos) {
      this.spatial = Float32Array.from(await mem.memory_pos.getData())
      this.slotPos = this.temporal.map((row) => {
        const d = new Float32Array(this.spatial.length)
        for (let i = 0; i < d.length; i++) d[i] = this.spatial[i] + row[i % MEM]
        return d
      })
    }
    const entry = { index, tokens: Float32Array.from(await mem.memory_tokens.getData()), pointer: Float32Array.from(await dec.object_pointer.getData()) }
    if (prompted) {
      this.cond = entry
      this.recent = []
    } else {
      this.recent.push(entry)
      while (this.recent.length > MAXP - 1) this.recent.shift()
    }
    return entry
  }

  // The first frame: the object marked by `points` ([{x, y, label}] in 0..1, label 1 = object, 0 = not, 2 / 3 = top-left /
  // bottom-right of a box). `given` (optional, 256x256 logits) is the exact mask the user has: it is what the frame is
  // remembered as, so everything after follows that outline.
  async seed(el, w, h, points, given) {
    this.reset()
    const v = await this.encode(el, w, h)
    const pts = points.flatMap((p) => [p.x * SIZE, p.y * SIZE])
    const dec = await this.decode(v, v.feats2_no_mem, pts, points.map((p) => p.label))
    const mask = await this.unpack(dec)
    await this.remember(v, dec, 0, true, given)
    return given ? { logits: given, score: GIVEN_LOGIT, iou: 1 } : mask
  }

  // Finds the object in the next picture. `index` counts the pictures from the first (1, 2, 3 ...).
  // Memory follows DAM4SAM (Videnovic et al., Apache-2.0): the first frame plus frames saved because a lookalike was
  // near ("distractor-resolving memory", up to 4), then the most recent frames in which the object was visible.
  async track(el, w, h, index, totalFrames) {
    if (!this.cond) throw new Error('seed first')
    const v = await this.encode(el, w, h)
    const feats = toTokens(await v.feats2.getData())
    const dam = !window.__damOff
    // which frames the long-term part of the memory uses for this frame
    let fixed = [this.cond]
    if (dam && this.drm.length) {
      const all = [this.cond, ...this.drm]
      const sel = []
      const before = all.filter((e) => e.index < index - 1).sort((a, b) => b.index - a.index)[0]
      if (before) sel.push(before)
      if (!sel.includes(this.cond)) sel.push(this.cond)
      const rest = all.filter((e) => !sel.includes(e) && e.index !== index - 1).sort((a, b) => Math.abs(a.index - index) - Math.abs(b.index - index))
      sel.push(...rest.slice(0, Math.max(0, 4 - sel.length)))
      fixed = sel.sort((a, b) => a.index - b.index)
    }
    // the recent frames (newest first), not counting the ones already used above
    const newest = [...this.recent].reverse().filter((e) => !fixed.includes(e))
    const memory = new Float32Array(R * MEM)
    const memoryPos = new Float32Array(R * MEM)
    // blocks: the long-term frames (the last temporal row), then the recent ones with rows 0, 1, 2 ... (missing ones repeat the newest)
    const blocks = fixed.map((e) => ({ e, pos: this.slotPos[FRAMES - 1] }))
    const nRecent = FRAMES - blocks.length
    for (let k = 0; k < nRecent; k++) {
      const e = newest[k]
      const fallback = blocks[fixed.length] || blocks[fixed.length - 1]
      blocks.push(e ? { e, pos: this.slotPos[k] } : fallback)
    }
    blocks.slice(0, FRAMES).forEach((b, slot) => {
      memory.set(b.e.tokens, slot * FT * MEM)
      memoryPos.set(b.pos, slot * FT * MEM)
    })
    // object pointers: the long-term frames, then the recent frames, 16 at most
    const ptrs = [...fixed, ...newest.filter((e) => index - e.index < MAXP)].slice(0, MAXP)
    while (ptrs.length < MAXP) ptrs.push(ptrs[ptrs.length - 1])
    ptrs.forEach((e, i) => memory.set(e.pointer, FRAMES * FT * MEM + i * HIDDEN))
    const span = Math.max(1, Math.min(totalFrames, MAXP) - 1)
    const tp = await this.s.ptpos.run({ normalized_diffs: this.T('float32', Float32Array.from(ptrs.map((e) => Math.abs(index - e.index) / span)), [MAXP]) })
    const pp = await tp.pointer_pos.getData() // [16, 64]
    ptrs.forEach((_, i) => {
      for (let t = 0; t < PTOK; t++) memoryPos.set(pp.subarray(i * MEM, (i + 1) * MEM), FRAMES * FT * MEM + (i * PTOK + t) * MEM)
    })
    const att = await this.s.memAtt.run({
      current_vision_features: this.T('float32', feats, [FT, 1, HIDDEN]),
      current_vision_position_embeddings: this.T('float32', this.posTokens, [FT, 1, HIDDEN]),
      memory: this.T('float32', memory, [R, 1, MEM]),
      memory_pos: this.T('float32', memoryPos, [R, 1, MEM]),
    })
    const dec = await this.decode(v, att.conditioned_feats, [0, 0], [-1])
    const mask = await this.unpack(dec)
    let entry = null
    if (mask.score > 0 && mask.iou >= RELIABLE_IOU) entry = await this.remember(v, dec, index, false)
    if (dam) await this.watchForDistractors(dec, mask, index, entry)
    if (mask.iou < PLAUSIBLE_IOU) mask.logits.fill(-GIVEN_LOGIT)
    return mask
  }

  // DAM4SAM's distractor check: when the model is sure of its mask and the object's size is steady, look at the other
  // candidate masks. If one of them reaches somewhere else (its box differs from the chosen mask's box), something similar
  // is nearby, and this frame is kept for good so later frames can tell the object from it.
  async watchForDistractors(dec, mask, index, entry) {
    let n = 0
    for (let i = 0; i < mask.logits.length; i++) if (mask.logits[i] > 0) n++
    this.sizes.push(n)
    if (!entry || n < 1) return
    const sizes = this.sizes.slice(-300).filter((x) => x >= 1).slice(-10)
    const med = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)]
    const ratio = this.sizes.length > 1 && med ? n / med : -1
    if (!(mask.iou > 0.8 && ratio >= 0.8 && ratio <= 1.2 && (this.lastAdded < 0 || index - this.lastAdded > 5))) return
    const cand = await dec.alt_masks.getData() // [4, 256, 256]: the single-mask output, then the 3 candidates
    const N = MASK * MASK
    // which candidate is the chosen one
    let chosen = 1
    let best = Infinity
    for (let j = 1; j < 4; j++) {
      let d = 0
      for (let i = 0; i < N; i += 7) d += Math.abs(cand[j * N + i] - mask.logits[i])
      if (d < best) {
        best = d
        chosen = j
      }
    }
    const inMask = new Uint8Array(N)
    for (let i = 0; i < N; i++) inMask[i] = mask.logits[i] > 0 ? 1 : 0
    const box = boxOf(inMask)
    let min = 1
    let any = false
    for (let j = 1; j < 4; j++) {
      if (j === chosen) continue
      const other = new Uint8Array(N)
      let cnt = 0
      for (let i = 0; i < N; i++) {
        if (cand[j * N + i] > 0 && !inMask[i]) {
          other[i] = 1
          cnt++
        }
      }
      if (cnt < 1) continue
      const part = largestPart(other) // the biggest blob outside the chosen mask
      for (let i = 0; i < N; i++) if (inMask[i]) part[i] = 1
      any = true
      min = Math.min(min, boxIou(box, boxOf(part)))
    }
    if (any && min <= 0.7) {
      this.drm.push(entry)
      this.lastAdded = index
    }
  }
}

// ---- helpers for the distractor check (256 x 256 masks) ----
function boxOf(m) {
  let x0 = MASK
  let y0 = MASK
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < MASK; y++) {
    for (let x = 0; x < MASK; x++) {
      if (!m[y * MASK + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return [x0, y0, x1, y1]
}
function boxIou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1)
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1)
  const inter = ix * iy
  const area = (r) => Math.max(0, r[2] - r[0] + 1) * Math.max(0, r[3] - r[1] + 1)
  const u = area(a) + area(b) - inter
  return u > 0 ? inter / u : 0
}
// only the biggest connected blob of a mask
function largestPart(m) {
  const lab = new Int32Array(MASK * MASK)
  let best = 0
  let bestSize = 0
  let next = 1
  const stack = []
  const push = (j) => {
    lab[j] = next
    stack.push(j)
  }
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue
    let size = 0
    push(s)
    while (stack.length) {
      const i = stack.pop()
      size++
      const x = i % MASK
      const y = (i / MASK) | 0
      if (x > 0 && m[i - 1] && !lab[i - 1]) push(i - 1)
      if (x < MASK - 1 && m[i + 1] && !lab[i + 1]) push(i + 1)
      if (y > 0 && m[i - MASK] && !lab[i - MASK]) push(i - MASK)
      if (y < MASK - 1 && m[i + MASK] && !lab[i + MASK]) push(i + MASK)
    }
    if (size > bestSize) {
      bestSize = size
      best = next
    }
    next++
  }
  const out = new Uint8Array(MASK * MASK)
  for (let i = 0; i < out.length; i++) if (lab[i] === best) out[i] = 1
  return out
}

// ---- a small change to the decoder model file, made as it loads ----
// The decoder works out 3 candidate masks and keeps the best. This adds two outputs ("alt_masks": all 4 masks, "alt_ious":
// their 4 quality estimates) by editing the ONNX file's bytes: two Cast nodes and two outputs are appended to its graph.
function exposeCandidates(buf) {
  const bytes = new Uint8Array(buf)
  const enc = new TextEncoder()
  const varint = (n) => {
    const o = []
    while (n >= 128) {
      o.push((n % 128) | 128)
      n = Math.floor(n / 128)
    }
    o.push(n)
    return o
  }
  const str = (f, s) => {
    const b = enc.encode(s)
    return [...varint((f << 3) | 2), ...varint(b.length), ...b]
  }
  const int = (f, v) => [...varint(f << 3), ...varint(v)] // (field 20, the type, needs a two-byte tag)
  const msg = (f, b) => [...varint((f << 3) | 2), ...varint(b.length), ...b]
  const cast = (input, output) => msg(1, [...str(1, input), ...str(2, output), ...str(3, 'alt_cast_' + output), ...str(4, 'Cast'), ...msg(5, [...str(1, 'to'), ...int(3, 1), ...int(20, 2)])])
  const out = (name) => msg(12, [...str(1, name), ...msg(2, msg(1, int(1, 1)))])
  const added = Uint8Array.from([...cast('/Gather_9_output_0', 'alt_masks'), ...cast('/Gather_7_output_0', 'alt_ious'), ...out('alt_masks'), ...out('alt_ious')])
  // find the graph (field 7) in the model's top level
  let p = 0
  const readVar = () => {
    let r = 0
    let mul = 1
    for (;;) {
      const b = bytes[p++]
      r += (b & 127) * mul
      if (b < 128) return r
      mul *= 128
    }
  }
  while (p < bytes.length) {
    const start = p
    const tag = readVar()
    const wt = tag & 7
    if (wt === 0) readVar()
    else if (wt === 1) p += 8
    else if (wt === 5) p += 4
    else if (wt === 2) {
      const len = readVar()
      const bodyStart = p
      p += len
      if (tag >> 3 === 7) {
        const head = bytes.subarray(0, start)
        const body = bytes.subarray(bodyStart, bodyStart + len)
        const tail = bytes.subarray(p)
        const newTag = Uint8Array.from([(7 << 3) | 2, ...varint(len + added.length)])
        const res = new Uint8Array(head.length + newTag.length + body.length + added.length + tail.length)
        let o = 0
        for (const part of [head, newTag, body, added, tail]) {
          res.set(part, o)
          o += part.length
        }
        return res
      }
    } else throw new Error('Unknown model file layout')
  }
  throw new Error('The decoder model has no graph')
}

// [1, C, H, W] channels -> the [H*W, 1, C] tokens memory attention reads
function toTokens(ch) {
  const out = new Float32Array(ch.length)
  for (let c = 0; c < HIDDEN; c++) for (let n = 0; n < FT; n++) out[n * HIDDEN + c] = ch[c * FT + n]
  return out
}

// 256x256 logits -> the 1024x1024 logits the memory encoder takes (bilinear, cell centres aligned)
function givenHighRes(m) {
  const s = MASK / SIZE
  const lo = new Int32Array(SIZE)
  const hi = new Int32Array(SIZE)
  const wt = new Float32Array(SIZE)
  for (let o = 0; o < SIZE; o++) {
    const src = Math.max(0, (o + 0.5) * s - 0.5)
    lo[o] = Math.floor(src)
    hi[o] = Math.min(lo[o] + 1, MASK - 1)
    wt[o] = src - lo[o]
  }
  const out = new Float32Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const top = m[lo[y] * MASK + lo[x]] * (1 - wt[x]) + m[lo[y] * MASK + hi[x]] * wt[x]
      const bot = m[hi[y] * MASK + lo[x]] * (1 - wt[x]) + m[hi[y] * MASK + hi[x]] * wt[x]
      out[y * SIZE + x] = top * (1 - wt[y]) + bot * wt[y]
    }
  }
  return out
}

// a polygon (0..1 picture coordinates) as 256x256 logits: inside +GIVEN_LOGIT, outside -GIVEN_LOGIT
export function polygonLogits(poly) {
  const cv = document.createElement('canvas')
  cv.width = MASK
  cv.height = MASK
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.fillStyle = '#fff'
  g.beginPath()
  poly.forEach((p, i) => (i ? g.lineTo(p[0] * MASK, p[1] * MASK) : g.moveTo(p[0] * MASK, p[1] * MASK)))
  g.closePath()
  g.fill()
  const px = g.getImageData(0, 0, MASK, MASK).data
  const out = new Float32Array(MASK * MASK)
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3] > 127 ? GIVEN_LOGIT : -GIVEN_LOGIT
  return out
}
