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
    decoder: await mk(paths.maskDecoder),
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
  async track(el, w, h, index, totalFrames) {
    if (!this.cond) throw new Error('seed first')
    const v = await this.encode(el, w, h)
    const feats = toTokens(await v.feats2.getData())
    // the memory: the first frame, then the newest frames first (missing slots repeat the newest), then the pointers
    const newest = [...this.recent].reverse()
    const memory = new Float32Array(R * MEM)
    const memoryPos = new Float32Array(R * MEM)
    const blocks = [{ e: this.cond, pos: this.slotPos[FRAMES - 1] }]
    for (let slot = 1; slot < FRAMES; slot++) {
      const e = newest[slot - 1]
      blocks.push(e ? { e, pos: this.slotPos[slot - 1] } : blocks[1] || blocks[0])
    }
    blocks.forEach((b, slot) => {
      memory.set(b.e.tokens, slot * FT * MEM)
      memoryPos.set(b.pos, slot * FT * MEM)
    })
    const ptrs = [this.cond, ...newest].slice(0, MAXP)
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
    if (mask.score > 0 && mask.iou >= RELIABLE_IOU) await this.remember(v, dec, index, false)
    if (mask.iou < PLAUSIBLE_IOU) mask.logits.fill(-GIVEN_LOGIT)
    return mask
  }
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
