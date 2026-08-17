import { useState, useEffect, useRef, useCallback } from 'react'
import { FocusContext } from './FocusContextInstance.js'
import { MODES, formatFocusTime } from './focusConstants.js'

export function FocusProvider({ children }) {
  // Session UI View Mode: 'closed' | 'fullscreen' | 'minimized'
  const [viewMode, setViewMode] = useState('closed')

  // Timer & Session state
  const [mode, setMode] = useState('focus')
  const [customMinutes, setCustomMinutes] = useState(() => {
    const saved = localStorage.getItem('focus_custom_minutes')
    return saved ? Math.max(1, Math.min(180, parseInt(saved, 10))) : 25
  })
  const [timeLeft, setTimeLeft] = useState(() => {
    const saved = localStorage.getItem('focus_custom_minutes')
    const mins = saved ? Math.max(1, Math.min(180, parseInt(saved, 10))) : 25
    return mins * 60
  })
  const [isRunning, setIsRunning] = useState(false)
  const [sessionGoal, setSessionGoal] = useState('')
  const [activeTask, setActiveTask] = useState(null)

  // Audio State (Ambient + Mechanical Ticking)
  const [ambientPreset, setAmbientPreset] = useState('none')
  const [ambientVolume, setAmbientVolume] = useState(0.4)
  const [isTickingEnabled, setIsTickingEnabled] = useState(false)
  const [tickingVolume, setTickingVolume] = useState(0.3)

  // Web Audio Context & Node Refs (Persistent across view changes)
  const audioCtxRef = useRef(null)
  const ambientMasterGainRef = useRef(null)
  const tickMasterGainRef = useRef(null)
  const ambientNodesRef = useRef([])

  // Persist custom duration setting
  useEffect(() => {
    localStorage.setItem('focus_custom_minutes', customMinutes.toString())
  }, [customMinutes])

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

  // Strict Audio Garbage Collection: Stop and disconnect all procedural nodes
  const stopAmbientSound = useCallback(() => {
    if (ambientNodesRef.current && ambientNodesRef.current.length > 0) {
      ambientNodesRef.current.forEach((node) => {
        try {
          if (node.stop) {
            node.stop()
          }
          if (node.disconnect) {
            node.disconnect()
          }
        } catch {
          // Node already stopped or disconnected
        }
      })
      ambientNodesRef.current = []
    }
  }, [])

  // Start procedural ambient sound preset with rigorous node tracking
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

  // Single Crisp Default Completion Chime (Gentle Warm 4-Tone Arpeggio)
  const playCompletionChime = useCallback(() => {
    try {
      const ctx = getAudioContext()
      if (!ctx) return
      const now = ctx.currentTime

      const notes = [523.25, 659.25, 783.99, 1046.5]
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, now + index * 0.16)
        gain.gain.setValueAtTime(0, now + index * 0.16)
        gain.gain.linearRampToValueAtTime(0.3, now + index * 0.16 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.16 + 0.9)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now + index * 0.16)
        osc.stop(now + index * 0.16 + 0.9)
      })
    } catch (err) {
      console.warn('Audio chime notice:', err)
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

  // Get total duration for active mode
  const getModeDurationSeconds = useCallback(
    (targetMode = mode) => {
      if (targetMode === 'focus') {
        return customMinutes * 60
      }
      return (MODES[targetMode]?.defaultMinutes || 5) * 60
    },
    [mode, customMinutes]
  )

  // Switch timer mode
  const switchMode = useCallback(
    (newMode) => {
      setMode(newMode)
      if (newMode === 'focus') {
        setTimeLeft(customMinutes * 60)
      } else {
        setTimeLeft((MODES[newMode]?.defaultMinutes || 5) * 60)
      }
      setIsRunning(false)
    },
    [customMinutes]
  )

  // Set custom focus duration (in minutes, 1 - 180) and synchronize countdown seconds
  const setCustomDuration = useCallback((minutes, autoStart = false) => {
    const clamped = Math.max(1, Math.min(180, Math.round(minutes)))
    const targetSeconds = clamped * 60
    setCustomMinutes(clamped)
    setMode('focus')
    setTimeLeft(targetSeconds)
    if (autoStart) {
      setIsRunning(true)
      getAudioContext()
    } else {
      setIsRunning(false)
    }
  }, [getAudioContext])

  // Reset timer
  const resetTimer = useCallback(() => {
    setTimeLeft(getModeDurationSeconds(mode))
    setIsRunning(false)
  }, [mode, getModeDurationSeconds])

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

  // Start a new Focus Session with direct duration synchronization
  const startSession = useCallback(
    (task = null, customTitle = '', durationMinutes = null) => {
      setActiveTask(task)
      setSessionGoal((prev) => {
        if (customTitle) return customTitle
        if (task?.title) return task.title
        if (prev && prev.trim() !== '') return prev
        return 'Deep Work Session'
      })
      setMode('focus')
      const targetMins = durationMinutes
        ? Math.max(1, Math.min(180, Math.round(durationMinutes)))
        : customMinutes
      const targetSeconds = targetMins * 60
      if (durationMinutes) {
        setCustomMinutes(targetMins)
      }
      setTimeLeft(targetSeconds)
      setViewMode('fullscreen')
      setIsRunning(true)
      getAudioContext()
    },
    [customMinutes, getAudioContext]
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
    document.title = `(${timeStr}) ${MODES[mode]?.label || 'Focus'}${goalText} — Task Registry`

    return () => {
      document.title = originalTitle
    }
  }, [viewMode, timeLeft, mode, sessionGoal])

  // Audio Context and Node cleanup on unmount
  useEffect(() => {
    return () => {
      stopAmbientSound()
      if (ambientMasterGainRef.current) {
        try {
          ambientMasterGainRef.current.disconnect()
        } catch {
          // Ignored
        }
      }
      if (tickMasterGainRef.current) {
        try {
          tickMasterGainRef.current.disconnect()
        } catch {
          // Ignored
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }
    }
  }, [stopAmbientSound])

  const value = {
    viewMode,
    mode,
    customMinutes,
    timeLeft,
    totalSeconds: getModeDurationSeconds(mode),
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
    setCustomDuration,
    setSessionGoal,
    setActiveTask,
    changeAmbientPreset,
    setAmbientVolume,
    setIsTickingEnabled,
    setTickingVolume
  }

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}
