import { shaderTransform } from './motion.js'
import { MAX_POLY } from './masks.js'

// WebGL renderer. Draws one frame, or two frames blended by a gl-transitions shader.
//
// Transition files use the gl-transitions format: they define
//   vec4 transition(vec2 uv)
// and may use getFromColor(uv), getToColor(uv), progress and ratio. Extra uniforms with a
// default in a trailing comment, e.g.  `uniform float size; // = 12.0`  are supported.
const VERT = `
attribute vec2 pos;
varying vec2 _uv;
void main() {
  _uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`

const PREFIX = `
precision highp float;
varying vec2 _uv;
uniform sampler2D from;
uniform sampler2D to;
uniform float progress;
uniform float ratio;
uniform vec2 sA;
uniform vec2 sB;
// Clip motion for each source: tf = (offsetX, offsetY, scale, rotation in radians), p = (opacity, motion active)
uniform vec4 tfA;
uniform vec4 tfB;
uniform vec2 pA;
uniform vec2 pB;
// Stretch (non-uniform scale) for each source
uniform vec2 stA;
uniform vec2 stB;
// Warp (corner pin): hA/hB map a point of the frame-space picture back to the source picture; wA/wB = warp active
uniform mat3 hA;
uniform mat3 hB;
uniform float wA;
uniform float wB;
// Sources are letterboxed ("contain"). Where a source fills the frame, edges are clamped.
// Per-source picture effects: f = (blur, sharpen, vignette, glow), c1 = (brightness, contrast, saturation,
// temperature), c2 = (tint, exposure, highlights, shadows), k = (similarity, smoothness, spill, key on), kc = key colour
uniform vec4 fA; uniform vec4 fB;
uniform vec4 c1A; uniform vec4 c1B;
uniform vec4 c2A; uniform vec4 c2B;
uniform vec4 kA; uniform vec4 kB;
uniform vec3 kcA; uniform vec3 kcB;
uniform vec2 szA; uniform vec2 szB;
struct Fx { vec4 f; vec4 c1; vec4 c2; vec4 k; vec3 kc; vec2 sz; };
vec2 cbcr(vec3 c) { return vec2(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b, 0.5 * c.r - 0.419 * c.g - 0.081 * c.b); }
// sample the picture at q and apply the effects: chroma key, blur / sharpen, glow, colour correction, vignette
vec4 shade(sampler2D t, vec2 q, Fx x) {
  vec2 px = 1.0 / x.sz;
  vec4 col = texture2D(t, q);
  if (x.k.w > 0.5) {
    float dist = length(cbcr(col.rgb) - cbcr(x.kc));
    float a = smoothstep(x.k.x, x.k.x + max(x.k.y, 0.001), dist);
    col.a *= a;
    col.rgb = mix(col.rgb, vec3(dot(col.rgb, vec3(0.299, 0.587, 0.114))), x.k.z * (1.0 - a));
  }
  float blurR = x.f.x * 24.0;
  float sharp = x.f.y * 2.0;
  if (blurR > 0.01 || sharp > 0.001) {
    float rad = blurR > 0.01 ? blurR : 1.5;
    vec3 acc = col.rgb;
    for (int i = 0; i < 8; i++) {
      float ang = 0.785398 * float(i);
      vec2 d = vec2(cos(ang), sin(ang)) * px;
      acc += texture2D(t, clamp(q + d * rad * 0.5, 0.0, 1.0)).rgb + texture2D(t, clamp(q + d * rad, 0.0, 1.0)).rgb;
    }
    vec3 blurred = acc / 17.0;
    col.rgb = blurR > 0.01 ? blurred : col.rgb + (col.rgb - blurred) * sharp;
  }
  if (x.f.w > 0.001) {
    float gr = x.f.w * 36.0;
    vec3 acc = col.rgb;
    for (int i = 0; i < 8; i++) {
      float ang = 0.785398 * float(i);
      vec2 d = vec2(cos(ang), sin(ang)) * px;
      acc += texture2D(t, clamp(q + d * gr * 0.5, 0.0, 1.0)).rgb + texture2D(t, clamp(q + d * gr, 0.0, 1.0)).rgb;
    }
    col.rgb += max(acc / 17.0 - 0.5, 0.0) * 2.4 * x.f.w;
  }
  vec3 c = col.rgb;
  c *= pow(2.0, x.c2.y * 2.0);
  c += x.c1.x;
  c = (c - 0.5) * x.c1.y + 0.5;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, x.c1.z);
  c.r += x.c1.w * 0.12;
  c.b -= x.c1.w * 0.12;
  c.g -= x.c2.x * 0.12;
  c.r += x.c2.x * 0.06;
  c.b += x.c2.x * 0.06;
  c += x.c2.z * smoothstep(0.5, 1.0, lum) * 0.3;
  c += x.c2.w * (1.0 - smoothstep(0.0, 0.5, lum)) * 0.3;
  col.rgb = clamp(c, 0.0, 1.0);
  if (x.f.z > 0.001) {
    vec2 cq = (q - 0.5) * 2.0;
    col.rgb *= 1.0 - x.f.z * smoothstep(0.35, 1.5, dot(cq, cq));
  }
  return col;
}
// Masks: k = (shape 0 none / 1 rect / 2 ellipse / 3 shape, feather, invert, expand), b = (centre x, y, half width, half height),
// r = (cos, sin) of the rotation, mp = the points of a drawn shape (the first point is repeated at the end), n = how many
uniform vec4 mkA; uniform vec4 mkB;
uniform vec4 mbA; uniform vec4 mbB;
uniform vec2 mrA; uniform vec2 mrB;
uniform float mnA; uniform float mnB;
uniform sampler2D mpA; uniform sampler2D mpB; // the points of a drawn shape, one per texel (x, y)
uniform vec4 mbbA; uniform vec4 mbbB; // the box around a drawn shape, with room for its soft edge
struct Mk { vec4 k; vec4 b; vec2 r; float n; vec4 bb; };
float maskAlpha(vec2 q, Mk m, sampler2D mp) {
  if (m.k.x < 0.5) return 1.0;
  float feather = max(m.k.y, 0.0015);
  float sd;
  vec2 p = q - m.b.xy;
  vec2 lp = vec2(m.r.x * p.x - m.r.y * p.y, m.r.y * p.x + m.r.x * p.y);
  if (m.k.x < 1.5) {
    vec2 d = abs(lp) - m.b.zw;
    sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  } else if (m.k.x < 2.5) {
    vec2 e = lp / max(m.b.zw, vec2(0.0001));
    sd = (length(e) - 1.0) * min(m.b.z, m.b.w);
  } else {
    float inside = 0.0;
    float dmin = 1000.0;
    // far from the shape: no need to look at its edges
    if (q.x < m.bb.x || q.x > m.bb.z || q.y < m.bb.y || q.y > m.bb.w) dmin = 1.0;
    else for (int i = 0; i < ${MAX_POLY}; i++) {
      if (float(i) >= m.n) break;
      vec2 a = texture2D(mp, vec2((float(i) + 0.5) / ${MAX_POLY + 1}.0, 0.5)).xy;
      vec2 b = texture2D(mp, vec2((float(i) + 1.5) / ${MAX_POLY + 1}.0, 0.5)).xy;
      if (((a.y > q.y) != (b.y > q.y)) && (q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x)) inside = 1.0 - inside;
      vec2 pa = q - a;
      vec2 ba = b - a;
      float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 0.000001), 0.0, 1.0);
      dmin = min(dmin, length(pa - ba * hh));
    }
    sd = inside > 0.5 ? -dmin : dmin;
  }
  sd -= m.k.w;
  float al = 1.0 - smoothstep(-feather, feather, sd);
  return m.k.z > 0.5 ? 1.0 - al : al;
}
// Result is premultiplied: transparent outside the picture, so layers can be stacked.
vec4 sampleSrc(sampler2D t, vec2 s, vec4 tf, vec2 p, vec2 st, Fx fx, Mk mk, sampler2D mp, mat3 h, float w, vec2 uv) {
  vec2 c = uv - 0.5;
  if (p.y > 0.5) {
    // inverse of: scale, rotate (clockwise), then move
    c.x *= ratio;
    c -= vec2(tf.x * ratio, tf.y);
    float cs = cos(tf.w);
    float sn = sin(tf.w);
    c = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) / (tf.z * st);
    c.x /= ratio;
  }
  vec2 q = c * s + 0.5;
  if (w > 0.5) {
    vec3 hv = h * vec3(q, 1.0);
    if (hv.z < 0.0001) return vec4(0.0);
    q = hv.xy / hv.z;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
    vec4 tx = shade(t, q, fx);
    tx.a *= maskAlpha(q, mk, mp);
    return vec4(tx.rgb * tx.a * p.x, tx.a * p.x);
  }
  if (p.y > 0.5) {
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
  } else {
    if (s.x > 1.0001 && (q.x < 0.0 || q.x > 1.0)) return vec4(0.0);
    if (s.y > 1.0001 && (q.y < 0.0 || q.y > 1.0)) return vec4(0.0);
  }
  vec4 tx = shade(t, clamp(q, 0.0, 1.0), fx);
  tx.a *= maskAlpha(q, mk, mp);
  return vec4(tx.rgb * tx.a * p.x, tx.a * p.x);
}
vec4 getFromColor(vec2 uv) { return sampleSrc(from, sA, tfA, pA, stA, Fx(fA, c1A, c2A, kA, kcA, szA), Mk(mkA, mbA, mrA, mnA, mbbA), mpA, hA, wA, uv); }
vec4 getToColor(vec2 uv) { return sampleSrc(to, sB, tfB, pB, stB, Fx(fB, c1B, c2B, kB, kcB, szB), Mk(mkB, mbB, mrB, mnB, mbbB), mpB, hB, wB, uv); }
`
const SINGLE = `vec4 transition(vec2 uv) { return getFromColor(uv); }`
const FADE = `vec4 transition(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress); }`

