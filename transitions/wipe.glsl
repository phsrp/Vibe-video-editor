// author: Vibe Video Editor
// license: MIT
uniform float softness; // = 0.08
vec4 transition(vec2 uv) {
  float edge = progress * (1.0 + softness) - softness;
  float m = smoothstep(edge, edge + softness, uv.x);
  return mix(getToColor(uv), getFromColor(uv), m);
}
