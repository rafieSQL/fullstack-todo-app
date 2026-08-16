export const MODES = {
  focus: { label: 'Focus', defaultMinutes: 25 },
  short: { label: 'Short Break', defaultMinutes: 5 },
  long: { label: 'Long Break', defaultMinutes: 15 }
}

export const DURATION_PRESETS = [5, 15, 25, 45, 60, 90]

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
