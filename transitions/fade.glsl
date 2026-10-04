// author: Vibe Video Editor
// license: MIT
vec4 transition(vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}
