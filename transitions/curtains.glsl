// author: Vibe Video Editor
// license: MIT
// The frame gathers into pleated curtains at both sides, revealing the next clip.
uniform float pleats; // = 14.0
vec4 transition(vec2 uv) {
  float open = 1.0 - progress;
  float hw = 0.5 * open;
  float x = uv.x < 0.5 ? uv.x : 1.0 - uv.x;
  if (open > 0.001 && x < hw) {
    float t = x / hw;
    float sx = uv.x < 0.5 ? t * 0.5 : 1.0 - t * 0.5;
    vec4 c = getFromColor(vec2(sx, uv.y));
    float fold = 0.5 + 0.5 * sin(x * pleats * 6.2831853 / max(hw, 0.05) * 0.25 + uv.y * 0.6);
    c.rgb *= mix(1.0, 0.45 + 0.55 * fold, smoothstep(0.0, 0.3, progress));
    return c;
  }
  return getToColor(uv);
}
