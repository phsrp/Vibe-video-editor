// author: Vibe Video Editor
// license: MIT
// A 3D cube turns from the current clip to the next one.
const float PI = 3.14159265;
const float D = 3.2; // camera distance
vec4 transition(vec2 uv) {
  float th = progress * PI * 0.5;
  float c = cos(th);
  float s = sin(th);
  float kf = D / (D - 1.0);
  float X = (2.0 * uv.x - 1.0) * kf;
  float Y = (2.0 * uv.y - 1.0) * kf;
  vec4 col = vec4(0.0, 0.0, 0.0, 1.0);
  float zbest = -10.0;

  // outgoing face (starts in front, swings to the left)
  float den = D * c + X * s;
  if (abs(den) > 0.0001) {
    float u = (X * (D - c) + D * s) / den;
    float z = u * s + c;
    float y = Y / (D / (D - z));
    if (abs(u) <= 1.0 && abs(y) <= 1.0) {
      col = getFromColor(vec2(u * 0.5 + 0.5, y * 0.5 + 0.5));
      col.rgb *= mix(0.4, 1.0, c);
      zbest = z;
    }
  }
  // incoming face (starts at the right side, swings to the front)
  float den2 = D * s - X * c;
  if (abs(den2) > 0.0001) {
    float v = (D * c - X * (D - s)) / den2;
    float z = s + v * c;
    float y = Y / (D / (D - z));
    if (abs(v) <= 1.0 && abs(y) <= 1.0 && z > zbest) {
      col = getToColor(vec2(-v * 0.5 + 0.5, y * 0.5 + 0.5));
      col.rgb *= mix(0.4, 1.0, s);
    }
  }
  return col;
}
