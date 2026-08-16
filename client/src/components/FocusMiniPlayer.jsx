import { useState, useRef, useEffect, useCallback } from 'react'
import { useFocus } from '../context/useFocus.js'
import { formatFocusTime, MODES } from '../context/focusConstants.js'
import './FocusSession.css'

export default function FocusMiniPlayer({ onToggleTask }) {
  const {
    mode,
    timeLeft,
    isRunning,
    sessionGoal,
    activeTask,
    togglePlay,
    expandSession,
    endSession
  } = useFocus()

  // Draggable position state
  const [position, setPosition] = useState(() => ({
    x: Math.max(20, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 344),
    y: Math.max(20, (typeof window !== 'undefined' ? window.innerHeight : 800) - 130)
  }))

  const [isDragging, setIsDragging] = useState(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const playerRef = useRef(null)

  // Handle window resizing to keep widget within viewport
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => ({
        x: Math.min(prev.x, window.innerWidth - 340),
        y: Math.min(prev.y, window.innerHeight - 120)
      }))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Drag start handler
  const handleMouseDown = (e) => {
    if (e.target.closest('button')) return // Don't start drag on buttons

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

      // Clamp within viewport
      const clampedX = Math.max(10, Math.min(newX, window.innerWidth - 340))
      const clampedY = Math.max(10, Math.min(newY, window.innerHeight - 120))

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
    >
      {/* Header bar (Drag Handle) */}
      <div
        className="mini-player-header"
        onMouseDown={handleMouseDown}
        title="Click and drag to reposition"
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
            onClick={expandSession}
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
            onClick={endSession}
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

      {/* Mini Player Body */}
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
          {/* Optional Task Complete Checkbox */}
          {activeTask && onToggleTask && (
            <button
              type="button"
              className={`custom-checkbox-btn ${activeTask.completed ? 'checked' : ''}`}
              onClick={() => onToggleTask(activeTask)}
              title={activeTask.completed ? 'Mark task as active' : 'Mark task as complete'}
              aria-label="Toggle task completion"
            >
              {activeTask.completed && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          )}

          {/* Play/Pause Button */}
          <button
            type="button"
            className="btn-mini-play"
            onClick={togglePlay}
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
    </div>
  )
}
