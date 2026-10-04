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
// Sources are letterboxed ("contain"). Where a source fills the frame, edges are clamped.
vec4 sampleSrc(sampler2D t, vec2 s, vec4 tf, vec2 p, vec2 uv) {
  vec2 c = uv - 0.5;
  if (p.y > 0.5) {
    // inverse of: scale, rotate (clockwise), then move
    c.x *= ratio;
    c -= vec2(tf.x * ratio, tf.y);
    float cs = cos(tf.w);
    float sn = sin(tf.w);
    c = vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) / tf.z;
    c.x /= ratio;
  }
  vec2 q = c * s + 0.5;
  if (p.y > 0.5) {
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    if (s.x > 1.0001 && (q.x < 0.0 || q.x > 1.0)) return vec4(0.0, 0.0, 0.0, 1.0);
    if (s.y > 1.0001 && (q.y < 0.0 || q.y > 1.0)) return vec4(0.0, 0.0, 0.0, 1.0);
  }
  return vec4(texture2D(t, clamp(q, 0.0, 1.0)).rgb * p.x, 1.0);
}
vec4 getFromColor(vec2 uv) { return sampleSrc(from, sA, tfA, pA, uv); }
vec4 getToColor(vec2 uv) { return sampleSrc(to, sB, tfB, pB, uv); }
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
      loc: { from: u('from'), to: u('to'), progress: u('progress'), ratio: u('ratio'), sA: u('sA'), sB: u('sB'), tfA: u('tfA'), tfB: u('tfB'), pA: u('pA'), pB: u('pB') },
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

  // A, B: {el, w, h, tf}. tf = the clip's motion at this moment (see motion.js). B and name are optional.
  function render(A, B, name, progress) {
    clear()
    if (!A) return
    try {
      upload(0, texA, A.el)
      if (B) upload(1, texB, B.el)
    } catch {
      return
    }
    const sA = scaleFor(A.w, A.h)
    const tA = shaderTransform(A.tf)
    if (B) {
      const p = lib.get(name) || fade
      use(p, Math.min(1, Math.max(0, progress)), sA, scaleFor(B.w, B.h), tA, shaderTransform(B.tf))
    } else {
      use(single, 0, sA, sA, tA, tA)
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  // Copy the current frame (RGBA, bottom row first) into buf: used when exporting.
  function read(buf) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  }

  return { render, clear, read, addTransition, has: (n) => lib.has(n) }
}
