import { useState, useEffect, useMemo, useRef } from 'react'
import {
  getWeekDays,
  getMonthMatrix,
  isSameDay,
  formatDayHeader,
  formatFullDate,
  formatMonthYear,
  formatHour,
  formatTimeShort
} from '../utils/chronosEngine.js'
import { formatToLocalISOString, getLocalTimezoneOffsetString } from '../utils/aiService.js'
import './ChronosCalendar.css'

const CATEGORIES = ['General', 'Engineering', 'Design', 'Personal']
const PRIORITIES = ['low', 'medium', 'high']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function ChronosCalendar({
  tasks = [],
  todos = [],
  onStartFocusSession,
  onToggleTask = () => {},
  onUpdateTask = () => {},
  onCreateTask = () => {},
  onDeleteTask = () => {},
  showToast = () => {}
}) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState('week') // 'week' | 'day' | 'month'
  const [autoMorphEnabled, setAutoMorphEnabled] = useState(true)
  const [draggedTask, setDraggedTask] = useState(null)
  const [dragOverSlot, setDragOverSlot] = useState(null)
  const [isBacklogDragOver, setIsBacklogDragOver] = useState(false)

  // Modal State for task scheduling/editing
  const [modalState, setModalState] = useState({
    isOpen: false,
    mode: 'edit',
    taskData: null
  })

  // Unified todos as Single Source of Truth
  const allTodos = useMemo(() => {
    return todos && todos.length > 0 ? todos : tasks || []
  }, [todos, tasks])

  // Scheduled tasks (tasks with valid due_date/dueDate/start_time)
  const scheduledTasks = useMemo(() => {
    return allTodos.filter((t) => {
      const rawDate = t.due_date || t.dueDate || t.start_time
      if (!rawDate) return false
      const d = new Date(rawDate)
      return !isNaN(d.getTime())
    })
  }, [allTodos])

  // Unscheduled backlog tasks (tasks in registry with NO deadline and NOT completed)
  const unscheduledTasks = useMemo(() => {
    return allTodos.filter((t) => {
      if (t.completed) return false
      const rawDate = t.due_date || t.dueDate || t.start_time
      return !rawDate || isNaN(new Date(rawDate).getTime())
    })
  }, [allTodos])

  // Date range computations
  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate])
  const monthDays = useMemo(() => getMonthMatrix(currentDate), [currentDate])
  const displayedDays = viewMode === 'day' ? [currentDate] : weekDays

  const dateRangeTitle = useMemo(() => {
    if (viewMode === 'month') {
      return formatMonthYear(currentDate)
    }
    if (viewMode === 'day') {
      return formatFullDate(currentDate)
    }
    const first = weekDays[0]
    const last = weekDays[6]
    return `${formatDayHeader(first)} — ${formatDayHeader(last)}`
  }, [viewMode, currentDate, weekDays])

  // Auto-scroll timeline to 08:00 AM on initial load
  const gridContainerRef = useRef(null)
  useEffect(() => {
    if (gridContainerRef.current) {
      // 8 AM * 48px height per hour
      gridContainerRef.current.scrollTop = 384
    }
  }, [])

  // Navigation handlers
  const handlePrev = () => {
    const d = new Date(currentDate)
    if (viewMode === 'month') {
      d.setMonth(d.getMonth() - 1)
    } else if (viewMode === 'day') {
      d.setDate(d.getDate() - 1)
    } else {
      d.setDate(d.getDate() - 7)
    }
    setCurrentDate(d)
  }

  const handleNext = () => {
    const d = new Date(currentDate)
    if (viewMode === 'month') {
      d.setMonth(d.getMonth() + 1)
    } else if (viewMode === 'day') {
      d.setDate(d.getDate() + 1)
    } else {
      d.setDate(d.getDate() + 7)
    }
    setCurrentDate(d)
  }

  const handleToday = () => {
    setCurrentDate(new Date())
  }

  // Drag and drop handlers
  const handleTaskDragStart = (e, task) => {
    setDraggedTask(task)
    try {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'task', id: task.id }))
      e.dataTransfer.setData('text/plain', task.id || '')
      e.dataTransfer.effectAllowed = 'copyMove'
    } catch {
      // ignore
    }
  }

  const handleSlotDragOver = (e, slotKey) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverSlot(slotKey)
  }

  const handleSlotDragLeave = () => {
    setDragOverSlot(null)
  }

  // Drop task onto a day & hour slot to schedule/reschedule
  const handleSlotDrop = async (e, date, hour) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverSlot(null)

    let targetTask = draggedTask
    if (!targetTask) {
      try {
        const raw = e.dataTransfer.getData('application/json')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed?.id) {
            targetTask = allTodos.find((t) => t.id === parsed.id)
          }
        }
      } catch {
        // ignore
      }
    }

    setDraggedTask(null)
    if (!targetTask) return

    const newStart = new Date(date)
    newStart.setHours(hour, 0, 0, 0)
    const newISO = formatToLocalISOString(newStart)

    try {
      await onUpdateTask(targetTask.id, {
        due_date: newISO,
        duration_minutes: targetTask.duration_minutes || 30
      })
      showToast(`Jadwal "${targetTask.title}" diatur pukul ${formatHour(hour)}.`)
    } catch (err) {
      console.error('Failed to schedule task:', err)
      showToast(err.message || 'Gagal mengatur jadwal tugas', 'error')
    }
  }

  // Unschedule dropped task back to backlog
  const handleBacklogDrop = async (e) => {
    e.preventDefault()
    setIsBacklogDragOver(false)
    let targetTask = draggedTask
    setDraggedTask(null)

    if (!targetTask) {
      try {
        const raw = e.dataTransfer.getData('application/json')
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed?.id) {
            targetTask = allTodos.find((t) => t.id === parsed.id)
          }
        }
      } catch {
        // ignore
      }
    }

    if (!targetTask) return

    try {
      await onUpdateTask(targetTask.id, { due_date: null })
      showToast(`Tugas "${targetTask.title}" dipindahkan kembali ke backlog.`)
    } catch (err) {
      console.error('Failed to unschedule task:', err)
      showToast(err.message || 'Gagal memindahkan tugas ke backlog', 'error')
    }
  }

  // Handle slot click (create new task at clicked date & hour)
  const handleSlotClick = (date, hour = 9) => {
    const start = new Date(date)
    start.setHours(hour, 0, 0, 0)
    const iso = formatToLocalISOString(start)

    setModalState({
      isOpen: true,
      mode: 'create',
      taskData: {
        title: '',
        category: 'General',
        priority: 'medium',
        due_date: iso,
        duration_minutes: 30
      }
    })
  }

  // Open edit modal for an existing task
  const handleTaskClick = (task, e) => {
    if (e) e.stopPropagation()
    setModalState({
      isOpen: true,
      mode: 'edit',
      taskData: { ...task }
    })
  }

  // Save Modal Changes
  const handleSaveModal = async (e) => {
    e.preventDefault()
    const data = modalState.taskData
    if (!data || !data.title?.trim()) return

    try {
      if (modalState.mode === 'create') {
        await onCreateTask({
          title: data.title.trim(),
          category: data.category || 'General',
          priority: (data.priority || 'medium').toLowerCase(),
          due_date: data.due_date,
          duration_minutes: data.duration_minutes || 30
        })
        showToast(`Tugas "${data.title}" berhasil dijadwalkan.`)
      } else {
        await onUpdateTask(data.id, {
          title: data.title.trim(),
          category: data.category || 'General',
          priority: (data.priority || 'medium').toLowerCase(),
          due_date: data.due_date,
          duration_minutes: data.duration_minutes || 30
        })
        showToast(`Tugas "${data.title}" diperbarui.`)
      }
      setModalState({ isOpen: false, mode: 'edit', taskData: null })
    } catch (err) {
      console.error('Failed to save task:', err)
      showToast(err.message || 'Gagal menyimpan tugas', 'error')
    }
  }

  // Delete Task from Modal
  const handleDeleteFromModal = async () => {
    const data = modalState.taskData
    if (!data?.id) return
    try {
      await onDeleteTask(data.id)
      showToast(`Tugas "${data.title}" dihapus.`)
      setModalState({ isOpen: false, mode: 'edit', taskData: null })
    } catch (err) {
      console.error('Failed to delete task:', err)
      showToast(err.message || 'Gagal menghapus tugas', 'error')
    }
  }

  // Current live time indicator calculation (updates every minute)
  const [nowDate, setNowDate] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setNowDate(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  const currentDayTopPercent = useMemo(() => {
    const minutes = nowDate.getHours() * 60 + nowDate.getMinutes()
    return (minutes / 1440) * 100
  }, [nowDate])

  return (
    <div className="chronos-container" role="region" aria-label="Chronos Calendar">
      {/* 1. Sleek Utilitarian Calendar Header */}
      <header className="chronos-header">
        <div className="chronos-nav-group">
          <button
            type="button"
            className="chronos-btn-today"
            onClick={handleToday}
            title="Jump to Today"
          >
            Today
          </button>
          <div className="chronos-nav-chevrons">
            <button
              type="button"
              className="chronos-btn-chevron"
              onClick={handlePrev}
              title="Previous period"
              aria-label="Previous period"
            >
              ‹
            </button>
            <button
              type="button"
              className="chronos-btn-chevron"
              onClick={handleNext}
              title="Next period"
              aria-label="Next period"
            >
              ›
            </button>
          </div>
          <span className="chronos-date-title">{dateRangeTitle}</span>
        </div>

        <div className="chronos-nav-group">
          {/* Velocity Auto-Morph Shield Toggle */}
          <button
            type="button"
            className={`chronos-morph-status-btn ${autoMorphEnabled ? 'active' : ''}`}
            onClick={() => {
              const nextVal = !autoMorphEnabled
              setAutoMorphEnabled(nextVal)
              showToast(nextVal ? '⚡ Auto-Morph Shield: ACTIVE' : 'Auto-Morph Shield: PAUSED')
            }}
            title="Toggle Velocity-Driven Overlap Shield"
          >
            <span className="morph-pulse-dot" />
            <span>Auto-Morph: {autoMorphEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* View Switch (Week / Day / Month) */}
          <div className="chronos-view-switch" role="tablist">
            <button
              type="button"
              className={`chronos-view-btn ${viewMode === 'week' ? 'active' : ''}`}
              onClick={() => setViewMode('week')}
              role="tab"
              aria-selected={viewMode === 'week'}
            >
              Week
            </button>
            <button
              type="button"
              className={`chronos-view-btn ${viewMode === 'day' ? 'active' : ''}`}
              onClick={() => setViewMode('day')}
              role="tab"
              aria-selected={viewMode === 'day'}
            >
              Day
            </button>
            <button
              type="button"
              className={`chronos-view-btn ${viewMode === 'month' ? 'active' : ''}`}
              onClick={() => setViewMode('month')}
              role="tab"
              aria-selected={viewMode === 'month'}
            >
              Month
            </button>
          </div>
        </div>
      </header>

      {/* 2. Horizontal Compact Backlog Strip (Replaces vertical sidebar) */}
      <div
        className={`chronos-backlog-strip ${isBacklogDragOver ? 'drag-over-unschedule' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsBacklogDragOver(true)
        }}
        onDragLeave={() => setIsBacklogDragOver(false)}
        onDrop={handleBacklogDrop}
        title={isBacklogDragOver ? 'Drop here to unschedule task back to backlog' : undefined}
      >
        <div className="chronos-backlog-header">
          <span className="chronos-backlog-label">
            {isBacklogDragOver ? (
              '↩ Drop to Unschedule'
            ) : (
              <>
                <span>📦 Unscheduled Backlog</span>
                <span className="chronos-backlog-count">{unscheduledTasks.length}</span>
              </>
            )}
          </span>
          <span className="chronos-backlog-hint">Drag any chip onto calendar to schedule</span>
        </div>

        <div className="chronos-backlog-chips-row">
          {unscheduledTasks.length === 0 ? (
            <span className="chronos-backlog-empty">✓ All tasks are scheduled on calendar</span>
          ) : (
            unscheduledTasks.map((task) => (
              <div
                key={task.id}
                className={`chronos-backlog-chip priority-${(task.priority || 'medium').toLowerCase()}`}
                draggable
                onDragStart={(e) => handleTaskDragStart(e, task)}
                onClick={(e) => handleTaskClick(task, e)}
                title="Drag onto calendar slot to schedule, or click to edit"
              >
                <span className={`category-indicator-dot ${task.category || 'General'}`} />
                <span className="backlog-chip-title">{task.title}</span>
                <span className={`backlog-chip-prio prio-${(task.priority || 'medium').toLowerCase()}`}>
                  {(task.priority || 'M').charAt(0).toUpperCase()}
                </span>
                <span className="backlog-chip-drag">⋮⋮</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 3. Full-Width Calendar Grid Viewports */}
      <div className="chronos-body full-width-body">
        {viewMode === 'month' ? (
          /* ================= Month View ================= */
          <div className="chronos-month-viewport">
            <div className="chronos-month-grid-header">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName) => (
                <div key={dayName} className="chronos-month-header-cell">
                  {dayName}
                </div>
              ))}
            </div>

            <div className="chronos-month-grid">
              {monthDays.map((cellDate, idx) => {
                const isCurrentMonth = cellDate.getMonth() === currentDate.getMonth()
                const isToday = isSameDay(cellDate, nowDate)
                const dayTasks = scheduledTasks.filter((t) => {
                  const raw = t.due_date || t.dueDate || t.start_time
                  return raw && isSameDay(new Date(raw), cellDate)
                })

                return (
                  <div
                    key={idx}
                    className={`chronos-month-cell ${!isCurrentMonth ? 'outside-month' : ''} ${isToday ? 'today' : ''}`}
                    onClick={() => handleSlotClick(cellDate, 9)}
                    onDragOver={(e) => handleSlotDragOver(e, `month-${idx}`)}
                    onDragLeave={handleSlotDragLeave}
                    onDrop={(e) => handleSlotDrop(e, cellDate, 9)}
                  >
                    <div className="chronos-month-cell-header">
                      <span className={`chronos-month-day-num ${isToday ? 'today-pill' : ''}`}>
                        {cellDate.getDate()}
                      </span>
                    </div>

                    <div className="chronos-month-events-stack">
                      {dayTasks.slice(0, 4).map((task) => (
                        <div
                          key={task.id}
                          className={`chronos-month-event-pill priority-${(task.priority || 'medium').toLowerCase()} ${task.completed ? 'completed' : ''}`}
                          onClick={(e) => handleTaskClick(task, e)}
                          title={`${task.title} (${formatTimeShort(task.due_date || task.dueDate || task.start_time)})`}
                        >
                          <span className="month-event-time">
                            {formatTimeShort(task.due_date || task.dueDate || task.start_time)}
                          </span>
                          <span className="month-event-title">{task.title}</span>
                        </div>
                      ))}
                      {dayTasks.length > 4 && (
                        <div className="chronos-month-more-badge">
                          +{dayTasks.length - 4} more
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* ================= Week & Day View (Full-Width Time Grid) ================= */
          <div className="chronos-viewport" ref={gridContainerRef}>
            {/* Days Header Column Bar */}
            <div className="chronos-grid-header">
              <div className="chronos-time-gutter-header">
                <span style={{ fontSize: '10px', color: '#52525b', fontFamily: 'monospace' }}>
                  {getLocalTimezoneOffsetString(nowDate)}
                </span>
              </div>
              <div className="chronos-days-header-row">
                {displayedDays.map((day, idx) => {
                  const isToday = isSameDay(day, nowDate)
                  return (
                    <div
                      key={idx}
                      className={`chronos-day-col-header ${isToday ? 'today' : ''}`}
                    >
                      <span className="day-name">{new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(day)}</span>
                      <span className={`day-number ${isToday ? 'today-circle' : ''}`}>{day.getDate()}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Scrollable 24-Hour Grid Body */}
            <div className="chronos-grid-body">
              {/* Left Time Label Gutter */}
              <div className="chronos-time-gutter">
                {HOURS.map((hour) => (
                  <div key={hour} className="chronos-time-label">
                    <span>{formatHour(hour)}</span>
                  </div>
                ))}
              </div>

              {/* Day Columns Container */}
              <div className="chronos-day-columns">
                {displayedDays.map((day, dayIdx) => {
                  const isToday = isSameDay(day, nowDate)
                  const dayEvents = scheduledTasks.filter((t) => {
                    const raw = t.due_date || t.dueDate || t.start_time
                    return raw && isSameDay(new Date(raw), day)
                  })

                  return (
                    <div
                      key={dayIdx}
                      className={`chronos-day-column ${isToday ? 'today-column' : ''}`}
                    >
                      {/* Hour Slot Drop Targets */}
                      {HOURS.map((hour) => {
                        const slotKey = `${dayIdx}-${hour}`
                        const isDragOver = dragOverSlot === slotKey

                        return (
                          <div
                            key={hour}
                            className={`chronos-hour-slot ${isDragOver ? 'drag-over' : ''}`}
                            onClick={() => handleSlotClick(day, hour)}
                            onDragOver={(e) => handleSlotDragOver(e, slotKey)}
                            onDragLeave={handleSlotDragLeave}
                            onDrop={(e) => handleSlotDrop(e, day, hour)}
                            title={`Click or drop to schedule at ${formatHour(hour)}`}
                          />
                        )
                      })}

                      {/* Live Current Time Red Line Indicator */}
                      {isToday && (
                        <div
                          className="chronos-current-time-line"
                          style={{ top: `${currentDayTopPercent}%` }}
                        >
                          <div className="chronos-current-time-dot" />
                        </div>
                      )}

                      {/* Scheduled Tasks Rendered with Exact Timezone Positioning */}
                      {dayEvents.map((task) => {
                        const rawStart = task.due_date || task.dueDate || task.start_time
                        const s = new Date(rawStart)
                        const startHour = s.getHours()
                        const startMin = s.getMinutes()
                        const duration = task.duration_minutes || 30

                        // Precise top and height percentages within the 1440-minute day
                        const topPercent = ((startHour * 60 + startMin) / 1440) * 100
                        const heightPercent = Math.max(2.5, (duration / 1440) * 100)
                        const isDone = Boolean(task.completed)

                        return (
                          <div
                            key={task.id}
                            className={`chronos-event-card priority-${(task.priority || 'medium').toLowerCase()} ${isDone ? 'completed' : ''}`}
                            style={{
                              top: `${topPercent}%`,
                              height: `${heightPercent}%`,
                              zIndex: 10
                            }}
                            draggable={!isDone}
                            onDragStart={(e) => handleTaskDragStart(e, task)}
                            onClick={(e) => handleTaskClick(task, e)}
                            title={`${task.title} • ${formatTimeShort(s)} (${duration}m)`}
                          >
                            <div className="chronos-event-content">
                              <div className="chronos-event-header">
                                <span className="chronos-event-time">
                                  {formatTimeShort(s)}
                                </span>
                                <div className="chronos-event-quick-actions" onClick={(e) => e.stopPropagation()}>
                                  {onStartFocusSession && !isDone && (
                                    <button
                                      type="button"
                                      className="chronos-event-focus-btn"
                                      onClick={() => onStartFocusSession(task)}
                                      title="Start Focus Session (F)"
                                    >
                                      ⚡
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={`chronos-event-check-btn ${isDone ? 'checked' : ''}`}
                                    onClick={() => onToggleTask(task)}
                                    title={isDone ? 'Mark uncompleted' : 'Mark completed'}
                                  >
                                    {isDone ? '✓' : '○'}
                                  </button>
                                </div>
                              </div>
                              <span className="chronos-event-title">{task.title}</span>
                              <div className="chronos-event-meta">
                                <span className="chronos-event-cat">{task.category || 'General'}</span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Task Modal (Create / Edit Scheduled Task) */}
      {modalState.isOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setModalState({ isOpen: false, mode: 'edit', taskData: null })}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="modal-content chronos-edit-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '440px' }}
          >
            <div className="modal-header">
              <h3>{modalState.mode === 'create' ? '🗓️ Schedule Task' : '✏️ Edit Scheduled Task'}</h3>
              <button
                type="button"
                className="toast-close-btn"
                onClick={() => setModalState({ isOpen: false, mode: 'edit', taskData: null })}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveModal}>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 600 }}>Task Title</label>
                <input
                  type="text"
                  autoFocus
                  required
                  className="task-input-primary"
                  value={modalState.taskData?.title || ''}
                  onChange={(e) =>
                    setModalState((prev) => ({
                      ...prev,
                      taskData: { ...prev.taskData, title: e.target.value }
                    }))
                  }
                  placeholder="e.g. Memakan daging, Meeting klien..."
                  style={{ width: '100%', marginTop: '4px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 600 }}>Category</label>
                  <select
                    className="task-input-primary"
                    value={modalState.taskData?.category || 'General'}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        taskData: { ...prev.taskData, category: e.target.value }
                      }))
                    }
                    style={{ width: '100%', marginTop: '4px' }}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 600 }}>Priority</label>
                  <select
                    className="task-input-primary"
                    value={(modalState.taskData?.priority || 'medium').toLowerCase()}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        taskData: { ...prev.taskData, priority: e.target.value }
                      }))
                    }
                    style={{ width: '100%', marginTop: '4px' }}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 600 }}>Date & Time</label>
                  <input
                    type="datetime-local"
                    className="task-input-primary"
                    value={
                      modalState.taskData?.due_date
                        ? modalState.taskData.due_date.slice(0, 16)
                        : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value
                      if (val) {
                        const d = new Date(val)
                        setModalState((prev) => ({
                          ...prev,
                          taskData: {
                            ...prev.taskData,
                            due_date: formatToLocalISOString(d)
                          }
                        }))
                      }
                    }}
                    style={{ width: '100%', marginTop: '4px', fontSize: '11px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 600 }}>Duration (Minutes)</label>
                  <input
                    type="number"
                    min="15"
                    step="15"
                    className="task-input-primary"
                    value={modalState.taskData?.duration_minutes || 30}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        taskData: {
                          ...prev.taskData,
                          duration_minutes: parseInt(e.target.value, 10) || 30
                        }
                      }))
                    }
                    style={{ width: '100%', marginTop: '4px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {modalState.mode === 'edit' ? (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={handleDeleteFromModal}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Delete Task
                  </button>
                ) : <span />}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setModalState({ isOpen: false, mode: 'edit', taskData: null })}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {modalState.mode === 'create' ? 'Schedule' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
