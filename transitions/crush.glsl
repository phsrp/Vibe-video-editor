// author: Vibe Video Editor
// license: MIT
// The frame is crushed: it pixelates, crumples and collapses to the centre.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
vec4 transition(vec2 uv) {
  float e = progress;
  float s = max(1.0 - smoothstep(0.0, 1.0, e), 0.0001);
  float blocks = mix(260.0, 10.0, smoothstep(0.0, 0.75, e));
  vec2 g = vec2(blocks * ratio, blocks);
  vec2 cell = floor(uv * g);
  vec2 q = (cell + 0.5) / g;
  q += (vec2(hash(cell), hash(cell + 7.0)) - 0.5) * 0.04 * sin(e * 3.14159265);
  vec2 p = (q - 0.5) / s + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return getToColor(uv);
  vec4 c = getFromColor(p);
  c.rgb *= 1.0 - 0.35 * e;
  return c;
}
