// author: Vibe Video Editor
// license: MIT
// The frame is hinged at the bottom and falls over backwards, revealing the next clip.
const float PI = 3.14159265;
const float D = 3.0;
vec4 transition(vec2 uv) {
  float th = progress * PI * 0.5;
  float c = cos(th);
  float s = sin(th);
  float Y = uv.y * 2.0;
  float den = c * D - Y * s;
  vec4 b = getToColor(uv);
  b.rgb *= 0.5 + 0.5 * progress;
  if (den > 0.0001) {
    float h = Y * D / den;
    if (h >= 0.0 && h <= 2.0) {
      float xw = (2.0 * uv.x - 1.0) * (D + h * s) / D;
      if (abs(xw) <= 1.0) {
        vec4 a = getFromColor(vec2(xw * 0.5 + 0.5, h * 0.5));
        a.rgb *= 1.0 - 0.6 * s;
        return a;
      }
    }
  }
  return b;
}
