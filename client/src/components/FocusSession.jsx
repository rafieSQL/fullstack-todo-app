import { useState, useEffect, useRef, useCallback } from 'react'
import './FocusSession.css'

const MODES = {
  focus: { label: 'Focus', seconds: 25 * 60 },
  short: { label: 'Short Break', seconds: 5 * 60 },
  long: { label: 'Long Break', seconds: 15 * 60 }
}

const AMBIENT_PRESETS = [
  { id: 'none', label: 'Off' },
  { id: 'brown', label: 'Brown Noise' },
  { id: 'pink', label: 'Rain (Pink)' },
  { id: 'gamma40', label: '40Hz Gamma' }
]

export default function FocusSession({ task, onClose, onToggleTask, onCompleteSession }) {
  const [mode, setMode] = useState('focus')
  const [timeLeft, setTimeLeft] = useState(MODES.focus.seconds)
  const [isRunning, setIsRunning] = useState(false)
  const [ambientSound, setAmbientSound] = useState('none')
  const [volume, setVolume] = useState(0.4)

  // Audio Context and Node references for procedural audio
  const audioCtxRef = useRef(null)
  const masterGainRef = useRef(null)
  const soundNodesRef = useRef([])

  // Format seconds into MM:SS
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  // Initialize Web Audio Context
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (AudioCtx) {
        audioCtxRef.current = new AudioCtx()
        const gain = audioCtxRef.current.createGain()
        gain.gain.setValueAtTime(volume, audioCtxRef.current.currentTime)
        gain.connect(audioCtxRef.current.destination)
        masterGainRef.current = gain
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }, [volume])

  // Play crisp dual-tone completion chime
  const playCompletionChime = useCallback(() => {
    try {
      const ctx = getAudioContext()
      if (!ctx) return

      const now = ctx.currentTime

      // Tone 1: 880Hz (A5)
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

      // Tone 2: 1320Hz (E6)
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

  // Stop active procedural sound nodes
  const stopAmbientSound = useCallback(() => {
    soundNodesRef.current.forEach((node) => {
      try {
        if (node.stop) node.stop()
        if (node.disconnect) node.disconnect()
      } catch {
        // Node already stopped
      }
    })
    soundNodesRef.current = []
  }, [])

  // Start procedural sound based on preset
  const startAmbientSound = useCallback(
    (preset) => {
      stopAmbientSound()
      if (preset === 'none') return

      try {
        const ctx = getAudioContext()
        if (!ctx || !masterGainRef.current) return

        const bufferSize = ctx.sampleRate * 4
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
        const data = buffer.getChannelData(0)

        if (preset === 'brown') {
          // Brownian Noise: Integrated white noise for deep warm focus rumble
          let lastOut = 0.0
          for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1
            data[i] = (lastOut + 0.02 * white) / 1.02
            lastOut = data[i]
            data[i] *= 3.5 // Boost gain
          }

          const noiseSource = ctx.createBufferSource()
          noiseSource.buffer = buffer
          noiseSource.loop = true

          const filter = ctx.createBiquadFilter()
          filter.type = 'lowpass'
          filter.frequency.setValueAtTime(320, ctx.currentTime)

          noiseSource.connect(filter)
          filter.connect(masterGainRef.current)
          noiseSource.start()

          soundNodesRef.current = [noiseSource, filter]
        } else if (preset === 'pink') {
          // Pink Noise / Rain simulation (Paul Kellet's filter)
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
          filter.connect(masterGainRef.current)
          noiseSource.start()

          soundNodesRef.current = [noiseSource, filter]
        } else if (preset === 'gamma40') {
          // 40Hz Isochronic Gamma Pulse (Carrier 180Hz modulated at 40Hz)
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
          pulseGain.connect(masterGainRef.current)

          carrier.start()
          lfo.start()

          soundNodesRef.current = [carrier, lfo, pulseGain, lfoGain]
        }
      } catch (err) {
        console.warn('Failed to start ambient sound:', err)
      }
    },
    [getAudioContext, stopAmbientSound]
  )

  // Update volume in real-time
  useEffect(() => {
    if (masterGainRef.current && audioCtxRef.current) {
      masterGainRef.current.gain.setValueAtTime(volume, audioCtxRef.current.currentTime)
    }
  }, [volume])

  // Handle Preset Change
  const handleSelectPreset = (presetId) => {
    setAmbientSound(presetId)
    startAmbientSound(presetId)
  }

  // Switch timer mode
  const handleSwitchMode = (newMode) => {
    setMode(newMode)
    setTimeLeft(MODES[newMode].seconds)
    setIsRunning(false)
  }

  // Reset timer
  const handleReset = () => {
    setTimeLeft(MODES[mode].seconds)
    setIsRunning(false)
  }

  // Toggle Play / Pause
  const handleTogglePlay = () => {
    getAudioContext() // Resume AudioContext if needed
    setIsRunning((prev) => !prev)
  }

  // Timer Tick Engine
  useEffect(() => {
    let timer = null
    if (isRunning) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setIsRunning(false)
            playCompletionChime()
            if (onCompleteSession) {
              onCompleteSession({
                mode,
                modeLabel: MODES[mode].label,
                task
              })
            }
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [isRunning, mode, task, onCompleteSession, playCompletionChime])

  // Document Title Synchronization
  useEffect(() => {
    const originalTitle = document.title
    const timeStr = formatTime(timeLeft)
    document.title = `(${timeStr}) ${MODES[mode].label} • Task Registry`
    return () => {
      document.title = originalTitle
    }
  }, [timeLeft, mode])

  // Keyboard Shortcuts (Space, R, Esc)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        handleTogglePlay()
      } else if (e.key === 'r' || e.key === 'R') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          handleReset()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // Cleanup Web Audio on component unmount
  useEffect(() => {
    return () => {
      stopAmbientSound()
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }
    }
  }, [stopAmbientSound])

  return (
    <div className="focus-overlay" role="dialog" aria-label="Zen Pomodoro Focus Session" aria-modal="true">
      {/* Header */}
      <header className="focus-header">
        <div className="focus-modes-group" role="tablist">
          {Object.entries(MODES).map(([key, config]) => (
            <button
              key={key}
              type="button"
              className={`focus-mode-btn ${mode === key ? 'active' : ''}`}
              onClick={() => handleSwitchMode(key)}
              role="tab"
              aria-selected={mode === key}
            >
              {config.label}
            </button>
          ))}
        </div>

        <div className="focus-header-right">
          <button
            type="button"
            className="btn-focus-close"
            onClick={onClose}
            title="Exit Focus Session (Esc)"
          >
            <span>Exit Session</span>
            <kbd className="key-badge">Esc</kbd>
          </button>
        </div>
      </header>

      {/* Center Stage */}
      <main className="focus-center-stage">
        {/* Giant Monospace Timer */}
        <div
          className="focus-timer-display"
          onClick={handleTogglePlay}
          title="Click or press Spacebar to start/pause"
          aria-live="polite"
        >
          {formatTime(timeLeft)}
        </div>

        {/* Controls */}
        <div className="focus-controls-row">
          <button
            type="button"
            className="btn-timer-primary"
            onClick={handleTogglePlay}
          >
            {isRunning ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
                Pause
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {timeLeft === MODES[mode].seconds ? 'Start Focus' : 'Resume'}
              </>
            )}
          </button>

          <button
            type="button"
            className="btn-timer-secondary"
            onClick={handleReset}
            title="Reset timer (R)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Reset
          </button>
        </div>

        {/* Active Task Context Card */}
        {task && (
          <div className="focus-task-card">
            <div className="focus-task-left">
              {onToggleTask && (
                <button
                  type="button"
                  className={`custom-checkbox-btn ${task.completed ? 'checked' : ''}`}
                  onClick={() => onToggleTask(task)}
                  aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
                >
                  {task.completed && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )}
              <span className={`focus-task-title ${task.completed ? 'completed' : ''}`}>
                {task.title}
              </span>
            </div>
            <span className="focus-task-tag">{task.category || 'General'}</span>
          </div>
        )}
      </main>

      {/* Footer & Ambient Sound Generator */}
      <footer className="focus-footer">
        <div className="ambient-audio-bar">
          <div className="ambient-presets-group">
            <span className="ambient-label">Ambient Sound:</span>
            {AMBIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`ambient-preset-btn ${ambientSound === preset.id ? 'active' : ''}`}
                onClick={() => handleSelectPreset(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {ambientSound !== 'none' && (
            <div className="ambient-volume-group">
              <span className="ambient-label">Vol:</span>
              <input
                type="range"
                className="volume-slider"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                aria-label="Ambient sound volume"
              />
            </div>
          )}
        </div>

        <div className="focus-shortcuts-legend">
          <span><kbd className="key-badge">Space</kbd> Start / Pause</span>
          <span><kbd className="key-badge">R</kbd> Reset</span>
          <span><kbd className="key-badge">Esc</kbd> Exit</span>
        </div>
      </footer>
    </div>
  )
}
