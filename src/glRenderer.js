import { shaderTransform } from './motion.js'

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
// Result is premultiplied: transparent outside the picture, so layers can be stacked.
vec4 sampleSrc(sampler2D t, vec2 s, vec4 tf, vec2 p, vec2 st, mat3 h, float w, vec2 uv) {
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
    vec4 tx = texture2D(t, q);
    return vec4(tx.rgb * tx.a * p.x, tx.a * p.x);
  }
  if (p.y > 0.5) {
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
  } else {
    if (s.x > 1.0001 && (q.x < 0.0 || q.x > 1.0)) return vec4(0.0);
    if (s.y > 1.0001 && (q.y < 0.0 || q.y > 1.0)) return vec4(0.0);
  }
  vec4 tx = texture2D(t, clamp(q, 0.0, 1.0));
  return vec4(tx.rgb * tx.a * p.x, tx.a * p.x);
}
vec4 getFromColor(vec2 uv) { return sampleSrc(from, sA, tfA, pA, stA, hA, wA, uv); }
vec4 getToColor(vec2 uv) { return sampleSrc(to, sB, tfB, pB, stB, hB, wB, uv); }
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
      loc: { from: u('from'), to: u('to'), progress: u('progress'), ratio: u('ratio'), sA: u('sA'), sB: u('sB'), tfA: u('tfA'), tfB: u('tfB'), pA: u('pA'), pB: u('pB'), stA: u('stA'), stB: u('stB'), hA: u('hA'), hB: u('hB'), wA: u('wA'), wB: u('wB') },
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

  function use(p, progress, sA, sB, tA, tB) {
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

  function clear() {
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 1)
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
    const tA = shaderTransform(A.tf, A.warp)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (B) {
      const p = lib.get(name) || fade
      use(p, Math.min(1, Math.max(0, progress)), sA, scaleFor(B.w, B.h), tA, shaderTransform(B.tf, B.warp))
    } else {
      use(single, 0, sA, sA, tA, tA)
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  function render(A, B, name, progress) {
    clear()
    drawLayer(A, B, name, progress)
  }
  // layers: bottom to top, each {A, B?, name?, progress?}
  function renderLayers(layers) {
    clear()
    for (const l of layers) drawLayer(l.A, l.B, l.name, l.progress)
  }

  // Copy the current frame (RGBA, bottom row first) into buf: used when exporting.
  function read(buf) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  }

  return { render, renderLayers, clear, read, addTransition, has: (n) => lib.has(n) }
}
