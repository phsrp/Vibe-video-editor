// author: Vibe Video Editor
// license: MIT
vec4 transition(vec2 uv) {
  float p = progress;
  vec2 a = (uv - 0.5) / (1.0 + p * 1.5) + 0.5;
  vec2 b = (uv - 0.5) / (1.5 - p * 0.5) + 0.5;
  return mix(getFromColor(a), getToColor(b), smoothstep(0.3, 0.8, p));
}
