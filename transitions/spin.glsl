// author: Vibe Video Editor
// license: MIT
// The whole frame spins and shrinks away, revealing the next clip.
const float PI = 3.14159265;
uniform float turns; // = 1.5
vec4 transition(vec2 uv) {
  float e = progress * progress * (3.0 - 2.0 * progress);
  float s = max(1.0 - e, 0.0001);
  float ang = e * PI * turns;
  vec2 p = uv - 0.5;
  p.x *= ratio;
  float c = cos(ang);
  float sn = sin(ang);
  p = vec2(c * p.x - sn * p.y, sn * p.x + c * p.y) / s;
  p.x /= ratio;
  p += 0.5;
  vec2 b = (uv - 0.5) / (1.0 + 0.25 * (1.0 - e)) + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return getToColor(b);
  return getFromColor(p);
}
