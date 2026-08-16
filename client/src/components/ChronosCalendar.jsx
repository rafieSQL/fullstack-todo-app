import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
  getMonthMatrix,
  isSameDay,
  formatDayHeader,
  formatFullDate,
  formatMonthYear,
  formatHour,
  formatTimeShort,
  getDurationMinutes,
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
  onToggleTask,
  user = null,
  showToast = () => {}
}) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState('week') // 'week' | 'day' | 'month'
  const [autoMorphEnabled, setAutoMorphEnabled] = useState(true)
  const [events, setEvents] = useState([])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [isSidebarDragOver, setIsSidebarDragOver] = useState(false)

  // Overdue banner dismissed state
  const [dismissedOverdueIds, setDismissedOverdueIds] = useState(() => new Set())

  // Drag-and-drop state
  const [draggedTask, setDraggedTask] = useState(null)
  const [draggedEvent, setDraggedEvent] = useState(null)
  const [dragOverSlot, setDragOverSlot] = useState(null)

  // Resizing state
  const [resizingEvent, setResizingEvent] = useState(null)
  const resizeStartRef = useRef({ startY: 0, startDuration: 60, event: null })

  // Modal State
  const [modalState, setModalState] = useState({
    isOpen: false,
    mode: 'create',
    eventData: null
  })

  // Live timer tick for overdue checking (updates every 30s)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  // Date Calculations
  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate])
  const monthDays = useMemo(() => getMonthMatrix(currentDate), [currentDate])

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

  // Unassigned Backlog Tasks
  const unassignedTasks = useMemo(() => {
    const scheduledTaskIds = new Set(events.map((e) => e.task_id).filter(Boolean))
    let list = tasks.filter((t) => !t.completed && !scheduledTaskIds.has(t.id))
    if (sidebarSearch.trim()) {
      const query = sidebarSearch.toLowerCase()
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          (t.category && t.category.toLowerCase().includes(query))
      )
    }
    return list
  }, [tasks, events, sidebarSearch])

  // Overdue Events Check
  const activeOverdueEvents = useMemo(() => {
    return events.filter(
      (ev) =>
        !ev.is_completed &&
        new Date(now).getTime() > new Date(ev.end_time).getTime() &&
        !dismissedOverdueIds.has(ev.id)
    )
  }, [events, now, dismissedOverdueIds])

  const topOverdueEvent = activeOverdueEvents[0] || null

  // Date Navigation Handlers
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

  // Handle Slot Click (Quick Create Event)
  const handleSlotClick = (date, hour = 9) => {
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

  // Handle Dragging from Sidebar
  const handleTaskDragStart = (e, task) => {
    setDraggedTask(task)
    setDraggedEvent(null)
    try {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'task', data: task }))
      e.dataTransfer.setData('text/plain', task.id || '')
      e.dataTransfer.effectAllowed = 'copyMove'
    } catch {
      // fallback to state
    }
  }

  // Handle Dragging Scheduled Event on Grid
  const handleEventDragStart = (e, event) => {
    e.stopPropagation()
    setDraggedEvent(event)
    setDraggedTask(null)
    try {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'event', data: event }))
      e.dataTransfer.setData('text/plain', event.id || '')
      e.dataTransfer.effectAllowed = 'move'
    } catch {
      // fallback to state
    }
  }

  // Slot Drag Over & Leave
  const handleSlotDragOver = (e, slotKey) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverSlot(slotKey)
  }

  const handleSlotDragLeave = () => {
    setDragOverSlot(null)
  }

  // Drop on Slot (Schedule Task OR Reschedule Event)
  const handleSlotDrop = async (e, date, hour) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverSlot(null)

    // Resolve drag payload
    let payload = null
    try {
      const jsonStr = e.dataTransfer.getData('application/json')
      if (jsonStr) payload = JSON.parse(jsonStr)
    } catch {
      // ignore
    }

    const isDroppingEvent = payload?.type === 'event' || Boolean(draggedEvent)
    const activeItem = isDroppingEvent ? (payload?.data || draggedEvent) : (payload?.data || draggedTask)

    setDraggedTask(null)
    setDraggedEvent(null)
    if (!activeItem) return

    const start = new Date(date)
    start.setHours(hour, 0, 0, 0)

    if (isDroppingEvent) {
      // Reschedule existing event to new time
      const origStart = new Date(activeItem.start_time).getTime()
      const origEnd = new Date(activeItem.end_time).getTime()
      const durationMs = Math.max(1800000, origEnd - origStart)
      const end = new Date(start.getTime() + durationMs)

      const updatedEvent = {
        ...activeItem,
        start_time: start.toISOString(),
        end_time: end.toISOString()
      }

      // Optimistic state
      const preList = events.map((ev) => (ev.id === activeItem.id ? updatedEvent : ev))
      const { morphedEvents: optMorphed, changedEvents } = morphSchedule(preList, autoMorphEnabled)
      setEvents(optMorphed)
      showToast(`Rescheduled "${activeItem.title}" to ${formatHour(hour)}`)

      try {
        await updateCalendarEvent(activeItem.id, {
          start_time: updatedEvent.start_time,
          end_time: updatedEvent.end_time
        })
        if (changedEvents.length > 0) {
          for (const ev of changedEvents) {
            await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
          }
          showToast(`⚡ Auto-Morphed: Shifted ${changedEvents.length} events to prevent overlap.`)
        }
      } catch (err) {
        console.error('Failed to reschedule event:', err)
        loadEvents()
        showToast('Failed to reschedule event.', 'error')
      }
      return
    }

    // Schedule task from backlog
    const end = new Date(start)
    end.setHours(hour + 1, 0, 0, 0)

    const tempId = `temp-${activeItem.id}-${start.getTime()}`
    const optimisticEvent = {
      id: tempId,
      task_id: activeItem.id,
      title: activeItem.title,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      category: activeItem.category || 'General',
      priority: activeItem.priority || 'medium',
      auto_morph: true,
      is_completed: false,
      created_at: start.toISOString()
    }

    const preList = [...events, optimisticEvent]
    const { morphedEvents: optMorphed } = morphSchedule(preList, autoMorphEnabled)
    setEvents(optMorphed)
    showToast(`Scheduled "${activeItem.title}" at ${formatHour(hour)}`)

    try {
      const created = await createCalendarEvent({
        title: activeItem.title,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        taskId: activeItem.id,
        category: activeItem.category || 'General',
        priority: activeItem.priority || 'medium',
        autoMorph: true,
        userId: user?.id
      })

      const updatedList = events.map((ev) => (ev.id === tempId ? created : ev))
      if (!updatedList.some((ev) => ev.id === created.id)) {
        updatedList.push(created)
      }
      const { morphedEvents, changedEvents } = morphSchedule(updatedList, autoMorphEnabled)
      setEvents(morphedEvents)

      logActivity({
        type: 'create',
        message: `Scheduled task on calendar: "${activeItem.title}"`,
        userId: user?.id
      })

      if (changedEvents.length > 0) {
        for (const ev of changedEvents) {
          if (!ev.id.startsWith('temp-')) {
            await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
          }
        }
        showToast(`⚡ Auto-Morphed: Shifted ${changedEvents.length} events to prevent overlap.`)
      }
    } catch (err) {
      console.error('Failed to drop task onto calendar:', err)
      setEvents((prev) => prev.filter((ev) => ev.id !== tempId))
      showToast(err.message || 'Failed to schedule task.', 'error')
    }
  }

  // Sidebar Drag Over & Drop to Unschedule
  const handleSidebarDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsSidebarDragOver(true)
  }

  const handleSidebarDragLeave = () => {
    setIsSidebarDragOver(false)
  }

  const handleSidebarDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsSidebarDragOver(false)

    let payload = null
    try {
      const jsonStr = e.dataTransfer.getData('application/json')
      if (jsonStr) payload = JSON.parse(jsonStr)
    } catch {
      // ignore
    }

    const eventToUnschedule = payload?.type === 'event' ? payload.data : draggedEvent
    setDraggedEvent(null)

    if (eventToUnschedule) {
      await handleUnscheduleEvent(eventToUnschedule)
    }
  }

  // Unschedule Event (Delete from calendar, return task to backlog)
  const handleUnscheduleEvent = async (event) => {
    try {
      setEvents((prev) => prev.filter((e) => e.id !== event.id))
      await deleteCalendarEvent(event.id)
      setModalState({ isOpen: false, mode: 'create', eventData: null })
      showToast(`Unscheduled "${event.title}" back to backlog.`)
      logActivity({
        type: 'delete',
        message: `Unscheduled event from calendar: "${event.title}"`,
        userId: user?.id
      })
    } catch (err) {
      console.error('Failed to unschedule event:', err)
      loadEvents()
      showToast('Failed to unschedule event.', 'error')
    }
  }

  // Extend Deadline / Duration (+30m)
  const handleExtendEventDeadline = async (event, minutes = 30) => {
    const currentEnd = new Date(event.end_time).getTime()
    const newEnd = new Date(currentEnd + minutes * 60000).toISOString()

    const updatedEvent = { ...event, end_time: newEnd }
    const preList = events.map((e) => (e.id === event.id ? updatedEvent : e))
    const { morphedEvents, changedEvents } = morphSchedule(preList, autoMorphEnabled)
    setEvents(morphedEvents)

    showToast(`Extended "${event.title}" by +${minutes}m`)

    try {
      await updateCalendarEvent(event.id, { end_time: newEnd })
      if (changedEvents.length > 0) {
        for (const ev of changedEvents) {
          await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
        }
      }
    } catch (err) {
      console.error('Failed to extend deadline:', err)
      loadEvents()
    }
  }

  // Complete Overdue Task
  const handleCompleteOverdueEvent = async (event) => {
    try {
      if (onToggleTask && event.task_id) {
        const matched = tasks.find((t) => t.id === event.task_id)
        if (matched) onToggleTask(matched)
      }
      setEvents((prev) => prev.filter((e) => e.id !== event.id))
      await deleteCalendarEvent(event.id)
      showToast(`✓ Completed & archived "${event.title}"`)
    } catch (err) {
      console.error('Failed to complete overdue event:', err)
    }
  }

  // Bottom Edge Duration Resize Listeners
  const handleResizeStart = (e, event) => {
    e.stopPropagation()
    setResizingEvent(event)
    resizeStartRef.current = {
      startY: e.clientY,
      startDuration: getDurationMinutes(event.start_time, event.end_time),
      event
    }
  }

  const handleResizeMove = useCallback(
    (e) => {
      if (!resizingEvent) return
      const deltaY = e.clientY - resizeStartRef.current.startY
      const deltaMinutes = Math.round(deltaY / 28) * 15 // 15-minute snapping
      const newDuration = Math.max(15, resizeStartRef.current.startDuration + deltaMinutes)

      const startMs = new Date(resizeStartRef.current.event.start_time).getTime()
      const newEnd = new Date(startMs + newDuration * 60000).toISOString()

      setEvents((prev) =>
        prev.map((ev) => (ev.id === resizingEvent.id ? { ...ev, end_time: newEnd } : ev))
      )
    },
    [resizingEvent]
  )

  const handleResizeEnd = useCallback(async () => {
    if (!resizingEvent) return
    const target = events.find((e) => e.id === resizingEvent.id)
    setResizingEvent(null)

    if (target) {
      const { morphedEvents, changedEvents } = morphSchedule(events, autoMorphEnabled)
      setEvents(morphedEvents)

      try {
        await updateCalendarEvent(target.id, { end_time: target.end_time })
        if (changedEvents.length > 0) {
          for (const ev of changedEvents) {
            await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
          }
        }
      } catch (err) {
        console.error('Failed to save resized event:', err)
      }
    }
  }, [resizingEvent, events, autoMorphEnabled])

  useEffect(() => {
    if (resizingEvent) {
      window.addEventListener('mousemove', handleResizeMove)
      window.addEventListener('mouseup', handleResizeEnd)
    } else {
      window.removeEventListener('mousemove', handleResizeMove)
      window.removeEventListener('mouseup', handleResizeEnd)
    }
    return () => {
      window.removeEventListener('mousemove', handleResizeMove)
      window.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [resizingEvent, handleResizeMove, handleResizeEnd])

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

  const displayedDays = viewMode === 'day' ? [currentDate] : weekDays

  return (
    <div className="chronos-container">
      {/* Top Header */}
      <header className="chronos-header">
        <div className="chronos-nav-group">
          <button type="button" className="chronos-btn-today" onClick={handleToday}>
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

      {/* Main Body (Sidebar + Grid) */}
      <div className="chronos-body">
        {/* Unassigned Task Backlog Sidebar (Accepts drops to unschedule) */}
        <aside
          className={`chronos-sidebar ${!isSidebarOpen ? 'collapsed' : ''} ${isSidebarDragOver ? 'drag-over-unschedule' : ''}`}
          onDragOver={handleSidebarDragOver}
          onDragLeave={handleSidebarDragLeave}
          onDrop={handleSidebarDrop}
          title={isSidebarDragOver ? 'Drop here to unschedule back to backlog' : undefined}
        >
          <div className="chronos-sidebar-header">
            {isSidebarOpen && (
              <span>
                {isSidebarDragOver ? 'Drop to Unschedule ↩' : `Backlog (${unassignedTasks.length})`}
              </span>
            )}
            <button
              type="button"
              className="chronos-sidebar-toggle"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              title={isSidebarOpen ? 'Collapse sidebar' : 'Expand backlog'}
              aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand backlog'}
            >
              {isSidebarOpen ? '◀' : '▶'}
            </button>
          </div>

          {isSidebarOpen && (
            <>
              {/* Backlog Search Filter */}
              <div className="chronos-sidebar-search">
                <input
                  type="text"
                  className="chronos-sidebar-input"
                  placeholder="Search backlog..."
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                />
              </div>

              <div className="chronos-sidebar-content">
                {unassignedTasks.length === 0 ? (
                  <div style={{ fontSize: '11px', color: '#71717a', fontStyle: 'italic', padding: '10px 4px' }}>
                    {sidebarSearch ? 'No matching tasks.' : 'All tasks scheduled.'}
                  </div>
                ) : (
                  unassignedTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`chronos-sidebar-task priority-${task.priority || 'medium'}`}
                      draggable
                      onDragStart={(e) => handleTaskDragStart(e, task)}
                      title="Drag onto calendar to schedule"
                    >
                      <span className="sidebar-task-title">{task.title}</span>
                      <div className="sidebar-task-meta">
                        <span className="sidebar-category-dot">
                          <span className={`category-indicator-dot ${task.category || 'General'}`} />
                          {task.category || 'General'}
                        </span>
                        <span className="sidebar-drag-hint">⋮⋮ Drag</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </aside>

        {/* Calendar Grid Area */}
        <div className="chronos-grid-wrapper">
          {viewMode === 'month' ? (
            /* Month Matrix View */
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%' }}>
              <div className="chronos-month-header-row">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <div key={day} className="chronos-month-header-cell">
                    {day}
                  </div>
                ))}
              </div>

              <div className="chronos-month-grid">
                {monthDays.map((day) => {
                  const isToday = isSameDay(day, new Date())
                  const isOtherMonth = day.getMonth() !== currentDate.getMonth()
                  const dayEvents = events.filter((e) => isSameDay(e.start_time, day))

                  return (
                    <div
                      key={day.toISOString()}
                      className={`chronos-month-cell ${isOtherMonth ? 'is-other-month' : ''} ${isToday ? 'is-today' : ''}`}
                      onClick={() => handleSlotClick(day, 9)}
                    >
                      <span className="month-cell-number">{day.getDate()}</span>
                      {dayEvents.slice(0, 3).map((ev) => {
                        const isOverdue = !ev.is_completed && new Date(now).getTime() > new Date(ev.end_time).getTime()
                        return (
                          <div
                            key={ev.id}
                            className={`month-event-pill ${isOverdue ? 'is-overdue' : ''}`}
                            onClick={(e) => handleEventClick(e, ev)}
                            title={`${ev.title} (${formatTimeShort(ev.start_time)})`}
                          >
                            {isOverdue && '⚠️ '}
                            {ev.title}
                          </div>
                        )
                      })}
                      {dayEvents.length > 3 && (
                        <span style={{ fontSize: '9px', color: '#71717a', fontWeight: 'bold' }}>
                          +{dayEvents.length - 3} more
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            /* Week & Day Timeline View */
            <>
              {/* Days Header Row */}
              <div className={`chronos-days-header-row ${viewMode === 'day' ? 'day-view' : ''}`}>
                <div className="chronos-time-gutter-header">GMT</div>
                {displayedDays.map((day) => {
                  const isToday = isSameDay(day, new Date())
                  return (
                    <div
                      key={day.toISOString()}
                      className={`chronos-day-col-header ${isToday ? 'is-today' : ''}`}
                    >
                      <span className="col-header-weekday">
                        {day.toLocaleDateString('en-US', { weekday: 'short' })}
                      </span>
                      <span className="col-header-number">{day.getDate()}</span>
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
                      {/* Current Time Red Line for Today */}
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
                            title={`Click to schedule at ${formatHour(hour)}`}
                          />
                        )
                      })}

                      {/* Scheduled Event Cards */}
                      {dayEvents.map((event) => {
                        const pos = getEventPosition(event.start_time, event.end_time)
                        const categoryClass = `cat-${event.category || 'General'}`
                        const isOverdue = !event.is_completed && new Date(now).getTime() > new Date(event.end_time).getTime()

                        return (
                          <div
                            key={event.id}
                            className={`chronos-event-card ${categoryClass} ${event._morphed ? 'morphed' : ''} ${isOverdue ? 'is-overdue' : ''}`}
                            style={{
                              top: pos.top,
                              height: pos.height
                            }}
                            draggable
                            onDragStart={(e) => handleEventDragStart(e, event)}
                            onClick={(e) => handleEventClick(e, event)}
                            title={`${event.title} (${formatTimeShort(event.start_time)} - ${formatTimeShort(event.end_time)}) — Drag to reschedule or drag to sidebar to unschedule`}
                          >
                            <div className="event-card-header">
                              <span className="event-card-time">
                                {formatTimeShort(event.start_time)} – {formatTimeShort(event.end_time)}
                              </span>
                              <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                                {isOverdue && (
                                  <span className="event-overdue-badge">⚠️ OVERDUE</span>
                                )}
                                {event.auto_morph && (
                                  <span className="event-morph-badge" title="Auto-Morph Active">
                                    ⚡
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="event-card-title">{event.title}</div>

                            <div className="event-card-footer">
                              <span>{event.category || 'General'}</span>
                              <span className="event-card-badge">{event.priority || 'MED'}</span>
                            </div>

                            {/* Bottom Edge Resize Handle */}
                            <div
                              className="event-resize-handle"
                              onMouseDown={(e) => handleResizeStart(e, event)}
                              title="Drag bottom edge to adjust duration"
                            />
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Actionable Overdue Alert Banner */}
      {topOverdueEvent && (
        <aside className="chronos-overdue-banner" role="alert">
          <div className="overdue-banner-left">
            <span>⚠️</span>
            <span>
              Deadline passed for <strong className="overdue-banner-title">{topOverdueEvent.title}</strong>
            </span>
          </div>

          <div className="overdue-banner-actions">
            <button
              type="button"
              className="btn-overdue-complete"
              onClick={() => handleCompleteOverdueEvent(topOverdueEvent)}
              title="Mark task completed and archive"
            >
              ✓ Complete Task
            </button>
            <button
              type="button"
              className="btn-overdue-extend"
              onClick={() => handleExtendEventDeadline(topOverdueEvent, 30)}
              title="Extend deadline by 30 minutes"
            >
              +30m Extend
            </button>
            <button
              type="button"
              className="btn-overdue-dismiss"
              onClick={() =>
                setDismissedOverdueIds((prev) => new Set([...prev, topOverdueEvent.id]))
              }
              title="Dismiss alert"
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          </div>
        </aside>
      )}

      {/* Modern Floating Modal (Glassmorphic Backdrop) */}
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
                aria-label="Close dialog"
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

              <div className="chronos-form-row" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
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
                <label htmlFor="auto_morph_checkbox" style={{ textTransform: 'none', cursor: 'pointer', fontSize: '11.5px', color: '#e4e4e7' }}>
                  Enable Velocity Auto-Morph (Auto-ripple on schedule drift)
                </label>
              </div>

              <div className="chronos-modal-actions">
                <div style={{ display: 'flex', gap: '6px' }}>
                  {modalState.mode === 'edit' && (
                    <>
                      <button
                        type="button"
                        className="btn-chronos-delete"
                        onClick={() => handleDeleteEvent(modalState.eventData.id)}
                        title="Delete this event record"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="btn-chronos-focus"
                        onClick={() => handleUnscheduleEvent(modalState.eventData)}
                        title="Unschedule and return to Backlog"
                      >
                        ↩ Unschedule
                      </button>
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {modalState.mode === 'edit' && (
                    <button
                      type="button"
                      className="btn-chronos-focus"
                      onClick={() => handleLaunchFocusFromEvent(modalState.eventData)}
                      title="Launch Zen Pomodoro Focus Session"
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
