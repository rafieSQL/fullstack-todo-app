// Web Audio API Synthesized Sound Effects (Zero external audio assets)
let audioCtx = null

function getAudioContext() {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (AudioContextClass) {
      audioCtx = new AudioContextClass()
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

/**
 * 1. Play Activate Sound: Soft ascending two-frequency tone (440Hz -> 880Hz, 80ms)
 */
export function playActivate() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, now)
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08)

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.12, now + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.08)
  } catch (err) {
    console.debug('SFX playActivate error:', err)
  }
}

/**
 * 2. Play Success Sound: Clean dual-tone harmonic chime (523.25Hz + 659.25Hz, 120ms)
 */
export function playSuccess() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const duration = 0.14

    // Primary Tone (C5 - 523.25Hz)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(523.25, now)

    gain1.gain.setValueAtTime(0, now)
    gain1.gain.linearRampToValueAtTime(0.1, now + 0.015)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + duration)

    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + duration)

    // Harmonic Tone (E5 - 659.25Hz)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(659.25, now + 0.02)

    gain2.gain.setValueAtTime(0, now + 0.02)
    gain2.gain.linearRampToValueAtTime(0.08, now + 0.035)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + duration + 0.04)

    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.02)
    osc2.stop(now + duration + 0.04)
  } catch (err) {
    console.debug('SFX playSuccess error:', err)
  }
}

/**
 * 3. Play Deactivate Sound: Soft low descending tone (400Hz -> 200Hz, 60ms)
 */
export function playDeactivate() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(400, now)
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.06)

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.09, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.06)
  } catch (err) {
    console.debug('SFX playDeactivate error:', err)
  }
}
