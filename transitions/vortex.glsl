// author: Vibe Video Editor
// license: MIT
// Both clips are twisted into a vortex while one dissolves into the other.
uniform float strength; // = 9.0
vec4 transition(vec2 uv) {
  vec2 p = uv - 0.5;
  p.x *= ratio;
  float r = length(p);
  float k = sin(progress * 3.14159265);
  float ang = k * strength * (1.0 - clamp(r / 0.95, 0.0, 1.0));
  float c = cos(ang);
  float s = sin(ang);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p.x /= ratio;
  vec2 q = p + 0.5;
  return mix(getFromColor(q), getToColor(q), smoothstep(0.35, 0.65, progress));
}
