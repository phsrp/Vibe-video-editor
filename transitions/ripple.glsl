// author: gl-transitions (adapted)
// license: MIT
uniform float amplitude; // = 100.0
uniform float speed; // = 50.0
vec4 transition(vec2 uv) {
  vec2 dir = uv - vec2(0.5);
  float dist = length(dir);
  vec2 offset = dir * (sin(progress * dist * amplitude - progress * speed) + 0.5) / 30.0;
  return mix(getFromColor(uv + offset), getToColor(uv), smoothstep(0.2, 1.0, progress));
}
