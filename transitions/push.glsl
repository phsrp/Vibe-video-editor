// author: Vibe Video Editor
// license: MIT
vec4 transition(vec2 uv) {
  float x = uv.x + progress;
  if (x < 1.0) return getFromColor(vec2(x, uv.y));
  return getToColor(vec2(x - 1.0, uv.y));
}
