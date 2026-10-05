// Colour labels for clips (a stripe along the top of the clip). Pick them in the Inspector.
export const LABELS = {
  love: '#eb6f92',
  gold: '#f6c177',
  rose: '#ebbcba',
  pine: '#31748f',
  foam: '#9ccfd8',
  iris: '#c4a7e7',
  grass: '#8bd17c',
  stone: '#908caa',
}
export const labelColor = (c) => (c && c.label && LABELS[c.label]) || null