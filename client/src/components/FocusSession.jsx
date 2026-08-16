import { useEffect, useRef } from 'react'
import { useFocus } from '../context/useFocus.js'
import { formatFocusTime, MODES, AMBIENT_PRESETS } from '../context/focusConstants.js'
import './FocusSession.css'

export default function FocusSession({ onToggleTask }) {
  const {
    mode,
    timeLeft,
    isRunning,
    sessionGoal,
    activeTask,
    ambientPreset,
    ambientVolume,
    isTickingEnabled,
    tickingVolume,
    switchMode,
    resetTimer,
    togglePlay,
    changeAmbientPreset,
    setAmbientVolume,
    setIsTickingEnabled,
    setTickingVolume,
    setSessionGoal,
    minimizeSession,
    endSession
  } = useFocus()

  const goalInputRef = useRef(null)

  // Keyboard Shortcuts (Space, R, Esc to minimize)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts if user is actively typing in the goal input
      if (document.activeElement === goalInputRef.current) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          goalInputRef.current?.blur()
        }
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'r' || e.key === 'R') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          resetTimer()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        minimizeSession()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay, resetTimer, minimizeSession])

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
              onClick={() => switchMode(key)}
              role="tab"
              aria-selected={mode === key}
            >
              {config.label}
            </button>
          ))}
        </div>

        <div className="focus-header-right">
          {/* Minimize to PiP Mini-Player */}
          <button
            type="button"
            className="btn-focus-action"
            onClick={minimizeSession}
            title="Minimize to Floating Mini-Player (Esc)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            <span>Minimize</span>
            <kbd className="key-badge">Esc</kbd>
          </button>

          {/* End Session */}
          <button
            type="button"
            className="btn-focus-action"
            onClick={endSession}
            title="End Session completely"
            style={{ color: 'var(--text-muted)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>End</span>
          </button>
        </div>
      </header>

      {/* Center Stage */}
      <main className="focus-center-stage">
        {/* Custom Editable Session Goal / Title */}
        <div className="focus-goal-container">
          <input
            ref={goalInputRef}
            type="text"
            className="focus-goal-input"
            placeholder="Set a session focus goal... (e.g. Sprint #1)"
            value={sessionGoal}
            onChange={(e) => setSessionGoal(e.target.value)}
            maxLength={100}
            aria-label="Session focus goal"
          />
        </div>

        {/* Giant Monospace Timer */}
        <div
          className="focus-timer-display"
          onClick={togglePlay}
          title="Click or press Spacebar to start/pause"
          aria-live="polite"
        >
          {formatFocusTime(timeLeft)}
        </div>

        {/* Controls */}
        <div className="focus-controls-row">
          <button
            type="button"
            className="btn-timer-primary"
            onClick={togglePlay}
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
            onClick={resetTimer}
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
        {activeTask && (
          <div className="focus-task-card">
            <div className="focus-task-left">
              {onToggleTask && (
                <button
                  type="button"
                  className={`custom-checkbox-btn ${activeTask.completed ? 'checked' : ''}`}
                  onClick={() => onToggleTask(activeTask)}
                  aria-label={`Mark "${activeTask.title}" as ${activeTask.completed ? 'incomplete' : 'complete'}`}
                >
                  {activeTask.completed && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )}
              <span className={`focus-task-title ${activeTask.completed ? 'completed' : ''}`}>
                {activeTask.title}
              </span>
            </div>
            <span className="focus-task-tag">{activeTask.category || 'General'}</span>
          </div>
        )}
      </main>

      {/* Footer & Ambient Sound / Clock Tick Generator */}
      <footer className="focus-footer">
        <div className="ambient-audio-bar">
          <div className="ambient-presets-group">
            <span className="ambient-label">Ambient Sound:</span>
            {AMBIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`ambient-preset-btn ${ambientPreset === preset.id ? 'active' : ''}`}
                onClick={() => changeAmbientPreset(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="ambient-controls-right">
            {/* Ambient Sound Volume */}
            {ambientPreset !== 'none' && (
              <div className="ambient-volume-group">
                <span className="ambient-label">Noise Vol:</span>
                <input
                  type="range"
                  className="volume-slider"
                  min="0"
                  max="1"
                  step="0.05"
                  value={ambientVolume}
                  onChange={(e) => setAmbientVolume(parseFloat(e.target.value))}
                  aria-label="Ambient noise volume"
                />
              </div>
            )}

            {/* Mechanical Clock Ticking Toggle */}
            <button
              type="button"
              className={`btn-tick-toggle ${isTickingEnabled ? 'active' : ''}`}
              onClick={() => setIsTickingEnabled(!isTickingEnabled)}
              title="Toggle rhythmic mechanical clock ticking audio"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 14 10" />
              </svg>
              <span>Tick Sound: {isTickingEnabled ? 'ON' : 'OFF'}</span>
            </button>

            {/* Clock Ticking Volume */}
            {isTickingEnabled && (
              <div className="ambient-volume-group">
                <span className="ambient-label">Tick Vol:</span>
                <input
                  type="range"
                  className="volume-slider"
                  min="0"
                  max="1"
                  step="0.05"
                  value={tickingVolume}
                  onChange={(e) => setTickingVolume(parseFloat(e.target.value))}
                  aria-label="Clock ticking volume"
                />
              </div>
            )}
          </div>
        </div>

        <div className="focus-shortcuts-legend">
          <span><kbd className="key-badge">Space</kbd> Start / Pause</span>
          <span><kbd className="key-badge">R</kbd> Reset</span>
          <span><kbd className="key-badge">Esc</kbd> Minimize to PiP</span>
        </div>
      </footer>
    </div>
  )
}
