// author: Vibe Video Editor
// license: MIT
// The frame cracks into glass shards that tumble away, revealing the next clip.
uniform float cells; // = 7.0
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
vec2 hash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
vec4 transition(vec2 uv) {
  vec2 P = vec2(uv.x * ratio, uv.y) * cells;
  vec2 ip = floor(P);
  vec2 fp = fract(P);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 cid = vec2(0.0);
  vec2 cc = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(ip + g);
      float d = length(g + o - fp);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        cid = ip + g;
        cc = ip + g + o;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  vec2 cuv = vec2(cc.x / (cells * ratio), cc.y / cells);          // shard centre in uv
  float dist = length(vec2(cc.x / cells, cc.y / cells) - vec2(0.5 * ratio, 0.5));
  float rnd = hash(cid);
  float q = clamp((progress - 0.15 - dist * 0.45) * 3.2, 0.0, 1.0);
  float ang = (rnd - 0.5) * q * 1.6;
  vec2 d = uv - cuv;
  d.x *= ratio;
  d.y += q * q * 0.9;
  float c = cos(ang);
  float s = sin(ang);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  d.x /= ratio;
  vec2 src = cuv + d;
  vec4 b = getToColor(uv);
  vec4 col = b;
  if (q < 1.0 && src.x >= 0.0 && src.x <= 1.0 && src.y >= 0.0 && src.y <= 1.0) {
    col = mix(getFromColor(src), b, smoothstep(0.5, 1.0, q));
  }
  float crack = 1.0 - smoothstep(0.0, 0.05, d2 - d1);
  col.rgb *= 1.0 - 0.85 * crack * smoothstep(0.0, 0.15, progress) * (1.0 - q);
  return col;
}
