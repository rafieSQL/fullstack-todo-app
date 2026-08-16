export const MODES = {
  focus: { label: 'Focus', seconds: 25 * 60 },
  short: { label: 'Short Break', seconds: 5 * 60 },
  long: { label: 'Long Break', seconds: 15 * 60 }
}

export const AMBIENT_PRESETS = [
  { id: 'none', label: 'Off' },
  { id: 'brown', label: 'Brown Noise' },
  { id: 'pink', label: 'Rain (Pink)' },
  { id: 'gamma40', label: '40Hz Gamma' }
]

/**
 * Format seconds into MM:SS
 */
export function formatFocusTime(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