function parseUniforms(src) {
  const out = []
  const re = /uniform\s+(\w+)\s+(\w+)\s*;\s*\/\/\s*=\s*(.+)$/gm
  let m
  while ((m = re.exec(src))) {
    const text = m[3].replace(/^\s*[a-zA-Z_]\w*\s*\(/, '') // drop a constructor name like "vec2("
    const nums = (text.match(/-?\d*\.?\d+(?:e-?\d+)?|true|false/g) || []).map((x) => (x === 'true' ? 1 : x === 'false' ? 0 : parseFloat(x)))
    out.push({ type: m[1], name: m[2], value: nums })
  }
  return out
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true })
  if (!gl) throw new Error('WebGL not available')

  const vs = gl.createShader(gl.VERTEX_SHADER)
  gl.shaderSource(vs, VERT)
  gl.compileShader(vs)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  function makeTex(unit) {
    const t = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return t
  }
  const texA = makeTex(0)
  const texB = makeTex(1)
  if (!gl.getExtension('OES_texture_float')) throw new Error('This graphics card cannot draw masks (no float textures)')
  const makePolyTex = (unit) => {
    const t = makeTex(unit)
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return t
  }
  const polyA = makePolyTex(2)
  const polyB = makePolyTex(3)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

  // Returns {prog, loc, extras} or throws an Error with the compiler log.
  function build(transitionSrc) {
    const fs = gl.createShader(gl.FRAGMENT_SHADER)
    gl.shaderSource(fs, PREFIX + '\n' + transitionSrc + '\nvoid main() { gl_FragColor = transition(_uv); }')
    gl.compileShader(fs)
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs)
      gl.deleteShader(fs)
      throw new Error(log)
    }
    const prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.bindAttribLocation(prog, 0, 'pos')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    const u = (n) => gl.getUniformLocation(prog, n)
    const extras = parseUniforms(transitionSrc).map((e) => ({ ...e, loc: u(e.name) }))
    return {
      prog,
      extras,
      loc: { from: u('from'), to: u('to'), progress: u('progress'), ratio: u('ratio'), sA: u('sA'), sB: u('sB'), tfA: u('tfA'), tfB: u('tfB'), pA: u('pA'), pB: u('pB'), stA: u('stA'), stB: u('stB'), hA: u('hA'), hB: u('hB'), wA: u('wA'), wB: u('wB'), fA: u('fA'), fB: u('fB'), c1A: u('c1A'), c1B: u('c1B'), c2A: u('c2A'), c2B: u('c2B'), kA: u('kA'), kB: u('kB'), kcA: u('kcA'), kcB: u('kcB'), szA: u('szA'), szB: u('szB'), mkA: u('mkA'), mkB: u('mkB'), mbA: u('mbA'), mbB: u('mbB'), mrA: u('mrA'), mrB: u('mrB'), mnA: u('mnA'), mnB: u('mnB'), mpA: u('mpA'), mpB: u('mpB'), mbbA: u('mbbA'), mbbB: u('mbbB') },
    }
  }

  const single = build(SINGLE)
  const fade = build(FADE)
  const lib = new Map()

  // Compile a transition. Returns null on success or an error message.
  function addTransition(name, source) {
    try {
      lib.set(name, build(source))
      return null
    } catch (e) {
      lib.delete(name)
      return String(e.message || e)
    }
  }

  function use(p, progress, sA, sB, tA, tB, dA, dB) {
    gl.useProgram(p.prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1i(p.loc.from, 0)
    gl.uniform1i(p.loc.to, 1)
    gl.uniform1f(p.loc.progress, progress)
    gl.uniform1f(p.loc.ratio, canvas.width / canvas.height)
    gl.uniform2f(p.loc.sA, sA[0], sA[1])
    gl.uniform2f(p.loc.sB, sB[0], sB[1])
    gl.uniform4f(p.loc.tfA, ...tA.v)
    gl.uniform4f(p.loc.tfB, ...tB.v)
    gl.uniform2f(p.loc.pA, ...tA.p)
    gl.uniform2f(p.loc.pB, ...tB.p)
    gl.uniform2f(p.loc.stA, ...tA.st)
    gl.uniform2f(p.loc.stB, ...tB.st)
    gl.uniformMatrix3fv(p.loc.hA, false, tA.h)
    gl.uniformMatrix3fv(p.loc.hB, false, tB.h)
    gl.uniform1f(p.loc.wA, tA.w)
    gl.uniform1f(p.loc.wB, tB.w)
    for (const [side, tt, dd] of [['A', tA, dA], ['B', tB, dB]]) {
      gl.uniform4f(p.loc['f' + side], ...tt.fu.f)
      gl.uniform4f(p.loc['c1' + side], ...tt.fu.c1)
      gl.uniform4f(p.loc['c2' + side], ...tt.fu.c2)
      gl.uniform4f(p.loc['k' + side], ...tt.fu.k)
      gl.uniform3f(p.loc['kc' + side], ...tt.fu.kc)
      gl.uniform2f(p.loc['sz' + side], Math.max(1, dd[0]), Math.max(1, dd[1]))
      gl.uniform4f(p.loc['mk' + side], ...tt.mu.mk)
      gl.uniform4f(p.loc['mb' + side], ...tt.mu.mb)
      gl.uniform2f(p.loc['mr' + side], ...tt.mu.mr)
      gl.uniform1f(p.loc['mn' + side], tt.mu.n)
      gl.uniform4f(p.loc['mbb' + side], ...tt.mu.bb)
      // the points go to a small float texture of their own (unit 2 for A, 3 for B)
      const unit = side === 'A' ? 2 : 3
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, side === 'A' ? polyA : polyB)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MAX_POLY + 1, 1, 0, gl.RGBA, gl.FLOAT, tt.mu.pts)
      gl.uniform1i(p.loc['mp' + side], unit)
    }
    for (const e of p.extras) {
      const v = e.value
      if (e.loc == null || !v.length) continue
      const isInt = e.type === 'int' || e.type === 'bool' || e.type.startsWith('ivec') || e.type.startsWith('bvec')
      const fn = { 1: isInt ? 'uniform1i' : 'uniform1f', 2: isInt ? 'uniform2i' : 'uniform2f', 3: isInt ? 'uniform3i' : 'uniform3f', 4: isInt ? 'uniform4i' : 'uniform4f' }[v.length]
      if (fn) gl[fn](e.loc, ...v)
    }
  }

  function scaleFor(w, h) {
    const ca = canvas.width / canvas.height
    const ma = w / h
    return [Math.max(1, ca / ma), Math.max(1, ma / ca)]
  }

  function upload(unit, tex, src) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
  }

  // bg = [r, g, b, a] (0..1, premultiplied): the image editor's background; a video's is black
  function clear(bg) {
    gl.viewport(0, 0, canvas.width, canvas.height)
    const c = bg || [0, 0, 0, 1]
    gl.clearColor(c[0], c[1], c[2], c[3])
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  // Draw one layer on top of what is already there. A, B: {el, w, h, tf, warp}. tf / warp = the clip's
  // motion at this moment (see motion.js). B and name are optional.
  function drawLayer(A, B, name, progress) {
    if (!A) return
    try {
      upload(0, texA, A.el)
      if (B) upload(1, texB, B.el)
    } catch {
      return
    }
    const sA = scaleFor(A.w, A.h)
    const tA = shaderTransform(A.tf, A.warp, A.fx, A.mask)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (B) {
      const p = lib.get(name) || fade
      use(p, Math.min(1, Math.max(0, progress)), sA, scaleFor(B.w, B.h), tA, shaderTransform(B.tf, B.warp, B.fx, B.mask), [A.w, A.h], [B.w, B.h])
    } else {
      use(single, 0, sA, sA, tA, tA, [A.w, A.h], [A.w, A.h])
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  function render(A, B, name, progress) {
    clear()
    drawLayer(A, B, name, progress)
  }
  // layers: bottom to top, each {A, B?, name?, progress?}
  function renderLayers(layers, bg) {
    clear(bg)
    for (const l of layers) drawLayer(l.A, l.B, l.name, l.progress)
  }

  // Copy the current frame (RGBA, bottom row first) into buf: used when exporting.
  function read(buf) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  }

  return { render, renderLayers, clear, read, addTransition, has: (n) => lib.has(n) }
}
