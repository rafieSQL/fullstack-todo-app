import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useFocus } from '../context/useFocus.js'
import { formatFocusTime, MODES } from '../context/focusConstants.js'
import { validateTaskTitle } from '../utils/sanitize.js'
import './FocusSession.css'

const CATEGORY_MAP = {
  General: 'GEN',
  Engineering: 'ENG',
  Design: 'DES',
  Personal: 'PERS'
}

const CATEGORY_KEYS = ['General', 'Engineering', 'Design', 'Personal']
const PRIORITY_KEYS = ['low', 'medium', 'high']

export default function FocusMiniPlayer({ tasks = [], onToggleTask, onQuickAddTask, busyTaskIds = new Set() }) {
  const {
    mode,
    timeLeft,
    isRunning,
    sessionGoal,
    activeTask,
    togglePlay,
    expandSession,
    endSession,
    setActiveTask
  } = useFocus()

  // Draggable position state
  const [position, setPosition] = useState(() => ({
    x: Math.max(20, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 370),
    y: Math.max(20, (typeof window !== 'undefined' ? window.innerHeight : 800) - 340)
  }))

  const [isDragging, setIsDragging] = useState(false)
  const [quickTitle, setQuickTitle] = useState('')
  const [quickCategory, setQuickCategory] = useState('General')
  const [quickPriority, setQuickPriority] = useState('medium')
  const [isAdding, setIsAdding] = useState(false)

  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const playerRef = useRef(null)

  // Active Pending Tasks (ALL active items)
  const activePendingTasks = useMemo(() => {
    return (tasks || []).filter((t) => !t.completed)
  }, [tasks])

  // Handle window resizing to keep widget within viewport
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => ({
        x: Math.min(prev.x, window.innerWidth - 300),
        y: Math.min(prev.y, window.innerHeight - 240)
      }))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Drag start handler (only triggers on the header drag handle)
  const handleMouseDown = (e) => {
    if (
      e.target.closest('button') ||
      e.target.closest('input') ||
      e.target.closest('.mini-tasks-container') ||
      e.target.closest('.mini-quick-add-form')
    ) {
      return
    }

    setIsDragging(true)
    dragOffsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    }
  }

  // Mouse move and mouse up listeners for smooth dragging
  const handleMouseMove = useCallback(
    (e) => {
      if (!isDragging) return

      const newX = e.clientX - dragOffsetRef.current.x
      const newY = e.clientY - dragOffsetRef.current.y

      const clampedX = Math.max(10, Math.min(newX, window.innerWidth - 290))
      const clampedY = Math.max(10, Math.min(newY, window.innerHeight - 230))

      setPosition({ x: clampedX, y: clampedY })
    },
    [isDragging]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    } else {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Quick Task Add Handler (Never overwrites current session goal!)
  const handleQuickSubmit = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const validation = validateTaskTitle(quickTitle)
    if (!validation.isValid || isAdding) return

    setIsAdding(true)
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
      console.error('Failed to quick add in mini-player:', err)
    } finally {
      setIsAdding(false)
    }
  }

  // Select/Target Task as active focus target (NEVER alters sessionGoal!)
  const handleSelectGoalTask = (task, e) => {
    if (e) e.stopPropagation()
    setActiveTask((prev) => (prev?.id === task.id ? null : task))
  }

  return (
    <div
      ref={playerRef}
      className="focus-mini-player"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`
      }}
      role="region"
      aria-label="Floating Pomodoro Focus Mini Player"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header bar (Drag Handle) */}
      <div
        className="mini-player-header"
        onMouseDown={handleMouseDown}
        title="Click and drag to reposition widget"
      >
        <div className="mini-header-left">
          <span className="mini-drag-dots" aria-hidden="true">⋮⋮</span>
          <span className="mini-mode-badge">{MODES[mode]?.label || 'FOCUS'}</span>
        </div>

        <div className="mini-header-actions">
          {/* Expand to Fullscreen */}
          <button
            type="button"
            className="btn-mini-action"
            onClick={(e) => {
              e.stopPropagation()
              expandSession()
            }}
            title="Expand to Fullscreen"
            aria-label="Expand to Fullscreen"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>

          {/* End Session */}
          <button
            type="button"
            className="btn-mini-action close"
            onClick={(e) => {
              e.stopPropagation()
              endSession()
            }}
            title="End Focus Session"
            aria-label="End Focus Session"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Timer & Current Active Goal */}
      <div className="mini-player-body">
        <div className="mini-body-left">
          <div className="mini-timer-digits">
            {formatFocusTime(timeLeft)}
          </div>
          <div className="mini-goal-title" title={sessionGoal || activeTask?.title || 'Deep Work Session'}>
            {sessionGoal || activeTask?.title || 'Deep Work Session'}
          </div>
        </div>

        <div className="mini-controls-right">
          <button
            type="button"
            className="btn-mini-play"
            onClick={(e) => {
              e.stopPropagation()
              togglePlay()
            }}
            title={isRunning ? 'Pause' : 'Resume'}
            aria-label={isRunning ? 'Pause' : 'Resume'}
          >
            {isRunning ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '1px' }}>
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Active Tasks Sub-List (Scrollable Flex Container) */}
      <div className="mini-tasks-container">
        <div className="mini-tasks-header">
          <span>Active Backlog</span>
          <span>{activePendingTasks.length} pending</span>
        </div>

        {activePendingTasks.length === 0 ? (
          <div className="mini-empty-state">All pending tasks clear.</div>
        ) : (
          activePendingTasks.map((task) => {
            const isTarget = activeTask?.id === task.id
            const isBusy = busyTaskIds.has(task.id)
            return (
              <div
                key={task.id}
                className={`mini-task-item ${isTarget ? 'is-active-goal' : ''}`}
                onClick={(e) => handleSelectGoalTask(task, e)}
              >
                <button
                  type="button"
                  className={`mini-checkbox-btn ${task.completed ? 'checked' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleTask(task)
                  }}
                  disabled={isBusy}
                  aria-label={`Mark "${task.title}" as complete`}
                  title={isBusy ? 'Saving...' : 'Mark completed'}
                >
                  {task.completed && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>

                <span
                  className="mini-task-text"
                  title={`Click to set focus on: ${task.title}`}
                >
                  {task.title}
                </span>

                <span className="mini-tag-badge">
                  {CATEGORY_MAP[task.category] || 'GEN'}
                </span>

                <span
                  className={`mini-priority-dot ${task.priority || 'medium'}`}
                  title={`Priority: ${task.priority || 'medium'}`}
                />
              </div>
            )
          })
        )}
      </div>

      {/* In-Widget Quick Task Creator */}
      <form onSubmit={handleQuickSubmit} className="mini-quick-add-form">
        <div className="mini-quick-input-row">
          <input
            type="text"
            className="mini-quick-input"
            placeholder="+ Quick task (Enter ↵)"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            maxLength={200}
            disabled={isAdding}
          />
          <button
            type="submit"
            className="btn-mini-quick-submit"
            disabled={!quickTitle.trim() || isAdding}
          >
            {isAdding ? '...' : 'Add'}
          </button>
        </div>

        <div className="mini-quick-pills-row">
          {/* Category mini pills */}
          <div className="mini-pills-group">
            {CATEGORY_KEYS.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`btn-mini-pill ${quickCategory === cat ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setQuickCategory(cat)
                }}
                disabled={isAdding}
                title={`Category: ${cat}`}
              >
                {CATEGORY_MAP[cat]}
              </button>
            ))}
          </div>

          {/* Priority mini pills */}
          <div className="mini-pills-group">
            {PRIORITY_KEYS.map((p) => (
              <button
                key={p}
                type="button"
                className={`btn-mini-pill priority-${p} ${quickPriority === p ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setQuickPriority(p)
                }}
                disabled={isAdding}
                title={`Priority: ${p}`}
              >
                {p.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Resize Grip Corner Affordance */}
        <span className="mini-resize-grip" aria-hidden="true" />
      </form>
    </div>
  )
}
