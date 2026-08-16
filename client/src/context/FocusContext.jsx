import { useState, useEffect, useRef, useCallback } from 'react'
import * as api from '../api.js'
import { FocusContext } from './FocusContextInstance.js'
import { MODES } from './focusConstants.js'
import { formatFocusTime } from './focusConstants.js'

export function FocusProvider({ children }) {
  // Session UI View Mode: 'closed' | 'fullscreen' | 'minimized'
  const [viewMode, setViewMode] = useState('closed')

  // Timer & Session state
  const [mode, setMode] = useState('focus')
  const [timeLeft, setTimeLeft] = useState(MODES.focus.seconds)
  const [isRunning, setIsRunning] = useState(false)
  const [sessionGoal, setSessionGoal] = useState('')
  const [activeTask, setActiveTask] = useState(null)

  // Audio State
  const [ambientPreset, setAmbientPreset] = useState('none')
  const [ambientVolume, setAmbientVolume] = useState(0.4)
  const [isTickingEnabled, setIsTickingEnabled] = useState(false)
  const [tickingVolume, setTickingVolume] = useState(0.3)

  // Web Audio Context & Node Refs (Persistent across view changes)
  const audioCtxRef = useRef(null)
  const ambientMasterGainRef = useRef(null)
  const tickMasterGainRef = useRef(null)
  const ambientNodesRef = useRef([])

  // Initialize or resume persistent AudioContext
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (AudioCtx) {
        audioCtxRef.current = new AudioCtx()

        // Ambient Gain Node
        const ambGain = audioCtxRef.current.createGain()
        ambGain.gain.setValueAtTime(ambientVolume, audioCtxRef.current.currentTime)
        ambGain.connect(audioCtxRef.current.destination)
        ambientMasterGainRef.current = ambGain

        // Mechanical Tick Gain Node
        const tickGain = audioCtxRef.current.createGain()
        tickGain.gain.setValueAtTime(tickingVolume, audioCtxRef.current.currentTime)
        tickGain.connect(audioCtxRef.current.destination)
        tickMasterGainRef.current = tickGain
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }, [ambientVolume, tickingVolume])

  // Stop ambient sound nodes safely
  const stopAmbientSound = useCallback(() => {
    ambientNodesRef.current.forEach((node) => {
      try {
        if (node.stop) node.stop()
        if (node.disconnect) node.disconnect()
      } catch {
        // Node already stopped
      }
    })
    ambientNodesRef.current = []
  }, [])

  // Start procedural ambient sound preset
  const startAmbientSound = useCallback(
    (preset) => {
      stopAmbientSound()
      if (preset === 'none') return

      try {
        const ctx = getAudioContext()
        if (!ctx || !ambientMasterGainRef.current) return

        const bufferSize = ctx.sampleRate * 4
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
        const data = buffer.getChannelData(0)

        if (preset === 'brown') {
          // Brownian Noise: Integrated white noise with lowpass filter
          let lastOut = 0.0
          for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1
            data[i] = (lastOut + 0.02 * white) / 1.02
            lastOut = data[i]
            data[i] *= 3.5
          }

          const noiseSource = ctx.createBufferSource()
          noiseSource.buffer = buffer
          noiseSource.loop = true

          const filter = ctx.createBiquadFilter()
          filter.type = 'lowpass'
          filter.frequency.setValueAtTime(320, ctx.currentTime)

          noiseSource.connect(filter)
          filter.connect(ambientMasterGainRef.current)
          noiseSource.start()

          ambientNodesRef.current = [noiseSource, filter]
        } else if (preset === 'pink') {
          // Pink Noise / Rain Simulation
          let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
          for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1
            b0 = 0.99886 * b0 + white * 0.0555179
            b1 = 0.99332 * b1 + white * 0.0750759
            b2 = 0.96900 * b2 + white * 0.1538520
            b3 = 0.86650 * b3 + white * 0.3104856
            b4 = 0.55000 * b4 + white * 0.5329522
            b5 = -0.7616 * b5 - white * 0.0168980
            data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362
            data[i] *= 0.11
            b6 = white * 0.115926
          }

          const noiseSource = ctx.createBufferSource()
          noiseSource.buffer = buffer
          noiseSource.loop = true

          const filter = ctx.createBiquadFilter()
          filter.type = 'lowpass'
          filter.frequency.setValueAtTime(1200, ctx.currentTime)

          noiseSource.connect(filter)
          filter.connect(ambientMasterGainRef.current)
          noiseSource.start()

          ambientNodesRef.current = [noiseSource, filter]
        } else if (preset === 'gamma40') {
          // 40Hz Isochronic Gamma Pulse
          const carrier = ctx.createOscillator()
          carrier.type = 'sine'
          carrier.frequency.setValueAtTime(180, ctx.currentTime)

          const pulseGain = ctx.createGain()
          pulseGain.gain.setValueAtTime(0.5, ctx.currentTime)

          const lfo = ctx.createOscillator()
          lfo.type = 'square'
          lfo.frequency.setValueAtTime(40, ctx.currentTime)

          const lfoGain = ctx.createGain()
          lfoGain.gain.setValueAtTime(0.5, ctx.currentTime)

          lfo.connect(lfoGain)
          lfoGain.connect(pulseGain.gain)

          carrier.connect(pulseGain)
          pulseGain.connect(ambientMasterGainRef.current)

          carrier.start()
          lfo.start()

          ambientNodesRef.current = [carrier, lfo, pulseGain, lfoGain]
        }
      } catch (err) {
        console.warn('Failed to start ambient sound:', err)
      }
    },
    [getAudioContext, stopAmbientSound]
  )

  // Procedural Mechanical Clock Tick Sound (Wood/Metal Escapement click)
  const playMechanicalTick = useCallback(() => {
    try {
      const ctx = getAudioContext()
      if (!ctx || !tickMasterGainRef.current) return

      const now = ctx.currentTime

      // 1. High-frequency wood click
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      const tickFreq = Math.floor(now) % 2 === 0 ? 1200 : 960
      osc.frequency.setValueAtTime(tickFreq, now)

      gain.gain.setValueAtTime(0.4, now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018)

      osc.connect(gain)
      gain.connect(tickMasterGainRef.current)
      osc.start(now)
      osc.stop(now + 0.018)

      // 2. Subtle lowpass noise body for mechanical escapement texture
      const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.015), ctx.sampleRate)
      const noiseData = noiseBuffer.getChannelData(0)
      for (let i = 0; i < noiseData.length; i++) {
        noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.003))
      }
      const noiseSource = ctx.createBufferSource()
      noiseSource.buffer = noiseBuffer

      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(1800, now)
      filter.Q.setValueAtTime(3, now)

      const noiseGain = ctx.createGain()
      noiseGain.gain.setValueAtTime(0.2, now)
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015)

      noiseSource.connect(filter)
      filter.connect(noiseGain)
      noiseGain.connect(tickMasterGainRef.current)

      noiseSource.start(now)
      noiseSource.stop(now + 0.015)
    } catch {
      // Audio clock tick failed silently
    }
  }, [getAudioContext])

  // Play dual-tone completion chime
  const playCompletionChime = useCallback(() => {
    try {
      const ctx = getAudioContext()
      if (!ctx) return

      const now = ctx.currentTime

      const osc1 = ctx.createOscillator()
      const gain1 = ctx.createGain()
      osc1.type = 'sine'
      osc1.frequency.setValueAtTime(880, now)
      gain1.gain.setValueAtTime(0.3, now)
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
      osc1.connect(gain1)
      gain1.connect(ctx.destination)
      osc1.start(now)
      osc1.stop(now + 0.3)

      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.type = 'sine'
      osc2.frequency.setValueAtTime(1320, now + 0.15)
      gain2.gain.setValueAtTime(0.35, now + 0.15)
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.start(now + 0.15)
      osc2.stop(now + 0.6)
    } catch (err) {
      console.warn('Audio chime error:', err)
    }
  }, [getAudioContext])

  // Sync volume updates
  useEffect(() => {
    if (ambientMasterGainRef.current && audioCtxRef.current) {
      ambientMasterGainRef.current.gain.setValueAtTime(ambientVolume, audioCtxRef.current.currentTime)
    }
  }, [ambientVolume])

  useEffect(() => {
    if (tickMasterGainRef.current && audioCtxRef.current) {
      tickMasterGainRef.current.gain.setValueAtTime(tickingVolume, audioCtxRef.current.currentTime)
    }
  }, [tickingVolume])

  // Switch timer mode
  const switchMode = useCallback((newMode) => {
    setMode(newMode)
    setTimeLeft(MODES[newMode].seconds)
    setIsRunning(false)
  }, [])

  // Reset timer
  const resetTimer = useCallback(() => {
    setTimeLeft(MODES[mode].seconds)
    setIsRunning(false)
  }, [mode])

  // Toggle Play/Pause
  const togglePlay = useCallback(() => {
    getAudioContext()
    setIsRunning((prev) => !prev)
  }, [getAudioContext])

  // Change Ambient Preset
  const changeAmbientPreset = useCallback(
    (presetId) => {
      setAmbientPreset(presetId)
      startAmbientSound(presetId)
    },
    [startAmbientSound]
  )

  // Start a new Focus Session
  const startSession = useCallback(
    (task = null, customTitle = '') => {
      setActiveTask(task)
      setSessionGoal(customTitle || task?.title || 'Deep Work Session')
      setMode('focus')
      setTimeLeft(MODES.focus.seconds)
      setViewMode('fullscreen')
      setIsRunning(true)
      getAudioContext()
    },
    [getAudioContext]
  )

  // Minimize session to floating PiP mini-player
  const minimizeSession = useCallback(() => {
    setViewMode('minimized')
  }, [])

  // Expand session back to fullscreen overlay
  const expandSession = useCallback(() => {
    setViewMode('fullscreen')
  }, [])

  // End and close session completely
  const endSession = useCallback(() => {
    setIsRunning(false)
    stopAmbientSound()
    setViewMode('closed')
    setActiveTask(null)
    setSessionGoal('')
  }, [stopAmbientSound])

  // Primary Countdown Tick Engine
  useEffect(() => {
    let intervalId = null

    if (isRunning) {
      intervalId = setInterval(() => {
        if (isTickingEnabled) {
          playMechanicalTick()
        }

        setTimeLeft((prev) => {
          if (prev <= 1) {
            setIsRunning(false)
            playCompletionChime()

            // Record completion in Supabase activity log
            const titleLabel = sessionGoal ? ` on "${sessionGoal}"` : ''
            api
              .logActivity({
                type: 'focus-complete',
                message: `Completed a ${MODES[mode].label} Session${titleLabel}`,
                details: { taskId: activeTask?.id, mode }
              })
              .catch(() => {})

            return 0
          }
          return prev - 1
        })
      }, 1000)
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [isRunning, isTickingEnabled, mode, sessionGoal, activeTask, playMechanicalTick, playCompletionChime])

  // Document Title Synchronization
  useEffect(() => {
    if (viewMode === 'closed') return

    const originalTitle = document.title
    const timeStr = formatFocusTime(timeLeft)
    const goalText = sessionGoal ? ` • ${sessionGoal}` : ''
    document.title = `(${timeStr}) ${MODES[mode].label}${goalText} — Task Registry`

    return () => {
      document.title = originalTitle
    }
  }, [viewMode, timeLeft, mode, sessionGoal])

  // Audio Context cleanup on unmount
  useEffect(() => {
    return () => {
      stopAmbientSound()
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }
    }
  }, [stopAmbientSound])

  const value = {
    viewMode,
    mode,
    timeLeft,
    isRunning,
    sessionGoal,
    activeTask,
    ambientPreset,
    ambientVolume,
    isTickingEnabled,
    tickingVolume,
    // Actions
    startSession,
    minimizeSession,
    expandSession,
    endSession,
    togglePlay,
    resetTimer,
    switchMode,
    setSessionGoal,
    setActiveTask,
    changeAmbientPreset,
    setAmbientVolume,
    setIsTickingEnabled,
    setTickingVolume
  }

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}
