// author: Vibe Video Editor
// license: MIT
// The frame is blown away to the right in streaks, revealing the next clip.
uniform float rows; // = 70.0
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
vec4 transition(vec2 uv) {
  float r = floor(uv.y * rows);
  float speed = 0.4 + hash(vec2(r, 1.0)) * 1.2;
  float shift = progress * speed * 1.6;
  float streak = 0.12 * shift;
  vec4 acc = vec4(0.0);
  float cov = 0.0;
  for (int i = 0; i < 9; i++) {
    float x = uv.x - shift + float(i) * streak / 8.0;
    if (x >= 0.0 && x <= 1.0) {
      acc += getFromColor(vec2(x, uv.y));
      cov += 1.0;
    }
  }
  vec4 b = getToColor(uv);
  if (cov < 0.5) return b;
  return mix(b, acc / cov, cov / 9.0);
}
