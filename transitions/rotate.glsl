// author: Vibe Video Editor
// license: MIT
// The outgoing frame rotates away while the incoming frame rotates in.
const float PI = 3.14159265;
vec2 rot(vec2 uv, float ang, float zoom) {
  vec2 p = uv - 0.5;
  p.x *= ratio;
  float c = cos(ang);
  float s = sin(ang);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) / zoom;
  p.x /= ratio;
  return p + 0.5;
}
vec4 transition(vec2 uv) {
  float e = progress * progress * (3.0 - 2.0 * progress);
  vec4 a = getFromColor(rot(uv, e * PI * 0.5, 1.0 + e * 0.6));
  vec4 b = getToColor(rot(uv, -(1.0 - e) * PI * 0.5, 1.6 - e * 0.6));
  return mix(a, b, smoothstep(0.35, 0.65, e));
}
