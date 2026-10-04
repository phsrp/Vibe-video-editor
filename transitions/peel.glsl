// author: Vibe Video Editor
// license: MIT
// The frame is peeled off diagonally from the bottom-right corner.
uniform vec2 direction; // = vec2(1.0, -1.0)
uniform float radius; // = 0.14
const float PI = 3.14159265;
vec4 transition(vec2 uv) {
  vec2 d = normalize(direction);
  vec2 P = vec2(uv.x * ratio, uv.y);
  float w = dot(P, d);
  vec2 corner = vec2(d.x * ratio, d.y);
  float wmax = max(0.0, corner.x) + max(0.0, corner.y);
  float wmin = min(0.0, corner.x) + min(0.0, corner.y);
  float R = radius;
  float fw = wmax - progress * (wmax - wmin + 2.0 * R);
  float s = w - fw;
  vec4 col = getToColor(uv);
  if (s > R) col.rgb *= 1.0 - 0.4 * (1.0 - smoothstep(R, R * 3.5, s));
  if (s < 0.0) col = getFromColor(uv);

  float t = -1.0;
  if (s <= 0.0) t = PI * R - s;
  else if (s < R) t = PI * R - R * asin(s / R);
  if (t >= 0.0) {
    vec2 ap = P + d * ((fw + t) - w);
    vec2 au = vec2(ap.x / ratio, ap.y);
    if (au.x >= 0.0 && au.x <= 1.0 && au.y >= 0.0 && au.y <= 1.0) {
      vec4 c = getFromColor(au);
      float shade = s < R && s > 0.0 ? 0.6 + 0.4 * (s / R) : 1.0;
      return vec4(mix(c.rgb, vec3(0.92), 0.4) * shade, 1.0);
    }
  }
  if (s > 0.0 && s < R) {
    float t1 = R * asin(s / R);
    vec2 ap = P + d * ((fw + t1) - w);
    vec2 au = vec2(ap.x / ratio, ap.y);
    if (au.x >= 0.0 && au.x <= 1.0 && au.y >= 0.0 && au.y <= 1.0) {
      vec4 c = getFromColor(au);
      c.rgb *= 0.6 + 0.5 * (s / R);
      return c;
    }
  }
  return col;
}
