// Themes: the two that come with the editor (Rosé Pine and Rosé Pine Dawn) and the ones the user makes.
// A theme = a base ('dark' or 'dawn', which decides the form controls and every colour that is not changed)
// plus its own colours: { id, name, base, vars: { '--bg': '#...', ... } }. Custom themes are kept in settings.json.
// The colours themselves are the CSS variables of src/styles.css.

export const TOKENS = [
  {
    group: 'Surfaces',
    items: [
      { key: '--bg', label: 'Window background' },
      { key: '--panel', label: 'Panels' },
      { key: '--panel2', label: 'Raised parts and buttons' },
      { key: '--line', label: 'Borders' },
      { key: '--line2', label: 'Stronger borders and scrollbars' },
    ],
  },
  {
    group: 'Text',
    items: [
      { key: '--text', label: 'Text' },
      { key: '--dim', label: 'Dim text' },
      { key: '--muted', label: 'Faint text' },
    ],
  },
  {
    group: 'Accent',
    items: [
      { key: '--accent', label: 'Accent (main buttons, highlights)' },
      { key: '--accent-fg', label: 'Text on the accent' },
      { key: '--accent2', label: 'Selection outline' },
      { key: '--love', label: 'Warnings and errors' },
    ],
  },
  {
    group: 'Timeline',
    items: [
      { key: '--clip-video-bg', label: 'Video clip' },
      { key: '--clip-video-bd', label: 'Video clip edge' },
      { key: '--clip-image-bg', label: 'Picture clip' },
      { key: '--clip-image-bd', label: 'Picture clip edge' },
      { key: '--a-stream-bg', label: "A video's own sound" },
      { key: '--a-stream-bd', label: "A video's own sound, edge" },
      { key: '--a-free-bg', label: 'Audio clip' },
      { key: '--a-free-bd', label: 'Audio clip edge' },
      { key: '--a-detached-bg', label: 'Sound taken out of a video' },
      { key: '--a-detached-bd', label: 'Sound taken out of a video, edge' },
    ],
  },
]
export const ALL_KEYS = TOKENS.flatMap((g) => g.items.map((i) => i.key))

export const BUILTIN = [
  { id: 'dark', name: 'Rosé Pine', base: 'dark', builtin: true, vars: {} },
  { id: 'dawn', name: 'Rosé Pine Dawn', base: 'dawn', builtin: true, vars: {} },
]

export const allThemes = (custom) => [...BUILTIN, ...(custom || [])]
export const findTheme = (id, custom) => allThemes(custom).find((t) => t.id === id) || BUILTIN[0]

// the colours a base theme has, read from the stylesheet
const baseCache = {}
export function baseValues(base) {
  if (baseCache[base]) return baseCache[base]
  const el = document.createElement('div')
  el.dataset.theme = base
  el.style.display = 'none'
  document.body.appendChild(el)
  const cs = getComputedStyle(el)
  const out = {}
  for (const k of ALL_KEYS) out[k] = cs.getPropertyValue(k).trim()
  el.remove()
  baseCache[base] = out
  return out
}
// every colour of a theme (the base's, with the theme's own on top)
export const valuesOf = (theme) => ({ ...baseValues(theme.base), ...(theme.vars || {}) })

const hexToRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim())
  if (!m) return [25, 23, 36]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
// the style (CSS variables) a theme sets: its own colours, and the dimmed backdrop made from the window colour
export function themeStyle(theme) {
  const v = theme.vars || {}
  const out = { ...v }
  if (v['--bg']) {
    const [r, g, b] = hexToRgb(v['--bg'])
    out['--scrim'] = `rgba(${r}, ${g}, ${b}, ${theme.base === 'dawn' ? 0.45 : 0.72})`
  }
  return out
}

// switch the whole window to a theme
let applied = []
export function applyTheme(theme) {
  const root = document.documentElement
  for (const k of applied) root.style.removeProperty(k)
  applied = []
  root.dataset.theme = theme.base
  const st = themeStyle(theme)
  for (const [k, val] of Object.entries(st)) {
    root.style.setProperty(k, val)
    applied.push(k)
  }
}
