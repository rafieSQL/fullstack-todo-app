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

export const ALARM_SOUNDS = [
  { id: 'gentle_chime', label: 'Gentle Chime', desc: 'Melodic 3-tone arpeggio' },
  { id: 'digital_beep', label: 'Digital Beep', desc: 'Classic 880Hz triple chime' },
  { id: 'singing_bowl', label: 'Zen Singing Bowl', desc: 'Deep resonant meditation gong' },
  { id: 'mechanical_bell', label: 'Mechanical Bell', desc: 'Metallic ping with high-frequency ring' },
  { id: 'radar_pulse', label: 'Subtle Radar Pulse', desc: 'Soft sonar frequency sweep' }
]

/**
 * Format seconds into MM:SS
 */
export function formatFocusTime(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
