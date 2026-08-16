import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  logActivity
} from '../api.js'
import { supabase, isSupabaseConfigured } from '../supabaseClient.js'
import {
  getWeekDays,
  isSameDay,
  formatDayHeader,
  formatFullDate,
  formatHour,
  formatTimeShort,
  getEventPosition,
  morphSchedule
} from '../utils/chronosEngine.js'
import './ChronosCalendar.css'

const CATEGORIES = ['General', 'Engineering', 'Design', 'Personal']
const PRIORITIES = ['low', 'medium', 'high']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function ChronosCalendar({
  tasks = [],
  onStartFocusSession,
  user = null,
  showToast = () => {}
}) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState('week') // 'week' | 'day'
  const [autoMorphEnabled, setAutoMorphEnabled] = useState(true)
  const [events, setEvents] = useState([])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  // Drag-and-drop state
  const [draggedTask, setDraggedTask] = useState(null)
  const [dragOverSlot, setDragOverSlot] = useState(null)

  // Modal State
  const [modalState, setModalState] = useState({
    isOpen: false,
    mode: 'create',
    eventData: null
  })

  // Date Calculations
  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate])

  const dateRangeTitle = useMemo(() => {
    if (viewMode === 'day') {
      return formatFullDate(currentDate)
    }
    const first = weekDays[0]
    const last = weekDays[6]
    return `${formatDayHeader(first)} — ${formatDayHeader(last)}`
  }, [viewMode, currentDate, weekDays])

  // Fetch Calendar Events
  const loadEvents = useCallback(async () => {
    try {
      const data = await getCalendarEvents()
      setEvents(data || [])
    } catch (err) {
      console.error('Failed to load events:', err)
      showToast('Failed to load calendar events.', 'error')
    }
  }, [showToast])

  useEffect(() => {
    let active = true
    async function init() {
      try {
        const data = await getCalendarEvents()
        if (active) setEvents(data || [])
      } catch (err) {
        console.error('Failed to load events:', err)
        if (active) showToast('Failed to load calendar events.', 'error')
      }
    }
    init()
    return () => {
      active = false
    }
  }, [showToast])

  // Supabase Real-Time Channel Subscription
  useEffect(() => {
    if (!isSupabaseConfigured) return

    const channel = supabase
      .channel('realtime_calendar_events')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_events' },
        () => {
          loadEvents()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadEvents])

  // Unassigned Backlog Tasks (tasks without an active scheduled event)
  const unassignedTasks = useMemo(() => {
    const scheduledTaskIds = new Set(events.map((e) => e.task_id).filter(Boolean))
    return tasks.filter((t) => !t.completed && !scheduledTaskIds.has(t.id))
  }, [tasks, events])

  // Date Navigation Handlers
  const handlePrev = () => {
    const d = new Date(currentDate)
    if (viewMode === 'day') {
      d.setDate(d.getDate() - 1)
    } else {
      d.setDate(d.getDate() - 7)
    }
    setCurrentDate(d)
  }

  const handleNext = () => {
    const d = new Date(currentDate)
    if (viewMode === 'day') {
      d.setDate(d.getDate() + 1)
    } else {
      d.setDate(d.getDate() + 7)
    }
    setCurrentDate(d)
  }

  const handleToday = () => {
    setCurrentDate(new Date())
  }

  // Handle Slot Click (Quick Create Event)
  const handleSlotClick = (date, hour) => {
    const start = new Date(date)
    start.setHours(hour, 0, 0, 0)
    const end = new Date(start)
    end.setHours(hour + 1, 0, 0, 0)

    setModalState({
      isOpen: true,
      mode: 'create',
      eventData: {
        title: '',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        category: 'General',
        priority: 'medium',
        auto_morph: true,
        task_id: null
      }
    })
  }

  // Handle Drag from Sidebar & Drop on Calendar Slot
  const handleTaskDragStart = (e, task) => {
    setDraggedTask(task)
    e.dataTransfer.setData('text/plain', task.id)
  }

  const handleSlotDragOver = (e, slotKey) => {
    e.preventDefault()
    setDragOverSlot(slotKey)
  }

  const handleSlotDragLeave = () => {
    setDragOverSlot(null)
  }

  const handleSlotDrop = async (e, date, hour) => {
    e.preventDefault()
    setDragOverSlot(null)
    if (!draggedTask) return

    const start = new Date(date)
    start.setHours(hour, 0, 0, 0)
    const end = new Date(start)
    end.setHours(hour + 1, 0, 0, 0)

    try {
      const created = await createCalendarEvent({
        title: draggedTask.title,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        taskId: draggedTask.id,
        category: draggedTask.category || 'General',
        priority: draggedTask.priority || 'medium',
        autoMorph: true,
        userId: user?.id
      })

      // Run Velocity Auto-Morph Engine
      const updatedList = [...events, created]
      const { morphedEvents, changedEvents } = morphSchedule(updatedList, autoMorphEnabled)

      setEvents(morphedEvents)
      showToast(`Scheduled "${draggedTask.title}" at ${formatHour(hour)}`)
      logActivity({
        type: 'create',
        message: `Scheduled task on calendar: "${draggedTask.title}"`,
        userId: user?.id
      })

      // Persist any shifted events
      if (changedEvents.length > 0) {
        for (const ev of changedEvents) {
          await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
        }
        showToast(`⚡ Auto-Morphed: Shifted ${changedEvents.length} events to prevent overlap.`)
      }
    } catch (err) {
      console.error('Failed to drop task onto calendar:', err)
      showToast('Failed to schedule task.', 'error')
    } finally {
      setDraggedTask(null)
    }
  }

  // Open Event Details / Edit Modal
  const handleEventClick = (e, event) => {
    e.stopPropagation()
    setModalState({
      isOpen: true,
      mode: 'edit',
      eventData: { ...event }
    })
  }

  // Save Modal (Create or Update)
  const handleSaveModal = async (formData) => {
    try {
      if (modalState.mode === 'create') {
        const created = await createCalendarEvent({
          title: formData.title,
          startTime: formData.start_time,
          endTime: formData.end_time,
          taskId: formData.task_id,
          category: formData.category,
          priority: formData.priority,
          autoMorph: formData.auto_morph,
          userId: user?.id
        })

        const updatedList = [...events, created]
        const { morphedEvents, changedEvents } = morphSchedule(updatedList, autoMorphEnabled)
        setEvents(morphedEvents)
        showToast(`Created event "${formData.title}"`)

        if (changedEvents.length > 0) {
          for (const ev of changedEvents) {
            await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
          }
          showToast(`⚡ Auto-Morphed: Shifted ${changedEvents.length} events to prevent overlap.`)
        }
      } else {
        const updated = await updateCalendarEvent(formData.id, formData)
        const updatedList = events.map((e) => (e.id === updated.id ? updated : e))
        const { morphedEvents, changedEvents } = morphSchedule(updatedList, autoMorphEnabled)
        setEvents(morphedEvents)
        showToast(`Updated event "${formData.title}"`)

        if (changedEvents.length > 0) {
          for (const ev of changedEvents) {
            await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
          }
          showToast(`⚡ Auto-Morphed: Shifted ${changedEvents.length} events to prevent overlap.`)
        }
      }
      setModalState({ isOpen: false, mode: 'create', eventData: null })
    } catch (err) {
      console.error('Failed to save event:', err)
      showToast(err.message || 'Failed to save event.', 'error')
    }
  }

  // Delete Event
  const handleDeleteEvent = async (id) => {
    try {
      await deleteCalendarEvent(id)
      setEvents((prev) => prev.filter((e) => e.id !== id))
      setModalState({ isOpen: false, mode: 'create', eventData: null })
      showToast('Event deleted.')
    } catch (err) {
      console.error('Failed to delete event:', err)
      showToast('Failed to delete event.', 'error')
    }
  }

  // Start Focus Session for a Calendar Event
  const handleLaunchFocusFromEvent = (event) => {
    if (onStartFocusSession) {
      const matchedTask = tasks.find((t) => t.id === event.task_id)
      onStartFocusSession(matchedTask || { id: event.id, title: event.title, category: event.category })
      setModalState({ isOpen: false, mode: 'create', eventData: null })
    }
  }

  // Filter events for active view
  const displayedDays = viewMode === 'day' ? [currentDate] : weekDays

  return (
    <div className="chronos-container">
      {/* Top Header */}
      <header className="chronos-header">
        <div className="chronos-nav-group">
          <button type="button" className="chronos-btn-nav" onClick={handleToday}>
            Today
          </button>
          <button type="button" className="chronos-btn-nav" onClick={handlePrev} title="Previous">
            ‹
          </button>
          <button type="button" className="chronos-btn-nav" onClick={handleNext} title="Next">
            ›
          </button>
          <span className="chronos-date-title">{dateRangeTitle}</span>
        </div>

        <div className="chronos-nav-group">
          {/* Velocity Auto-Morph Toggle */}
          <button
            type="button"
            className={`chronos-morph-status-btn ${autoMorphEnabled ? 'active' : ''}`}
            onClick={() => {
              const nextVal = !autoMorphEnabled
              setAutoMorphEnabled(nextVal)
              showToast(nextVal ? '⚡ Auto-Morph Engine: ENABLED' : 'Auto-Morph Engine: PAUSED')
            }}
            title="Toggle Velocity-Driven Time-Morphing Engine"
          >
            <span className="morph-pulse-dot" />
            <span>Auto-Morph: {autoMorphEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* View Switch (Week / Day) */}
          <div className="chronos-view-switch">
            <button
              type="button"
              className={`chronos-view-btn ${viewMode === 'week' ? 'active' : ''}`}
              onClick={() => setViewMode('week')}
            >
              Week
            </button>
            <button
              type="button"
              className={`chronos-view-btn ${viewMode === 'day' ? 'active' : ''}`}
              onClick={() => setViewMode('day')}
            >
              Day
            </button>
          </div>
        </div>
      </header>

      {/* Main Body (Sidebar + Grid) */}
      <div className="chronos-body">
        {/* Unassigned Task Backlog Sidebar */}
        <aside className={`chronos-sidebar ${!isSidebarOpen ? 'collapsed' : ''}`}>
          <div className="chronos-sidebar-header">
            {isSidebarOpen && <span>Backlog ({unassignedTasks.length})</span>}
            <button
              type="button"
              className="chronos-sidebar-toggle"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              title={isSidebarOpen ? 'Collapse sidebar' : 'Expand backlog'}
            >
              {isSidebarOpen ? '◀' : '▶'}
            </button>
          </div>

          {isSidebarOpen && (
            <div className="chronos-sidebar-content">
              {unassignedTasks.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  All tasks scheduled.
                </div>
              ) : (
                unassignedTasks.map((task) => (
                  <div
                    key={task.id}
                    className="chronos-sidebar-task"
                    draggable
                    onDragStart={(e) => handleTaskDragStart(e, task)}
                  >
                    <span className="sidebar-task-title">{task.title}</span>
                    <div className="sidebar-task-meta">
                      <span>{task.category || 'General'}</span>
                      <button
                        type="button"
                        className="sidebar-task-btn"
                        onClick={() => handleSlotClick(currentDate, 9)}
                        title="Click to schedule"
                      >
                        + Plan
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </aside>

        {/* Calendar Grid Area */}
        <div className="chronos-grid-wrapper">
          {/* Days Header */}
          <div className={`chronos-days-header-row ${viewMode === 'day' ? 'day-view' : ''}`}>
            <div className="chronos-time-gutter-header">GMT</div>
            {displayedDays.map((day) => {
              const isToday = isSameDay(day, new Date())
              return (
                <div
                  key={day.toISOString()}
                  className={`chronos-day-col-header ${isToday ? 'is-today' : ''}`}
                >
                  {formatDayHeader(day)}
                </div>
              )
            })}
          </div>

          {/* Timeline Grid */}
          <div className={`chronos-timeline-grid ${viewMode === 'day' ? 'day-view' : ''}`}>
            {/* Time Gutter */}
            <div className="chronos-time-gutter">
              {HOURS.map((hour) => (
                <div key={hour} className="chronos-hour-label">
                  {formatHour(hour)}
                </div>
              ))}
            </div>

            {/* Day Columns */}
            {displayedDays.map((day) => {
              const isToday = isSameDay(day, new Date())
              const dayEvents = events.filter((e) => isSameDay(e.start_time, day))

              return (
                <div
                  key={day.toISOString()}
                  className={`chronos-day-column ${isToday ? 'is-today' : ''}`}
                >
                  {/* Current Time Indicator for Today */}
                  {isToday && (
                    <div
                      className="chronos-current-time-line"
                      style={{
                        top: `${((new Date().getHours() * 60 + new Date().getMinutes()) / 1440) * 100}%`
                      }}
                    />
                  )}

                  {/* 24 Hour Clickable / Droppable Slots */}
                  {HOURS.map((hour) => {
                    const slotKey = `${day.toISOString()}-${hour}`
                    const isOver = dragOverSlot === slotKey

                    return (
                      <div
                        key={hour}
                        className={`chronos-hour-slot ${isOver ? 'drag-over' : ''}`}
                        onClick={() => handleSlotClick(day, hour)}
                        onDragOver={(e) => handleSlotDragOver(e, slotKey)}
                        onDragLeave={handleSlotDragLeave}
                        onDrop={(e) => handleSlotDrop(e, day, hour)}
                        title={`Click to schedule event at ${formatHour(hour)}`}
                      />
                    )
                  })}

                  {/* Scheduled Event Cards */}
                  {dayEvents.map((event) => {
                    const pos = getEventPosition(event.start_time, event.end_time)
                    return (
                      <div
                        key={event.id}
                        className={`chronos-event-card priority-${event.priority || 'medium'} ${event._morphed ? 'morphed' : ''}`}
                        style={{
                          top: pos.top,
                          height: pos.height
                        }}
                        onClick={(e) => handleEventClick(e, event)}
                        title={`${event.title} (${formatTimeShort(event.start_time)} - ${formatTimeShort(event.end_time)})`}
                      >
                        <div className="event-card-header">
                          <span className="event-card-time">
                            {formatTimeShort(event.start_time)} - {formatTimeShort(event.end_time)}
                          </span>
                          {event.auto_morph && (
                            <span className="event-morph-badge" title="Auto-Morph Active">
                              ⚡
                            </span>
                          )}
                        </div>

                        <div className="event-card-title">{event.title}</div>

                        <div className="event-card-footer">
                          <span>{event.category || 'General'}</span>
                          <span>{event.priority}</span>
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

      {/* Create / Edit Modal */}
      {modalState.isOpen && (
        <div
          className="chronos-modal-overlay"
          onClick={() => setModalState({ isOpen: false, mode: 'create', eventData: null })}
        >
          <div className="chronos-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chronos-modal-header">
              <span>{modalState.mode === 'create' ? 'Schedule Event' : 'Edit Event'}</span>
              <button
                type="button"
                className="toast-close-btn"
                onClick={() => setModalState({ isOpen: false, mode: 'create', eventData: null })}
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleSaveModal(modalState.eventData)
              }}
              className="chronos-modal-form"
            >
              <div className="chronos-form-row">
                <label>Title</label>
                <input
                  type="text"
                  className="chronos-input"
                  required
                  value={modalState.eventData?.title || ''}
                  onChange={(e) =>
                    setModalState((prev) => ({
                      ...prev,
                      eventData: { ...prev.eventData, title: e.target.value }
                    }))
                  }
                  placeholder="Event title or milestone..."
                />
              </div>

              <div className="chronos-time-inputs">
                <div className="chronos-form-row">
                  <label>Start Time</label>
                  <input
                    type="datetime-local"
                    className="chronos-input"
                    required
                    value={
                      modalState.eventData?.start_time
                        ? new Date(
                            new Date(modalState.eventData.start_time).getTime() -
                              new Date().getTimezoneOffset() * 60000
                          )
                            .toISOString()
                            .slice(0, 16)
                        : ''
                    }
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        eventData: {
                          ...prev.eventData,
                          start_time: new Date(e.target.value).toISOString()
                        }
                      }))
                    }
                  />
                </div>

                <div className="chronos-form-row">
                  <label>End Time</label>
                  <input
                    type="datetime-local"
                    className="chronos-input"
                    required
                    value={
                      modalState.eventData?.end_time
                        ? new Date(
                            new Date(modalState.eventData.end_time).getTime() -
                              new Date().getTimezoneOffset() * 60000
                          )
                            .toISOString()
                            .slice(0, 16)
                        : ''
                    }
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        eventData: {
                          ...prev.eventData,
                          end_time: new Date(e.target.value).toISOString()
                        }
                      }))
                    }
                  />
                </div>
              </div>

              <div className="chronos-time-inputs">
                <div className="chronos-form-row">
                  <label>Category</label>
                  <select
                    className="chronos-input"
                    value={modalState.eventData?.category || 'General'}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        eventData: { ...prev.eventData, category: e.target.value }
                      }))
                    }
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="chronos-form-row">
                  <label>Priority</label>
                  <select
                    className="chronos-input"
                    value={modalState.eventData?.priority || 'medium'}
                    onChange={(e) =>
                      setModalState((prev) => ({
                        ...prev,
                        eventData: { ...prev.eventData, priority: e.target.value }
                      }))
                    }
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="chronos-form-row" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="auto_morph_checkbox"
                  checked={Boolean(modalState.eventData?.auto_morph)}
                  onChange={(e) =>
                    setModalState((prev) => ({
                      ...prev,
                      eventData: { ...prev.eventData, auto_morph: e.target.checked }
                    }))
                  }
                />
                <label htmlFor="auto_morph_checkbox" style={{ textTransform: 'none', cursor: 'pointer' }}>
                  Enable Velocity Auto-Morph (Auto-ripple on schedule drift)
                </label>
              </div>

              <div className="chronos-modal-actions">
                <div>
                  {modalState.mode === 'edit' && (
                    <button
                      type="button"
                      className="btn-chronos-delete"
                      onClick={() => handleDeleteEvent(modalState.eventData.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {modalState.mode === 'edit' && (
                    <button
                      type="button"
                      className="chronos-btn-nav"
                      onClick={() => handleLaunchFocusFromEvent(modalState.eventData)}
                      title="Launch Zen Focus Session on this task"
                    >
                      ⚡ Focus
                    </button>
                  )}
                  <button type="submit" className="btn-chronos-submit">
                    {modalState.mode === 'create' ? 'Schedule' : 'Save'}
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
