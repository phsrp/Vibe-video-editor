// author: Vibe Video Editor
// license: MIT
// The frame is cut into strips that slide away up and down like paper through a shredder.
uniform float strips; // = 14.0
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
vec4 transition(vec2 uv) {
  float i = floor(uv.x * strips);
  float dir = mod(i, 2.0) < 1.0 ? 1.0 : -1.0;
  float q = clamp(progress * 1.6 - hash(vec2(i, 3.0)) * 0.6, 0.0, 1.0);
  q = q * q;
  float y = uv.y - dir * q * 1.15;
  if (y >= 0.0 && y <= 1.0) {
    vec4 c = getFromColor(vec2(uv.x, y));
    float g = smoothstep(0.0, 0.05, 0.5 - abs(fract(uv.x * strips) - 0.5));
    c.rgb *= mix(1.0, g, step(0.001, q));
    return c;
  }
  return getToColor(uv);
}
