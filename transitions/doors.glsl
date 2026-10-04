// author: Vibe Video Editor
// license: MIT
// The frame splits down the middle and swings open like double doors.
vec4 transition(vec2 uv) {
  float open = 1.0 - progress;           // remaining door width (fraction of half)
  float hw = 0.5 * open;                 // door width on screen
  float x = uv.x < 0.5 ? uv.x : 1.0 - uv.x;      // distance from the outer edge
  if (open > 0.001 && x < hw) {
    float t = x / hw;                    // 0 at outer edge, 1 at inner edge
    float h = mix(1.0, 1.0 - 0.45 * progress, t);   // inner edge shrinks (perspective)
    float y = (uv.y - 0.5) / h + 0.5;
    if (y >= 0.0 && y <= 1.0) {
      float sx = uv.x < 0.5 ? t * 0.5 : 1.0 - t * 0.5;
      vec4 c = getFromColor(vec2(sx, y));
      c.rgb *= 1.0 - 0.55 * progress * t;
      return c;
    }
  }
  vec4 b = getToColor(uv);
  b.rgb *= 0.55 + 0.45 * smoothstep(0.0, 1.0, progress);
  return b;
}
