import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useFocus } from '../context/useFocus.js'
import {
  formatFocusTime,
  MODES,
  DURATION_PRESETS,
  AMBIENT_PRESETS
} from '../context/focusConstants.js'
import { validateTaskTitle } from '../utils/sanitize.js'
import './FocusSession.css'

const CATEGORIES = ['General', 'Engineering', 'Design', 'Personal']
const PRIORITIES = ['low', 'medium', 'high']

export default function FocusSession({ tasks = [], onToggleTask, onQuickAddTask, busyTaskIds = new Set() }) {
  const {
    mode,
    customMinutes,
    timeLeft,
    isRunning,
    sessionGoal,
    activeTask,
    ambientPreset,
    ambientVolume,
    isTickingEnabled,
    tickingVolume,
    switchMode,
    setCustomDuration,
    resetTimer,
    togglePlay,
    changeAmbientPreset,
    setAmbientVolume,
    setIsTickingEnabled,
    setTickingVolume,
    setSessionGoal,
    setActiveTask,
    minimizeSession,
    endSession
  } = useFocus()

  const goalInputRef = useRef(null)
  const quickTaskInputRef = useRef(null)

  // In-session Quick Task form state
  const [quickTitle, setQuickTitle] = useState('')
  const [quickCategory, setQuickCategory] = useState('General')
  const [quickPriority, setQuickPriority] = useState('medium')
  const [isAddingTask, setIsAddingTask] = useState(false)

  // Pending tasks sub-backlog in Fullscreen (ALL active tasks)
  const pendingTasks = useMemo(() => {
    return (tasks || []).filter((t) => !t.completed)
  }, [tasks])

  // Draggable Center Stage State
  const [centerOffset, setCenterOffset] = useState({ x: 0, y: 0 })
  const [isDraggingCenter, setIsDraggingCenter] = useState(false)
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startOffsetX: 0, startOffsetY: 0 })

  const handleCenterMouseDown = (e) => {
    setIsDraggingCenter(true)
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startOffsetX: centerOffset.x,
      startOffsetY: centerOffset.y
    }
  }

  const handleCenterMouseMove = useCallback(
    (e) => {
      if (!isDraggingCenter) return
      const dx = e.clientX - dragStartRef.current.mouseX
      const dy = e.clientY - dragStartRef.current.mouseY

      const clampedX = Math.max(-300, Math.min(300, dragStartRef.current.startOffsetX + dx))
      const clampedY = Math.max(-160, Math.min(160, dragStartRef.current.startOffsetY + dy))

      setCenterOffset({ x: clampedX, y: clampedY })
    },
    [isDraggingCenter]
  )

  const handleCenterMouseUp = useCallback(() => {
    setIsDraggingCenter(false)
  }, [])

  useEffect(() => {
    if (isDraggingCenter) {
      window.addEventListener('mousemove', handleCenterMouseMove)
      window.addEventListener('mouseup', handleCenterMouseUp)
    } else {
      window.removeEventListener('mousemove', handleCenterMouseMove)
      window.removeEventListener('mouseup', handleCenterMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleCenterMouseMove)
      window.removeEventListener('mouseup', handleCenterMouseUp)
    }
  }, [isDraggingCenter, handleCenterMouseMove, handleCenterMouseUp])

  // Handle Quick Task Submission (Never overwrites current session goal!)
  const handleQuickTaskSubmit = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const validation = validateTaskTitle(quickTitle)
    if (!validation.isValid || isAddingTask) return

    setIsAddingTask(true)
    try {
      if (onQuickAddTask) {
        await onQuickAddTask({
          title: validation.sanitized,
          category: quickCategory,
          priority: quickPriority
        })
      }
      setQuickTitle('')
    } catch (err) {
      console.error('Failed to quick add task:', err)
    } finally {
      setIsAddingTask(false)
    }
  }

  // Explicitly select a task to target it (NEVER alters sessionGoal!)
  const handleSelectGoalTask = (task, e) => {
    if (e) e.stopPropagation()
    setActiveTask((prev) => (prev?.id === task.id ? null : task))
  }

  // Keyboard Shortcuts (Space, R, Esc to minimize)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        document.activeElement === goalInputRef.current ||
        document.activeElement === quickTaskInputRef.current
      ) {
        if (e.key === 'Escape') {
          document.activeElement?.blur()
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
      {/* Top Header */}
      <header className="focus-header">
        <div className="focus-modes-group" role="tablist">
          {Object.entries(MODES).map(([key, config]) => (
            <button
              key={key}
              type="button"
              className={`focus-mode-btn ${mode === key ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                switchMode(key)
              }}
              role="tab"
              aria-selected={mode === key}
            >
              {config.label}
            </button>
          ))}
        </div>

        {/* Custom Duration Presets & Stepper (Visible in Focus mode) */}
        {mode === 'focus' && (
          <div className="focus-duration-bar">
            <span className="duration-label">Duration:</span>
            {DURATION_PRESETS.map((mins) => (
              <button
                key={mins}
                type="button"
                className={`duration-preset-chip ${customMinutes === mins ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setCustomDuration(mins)
                }}
              >
                {mins}m
              </button>
            ))}

            <div className="duration-stepper" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="btn-stepper"
                onClick={(e) => {
                  e.stopPropagation()
                  setCustomDuration(customMinutes - 5)
                }}
                disabled={customMinutes <= 5}
                title="Decrease duration by 5 minutes"
              >
                −
              </button>
              <input
                type="number"
                className="stepper-input"
                min="1"
                max="180"
                value={customMinutes}
                onChange={(e) => setCustomDuration(parseInt(e.target.value, 10) || 1)}
                aria-label="Custom duration in minutes"
              />
              <button
                type="button"
                className="btn-stepper"
                onClick={(e) => {
                  e.stopPropagation()
                  setCustomDuration(customMinutes + 5)
                }}
                disabled={customMinutes >= 180}
                title="Increase duration by 5 minutes"
              >
                +
              </button>
            </div>
          </div>
        )}

        <div className="focus-header-right">
          {/* Reset Position if moved */}
          {(centerOffset.x !== 0 || centerOffset.y !== 0) && (
            <button
              type="button"
              className="btn-focus-action"
              onClick={(e) => {
                e.stopPropagation()
                setCenterOffset({ x: 0, y: 0 })
              }}
              title="Reset timer stage to center"
            >
              Center View
            </button>
          )}

          {/* Minimize to PiP Mini-Player */}
          <button
            type="button"
            className="btn-focus-action"
            onClick={(e) => {
              e.stopPropagation()
              minimizeSession()
            }}
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
            onClick={(e) => {
              e.stopPropagation()
              endSession()
            }}
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

      {/* Center Stage (Draggable / Repositionable) */}
      <main
        className="focus-center-stage"
        style={{
          transform: `translate(${centerOffset.x}px, ${centerOffset.y}px)`
        }}
      >
        {/* Stage Drag Handle */}
        <div
          className="focus-drag-handle-bar"
          onMouseDown={handleCenterMouseDown}
          title="Click and drag to adjust workspace visual balance"
        >
          <span>⋮⋮ Drag Position</span>
        </div>

        {/* Custom Editable Session Goal / Title */}
        <div className="focus-goal-container" onClick={(e) => e.stopPropagation()}>
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
        <div className="focus-controls-row" onClick={(e) => e.stopPropagation()}>
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
                {timeLeft === (mode === 'focus' ? customMinutes * 60 : (MODES[mode]?.defaultMinutes || 5) * 60)
                  ? 'Start Focus'
                  : 'Resume'}
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

        {/* Zen Focus Backlog List (Bounded scrollable container) */}
        <div className="focus-backlog-container" onClick={(e) => e.stopPropagation()}>
          <div className="focus-backlog-header">
            <span>Focus Backlog ({pendingTasks.length} pending)</span>
            <span style={{ fontSize: '10px', color: 'var(--text-subtle)', fontWeight: 'normal' }}>
              Click item to target
            </span>
          </div>

          <div className="focus-backlog-list">
            {pendingTasks.length === 0 ? (
              <div className="focus-backlog-empty">
                All pending tasks clear. Add a task below to focus.
              </div>
            ) : (
              pendingTasks.map((task) => {
                const isTarget = activeTask?.id === task.id
                const isBusy = busyTaskIds.has(task.id)

                return (
                  <div
                    key={task.id}
                    className={`focus-backlog-item ${isTarget ? 'is-active-target' : ''}`}
                    onClick={(e) => handleSelectGoalTask(task, e)}
                    title={`Click to set "${task.title}" as primary focus target`}
                  >
                    <div className="focus-item-left">
                      {onToggleTask && (
                        <button
                          type="button"
                          className={`custom-checkbox-btn ${task.completed ? 'checked' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleTask(task)
                          }}
                          disabled={isBusy}
                          aria-label={`Mark "${task.title}" as complete`}
                          title={isBusy ? 'Saving...' : 'Mark completed'}
                        >
                          {task.completed && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      )}
                      <span className={`focus-item-title ${task.completed ? 'completed' : ''}`}>
                        {task.title}
                      </span>
                    </div>

                    <div className="focus-item-right">
                      {isTarget && (
                        <span className="focusing-badge">FOCUSING</span>
                      )}
                      <span className="focus-tag-badge">{task.category || 'General'}</span>
                      <span className={`focus-priority-pill ${task.priority || 'medium'}`}>
                        {task.priority || 'medium'}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* In-Session Quick Task Creation Card */}
        <form onSubmit={handleQuickTaskSubmit} className="focus-quick-task-card" onClick={(e) => e.stopPropagation()}>
          <div className="quick-task-input-row">
            <input
              ref={quickTaskInputRef}
              type="text"
              className="quick-task-input"
              placeholder="+ Quick add task to registry... (Enter ↵)"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              maxLength={200}
              disabled={isAddingTask}
            />
            <button
              type="submit"
              className="btn-quick-save"
              disabled={!quickTitle.trim() || isAddingTask}
            >
              {isAddingTask ? 'Saving...' : 'Add Task'}
            </button>
          </div>

          <div className="quick-task-selectors-row">
            {/* Category Selector Pills */}
            <div className="quick-selectors-group">
              <span className="quick-selector-label">Category:</span>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`quick-chip-btn ${quickCategory === cat ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuickCategory(cat)
                  }}
                  disabled={isAddingTask}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Priority Selector Pills */}
            <div className="quick-selectors-group">
              <span className="quick-selector-label">Priority:</span>
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`quick-chip-btn priority-${p} ${quickPriority === p ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuickPriority(p)
                  }}
                  disabled={isAddingTask}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </form>
      </main>

      {/* Footer & Audio Settings */}
      <footer className="focus-footer" onClick={(e) => e.stopPropagation()}>
        {/* Ambient Sound & Mechanical Clock Tick Bar */}
        <div className="ambient-audio-bar">
          <div className="ambient-presets-group">
            <span className="ambient-label">Ambient Sound:</span>
            {AMBIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`ambient-preset-btn ${ambientPreset === preset.id ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  changeAmbientPreset(preset.id)
                }}
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
              onClick={(e) => {
                e.stopPropagation()
                setIsTickingEnabled(!isTickingEnabled)
              }}
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
