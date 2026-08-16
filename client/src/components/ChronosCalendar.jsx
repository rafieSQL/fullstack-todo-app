import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  createTask,
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
  onCreateTask,
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

  // In-Sidebar Quick Task Creator State
  const [quickTitle, setQuickTitle] = useState('')
  const [quickCategory, setQuickCategory] = useState('General')
  const [quickPriority, setQuickPriority] = useState('medium')
  const [isCreatingQuickTask, setIsCreatingQuickTask] = useState(false)

  // Drag-and-drop state & interaction locks
  const [draggedTask, setDraggedTask] = useState(null)
  const [draggedEvent, setDraggedEvent] = useState(null)
  const [dragOverSlot, setDragOverSlot] = useState(null)

  const isInteractingRef = useRef(false)
  const busyEventIdsRef = useRef(new Set())

  // Resizing state
  const [resizingEvent, setResizingEvent] = useState(null)
  const resizeStartRef = useRef({ startY: 0, startDuration: 60, event: null })

  // Modal State
  const [modalState, setModalState] = useState({
    isOpen: false,
    mode: 'create',
    eventData: null
  })

  // Date Calculations
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
  }, [showToast, user])

  // Supabase Real-Time Channel Subscription
  useEffect(() => {
    if (!isSupabaseConfigured) return

    const channel = supabase
      .channel('realtime_calendar_events')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_events' },
        () => {
          if (!isInteractingRef.current) {
            loadEvents()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadEvents])

  // Helper to check task completion across both calendar and registry states
  const isItemCompleted = useCallback(
    (ev) => {
      if (ev.is_completed) return true
      if (ev.task_id) {
        const matched = tasks.find((t) => t.id === ev.task_id)
        if (matched?.completed) return true
      }
      return false
    },
    [tasks]
  )

  // Auto-Accomplish on Deadline Pass Engine (with race condition locks)
  useEffect(() => {
    const checkAndAutoAccomplish = async () => {
      // Pause checks while user is dragging, dropping, or rescheduling
      if (isInteractingRef.current) return

      const currentMs = new Date().getTime()
      const expiredItems = events.filter(
        (ev) =>
          !isItemCompleted(ev) &&
          !busyEventIdsRef.current.has(ev.id) &&
          currentMs >= new Date(ev.end_time).getTime()
      )

      if (expiredItems.length > 0) {
        // Lock expired items
        expiredItems.forEach((ev) => busyEventIdsRef.current.add(ev.id))

        // Optimistically update calendar state
        setEvents((prev) =>
          prev.map((ev) =>
            !ev.is_completed && currentMs >= new Date(ev.end_time).getTime()
              ? { ...ev, is_completed: true }
              : ev
          )
        )

        for (const exp of expiredItems) {
          // Sync with main task registry
          if (exp.task_id && onToggleTask) {
            const matched = tasks.find((t) => t.id === exp.task_id)
            if (matched && !matched.completed) {
              onToggleTask(matched)
            }
          }

          try {
            await updateCalendarEvent(exp.id, { is_completed: true })
            logActivity({
              type: 'complete',
              message: `Auto-accomplished "${exp.title}" on deadline expiration`,
              userId: user?.id
            })
          } catch (err) {
            console.error('Failed to auto-accomplish task on deadline:', err)
          } finally {
            busyEventIdsRef.current.delete(exp.id)
          }
        }
      }
    }

    checkAndAutoAccomplish()
    const timer = setInterval(checkAndAutoAccomplish, 15000)
    return () => clearInterval(timer)
  }, [events, tasks, onToggleTask, isItemCompleted, user])

  // Unassigned Backlog Tasks (tasks in registry that are NOT completed and NOT scheduled)
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

  // In-Sidebar Quick Task Submission Handler
  const handleQuickTaskSubmit = async (e) => {
    e.preventDefault()
    const trimmed = quickTitle.trim()
    if (!trimmed || isCreatingQuickTask) return

    setIsCreatingQuickTask(true)
    try {
      if (onCreateTask) {
        await onCreateTask({
          title: trimmed,
          priority: quickPriority,
          category: quickCategory
        })
      } else {
        await createTask({
          title: trimmed,
          priority: quickPriority,
          category: quickCategory,
          userId: user?.id
        })
        showToast(`Created task: "${trimmed}"`)
      }
      setQuickTitle('')
    } catch (err) {
      console.error('Failed to add quick task in calendar sidebar:', err)
      showToast(err.message || 'Failed to create task.', 'error')
    } finally {
      setIsCreatingQuickTask(false)
    }
  }

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

  // Handle Slot Click (Quick Create Task)
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
        is_completed: false,
        task_id: null
      }
    })
  }

  // Inline Task Accomplish / Complete Action
  const handleToggleEventComplete = async (event, e) => {
    if (e) e.stopPropagation()
    const currentlyDone = isItemCompleted(event)
    const nextDone = !currentlyDone

    busyEventIdsRef.current.add(event.id)

    // Optimistic calendar state update
    setEvents((prev) =>
      prev.map((ev) => (ev.id === event.id ? { ...ev, is_completed: nextDone } : ev))
    )

    // Synchronize matching task in main Task Registry
    if (event.task_id && onToggleTask) {
      const matched = tasks.find((t) => t.id === event.task_id)
      if (matched && matched.completed !== nextDone) {
        onToggleTask(matched)
      }
    }

    if (modalState.isOpen && modalState.eventData?.id === event.id) {
      setModalState((prev) => ({
        ...prev,
        eventData: { ...prev.eventData, is_completed: nextDone }
      }))
    }

    showToast(nextDone ? `✓ Accomplished "${event.title}"!` : `Reopened "${event.title}".`)
    logActivity({
      type: nextDone ? 'complete' : 'update',
      message: `${nextDone ? 'Accomplished' : 'Reopened'} "${event.title}" on calendar`,
      userId: user?.id
    })

    try {
      await updateCalendarEvent(event.id, { is_completed: nextDone })
    } catch (err) {
      console.error('Failed to sync completion status:', err)
      loadEvents()
    } finally {
      busyEventIdsRef.current.delete(event.id)
    }
  }

  // Handle Dragging from Sidebar
  const handleTaskDragStart = (e, task) => {
    isInteractingRef.current = true
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

  // Handle Dragging Scheduled Task on Grid
  const handleEventDragStart = (e, event) => {
    e.stopPropagation()
    isInteractingRef.current = true
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

  // Drop on Slot (Schedule Task OR Reschedule Task with Race-Condition Protection)
  const handleSlotDrop = async (e, date, hour) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverSlot(null)
    isInteractingRef.current = true

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
    if (!activeItem) {
      isInteractingRef.current = false
      return
    }

    const start = new Date(date)
    start.setHours(hour, 0, 0, 0)

    if (isDroppingEvent) {
      // Reschedule existing task to new time
      const origStart = new Date(activeItem.start_time).getTime()
      const origEnd = new Date(activeItem.end_time).getTime()
      const durationMs = Math.max(1800000, origEnd - origStart)
      const end = new Date(start.getTime() + durationMs)

      const isPast = new Date().getTime() >= end.getTime()
      const nextCompleted = isPast || Boolean(activeItem.is_completed)

      busyEventIdsRef.current.add(activeItem.id)

      const updatedEvent = {
        ...activeItem,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        is_completed: nextCompleted
      }

      // Optimistic state update
      const preList = events.map((ev) => (ev.id === activeItem.id ? updatedEvent : ev))
      const { morphedEvents: optMorphed, changedEvents } = morphSchedule(preList, autoMorphEnabled)
      setEvents(optMorphed)

      try {
        await updateCalendarEvent(activeItem.id, {
          start_time: updatedEvent.start_time,
          end_time: updatedEvent.end_time,
          is_completed: nextCompleted
        })

        // Synchronize linked task in main registry if dropped into the past
        if (isPast && activeItem.task_id && onToggleTask) {
          const matched = tasks.find((t) => t.id === activeItem.task_id)
          if (matched && !matched.completed) {
            onToggleTask(matched)
          }
        }

        if (isPast) {
          showToast(`Scheduled and marked "${activeItem.title}" as completed`)
        } else {
          showToast(`Rescheduled "${activeItem.title}" to ${formatHour(hour)}`)
        }

        if (changedEvents.length > 0) {
          for (const ev of changedEvents) {
            try {
              await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
            } catch {
              // ignore ripple shift non-critical errors
            }
          }
        }
      } catch (err) {
        console.error('Failed to reschedule task:', err)
        loadEvents()
        showToast('Failed to reschedule task.', 'error')
      } finally {
        busyEventIdsRef.current.delete(activeItem.id)
        setTimeout(() => {
          isInteractingRef.current = false
        }, 300)
      }
      return
    }

    // Schedule task from backlog
    const end = new Date(start)
    end.setHours(hour + 1, 0, 0, 0)
    const isPast = new Date().getTime() >= end.getTime()

    const tempId = `temp-${activeItem.id}-${start.getTime()}`
    busyEventIdsRef.current.add(tempId)

    const optimisticEvent = {
      id: tempId,
      task_id: activeItem.id,
      title: activeItem.title,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      category: activeItem.category || 'General',
      priority: activeItem.priority || 'medium',
      auto_morph: true,
      is_completed: isPast,
      created_at: start.toISOString()
    }

    const preList = [...events, optimisticEvent]
    const { morphedEvents: optMorphed } = morphSchedule(preList, autoMorphEnabled)
    setEvents(optMorphed)

    try {
      const created = await createCalendarEvent({
        title: activeItem.title,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        taskId: activeItem.id,
        category: activeItem.category || 'General',
        priority: activeItem.priority || 'medium',
        autoMorph: true,
        isCompleted: isPast,
        userId: user?.id
      })

      busyEventIdsRef.current.add(created.id)
      const updatedList = events.map((ev) => (ev.id === tempId ? created : ev))
      if (!updatedList.some((ev) => ev.id === created.id)) {
        updatedList.push(created)
      }
      const { morphedEvents, changedEvents } = morphSchedule(updatedList, autoMorphEnabled)
      setEvents(morphedEvents)

      if (isPast && onToggleTask) {
        const matched = tasks.find((t) => t.id === activeItem.id)
        if (matched && !matched.completed) {
          onToggleTask(matched)
        }
      }

      if (isPast) {
        showToast(`Scheduled and marked "${activeItem.title}" as completed`)
      } else {
        showToast(`Scheduled "${activeItem.title}" at ${formatHour(hour)}`)
      }

      logActivity({
        type: 'create',
        message: `Scheduled task on calendar: "${activeItem.title}"`,
        userId: user?.id
      })

      if (changedEvents.length > 0) {
        for (const ev of changedEvents) {
          if (!ev.id.startsWith('temp-')) {
            try {
              await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to drop task onto calendar:', err)
      setEvents((prev) => prev.filter((ev) => ev.id !== tempId))
      showToast(err.message || 'Failed to schedule task.', 'error')
    } finally {
      busyEventIdsRef.current.delete(tempId)
      setTimeout(() => {
        isInteractingRef.current = false
      }, 300)
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
    isInteractingRef.current = true

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
    isInteractingRef.current = false
  }

  // Unschedule Task (Delete from calendar, return task to backlog)
  const handleUnscheduleEvent = async (event) => {
    try {
      setEvents((prev) => prev.filter((e) => e.id !== event.id))
      await deleteCalendarEvent(event.id)
      setModalState({ isOpen: false, mode: 'create', eventData: null })
      showToast(`Unscheduled "${event.title}" back to backlog.`)
      logActivity({
        type: 'delete',
        message: `Unscheduled task from calendar: "${event.title}"`,
        userId: user?.id
      })
    } catch (err) {
      console.error('Failed to unschedule task:', err)
      loadEvents()
      showToast('Failed to unschedule task.', 'error')
    }
  }

  // Bottom Edge Duration Resize Listeners
  const handleResizeStart = (e, event) => {
    e.stopPropagation()
    isInteractingRef.current = true
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
        console.error('Failed to save resized task:', err)
      } finally {
        setTimeout(() => {
          isInteractingRef.current = false
        }, 300)
      }
    } else {
      isInteractingRef.current = false
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
    const original = events.find((item) => item.id === event.id) || event
    setModalState({
      isOpen: true,
      mode: 'edit',
      eventData: { ...original }
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
        showToast(`Scheduled task "${formData.title}"`)

        if (changedEvents.length > 0) {
          for (const ev of changedEvents) {
            await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
          }
          showToast(`⚡ Auto-Morphed: Shifted ${changedEvents.length} tasks to prevent overlap.`)
        }
      } else {
        const updated = await updateCalendarEvent(formData.id, formData)
        const updatedList = events.map((e) => (e.id === updated.id ? updated : e))
        const { morphedEvents, changedEvents } = morphSchedule(updatedList, autoMorphEnabled)
        setEvents(morphedEvents)
        showToast(`Updated "${formData.title}"`)

        if (changedEvents.length > 0) {
          for (const ev of changedEvents) {
            await updateCalendarEvent(ev.id, { start_time: ev.start_time, end_time: ev.end_time })
          }
          showToast(`⚡ Auto-Morphed: Shifted ${changedEvents.length} tasks to prevent overlap.`)
        }
      }
      setModalState({ isOpen: false, mode: 'create', eventData: null })
    } catch (err) {
      console.error('Failed to save task:', err)
      showToast(err.message || 'Failed to save task.', 'error')
    }
  }

  // Delete Event
  const handleDeleteEvent = async (id) => {
    try {
      await deleteCalendarEvent(id)
      setEvents((prev) => prev.filter((e) => e.id !== id))
      setModalState({ isOpen: false, mode: 'create', eventData: null })
      showToast('Task deleted from calendar.')
    } catch (err) {
      console.error('Failed to delete task:', err)
      showToast('Failed to delete task.', 'error')
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

      {/* Main Body (Sidebar + Viewports) */}
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
                {isSidebarDragOver ? 'Drop to Unschedule ↩' : `Task Backlog (${unassignedTasks.length})`}
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

              {/* Scrollable Tasks Sub-List */}
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

              {/* Sticky / Pinned In-Sidebar Quick Task Creator */}
              <form className="chronos-sidebar-quick-add" onSubmit={handleQuickTaskSubmit}>
                <div className="chronos-quick-input-row">
                  <input
                    type="text"
                    className="chronos-quick-add-input"
                    placeholder="+ New task (Enter ↵)"
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="chronos-quick-add-btn"
                    disabled={!quickTitle.trim() || isCreatingQuickTask}
                    title="Add task to backlog"
                  >
                    Add
                  </button>
                </div>

                <div className="chronos-quick-pill-row">
                  {/* Category Pills */}
                  <div className="chronos-quick-pill-group">
                    {[
                      { key: 'General', label: 'GEN' },
                      { key: 'Engineering', label: 'ENG' },
                      { key: 'Design', label: 'DES' },
                      { key: 'Personal', label: 'PERS' }
                    ].map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className={`chronos-mini-pill cat-${c.key} ${quickCategory === c.key ? 'active' : ''}`}
                        onClick={() => setQuickCategory(c.key)}
                        title={`Category: ${c.key}`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {/* Priority Pills */}
                  <div className="chronos-quick-pill-group">
                    {[
                      { key: 'low', label: 'L' },
                      { key: 'medium', label: 'M' },
                      { key: 'high', label: 'H' }
                    ].map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        className={`chronos-mini-pill prio-${p.key} ${quickPriority === p.key ? 'active' : ''}`}
                        onClick={() => setQuickPriority(p.key)}
                        title={`Priority: ${p.key.toUpperCase()}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </form>
            </>
          )}
        </aside>

        {viewMode === 'month' ? (
          /* Standard High-Performance 7-Column Month Grid (Notion / Google Calendar) */
          <div className="chronos-month-container">
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
                    title={`Click to schedule task on ${day.toLocaleDateString()}`}
                  >
                    <span className="month-cell-number">{day.getDate()}</span>
                    {dayEvents.slice(0, 4).map((ev) => {
                      const isDone = isItemCompleted(ev)

                      return (
                        <div
                          key={ev.id}
                          className={`month-event-pill ${isDone ? 'is-completed' : ''}`}
                          onClick={(e) => handleEventClick(e, ev)}
                          title={`${ev.title} (${formatTimeShort(ev.start_time)})`}
                        >
                          {isDone ? '✓ ' : ''}
                          {ev.title}
                        </div>
                      )
                    })}
                    {dayEvents.length > 4 && (
                      <span style={{ fontSize: '9px', color: '#71717a', fontWeight: 'bold' }}>
                        +{dayEvents.length - 4} more
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Week & Day Timeline View (Natural Vertical Scroll) */
          <div className="chronos-grid-wrapper">
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

                    {/* Scheduled Task Cards */}
                    {dayEvents.map((event) => {
                      const pos = getEventPosition(event.start_time, event.end_time)
                      const categoryClass = `cat-${event.category || 'General'}`
                      const isDone = isItemCompleted(event)

                      return (
                        <div
                          key={event.id}
                          className={`chronos-event-card ${categoryClass} ${isDone ? 'is-completed' : ''} ${event._morphed ? 'morphed' : ''}`}
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              {/* Inline Accomplish / Check Button */}
                              <button
                                type="button"
                                className={`event-check-btn ${isDone ? 'completed' : ''}`}
                                onClick={(e) => handleToggleEventComplete(event, e)}
                                title={isDone ? 'Mark Incomplete' : 'Mark Accomplished'}
                                aria-label={isDone ? 'Mark Incomplete' : 'Mark Accomplished'}
                              >
                                {isDone ? '✓' : ''}
                              </button>
                              <span className="event-card-time">
                                {formatTimeShort(event.start_time)} – {formatTimeShort(event.end_time)}
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                              {isDone && (
                                <span className="event-completed-badge">✓ DONE</span>
                              )}
                              {!isDone && event.auto_morph && (
                                <span className="event-morph-badge" title="Auto-Morph Active">
                                  ⚡
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="event-card-title">{event.title}</div>

                          <div className="event-card-footer">
                            <span>{event.category || 'General'}</span>
                            <span className="event-card-badge">
                              {isDone ? 'COMPLETED' : event.priority || 'MED'}
                            </span>
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
          </div>
        )}
      </div>

      {/* Modern Floating Modal (Schedule Task) */}
      {modalState.isOpen && (
        <div
          className="chronos-modal-overlay"
          onClick={() => setModalState({ isOpen: false, mode: 'create', eventData: null })}
        >
          <div className="chronos-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chronos-modal-header">
              <span>{modalState.mode === 'create' ? 'Schedule Task' : 'Edit Scheduled Task'}</span>
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
                <label>Task Title</label>
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
                  placeholder="Task title or deliverable..."
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
                        title="Delete this item record"
                      >
                        Delete
                      </button>
                      {modalState.eventData?.task_id && (
                        <button
                          type="button"
                          className="btn-chronos-focus"
                          onClick={() => handleUnscheduleEvent(modalState.eventData)}
                          title="Unschedule and return to Backlog"
                        >
                          ↩ Unschedule
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {modalState.mode === 'edit' && (
                    <button
                      type="button"
                      className={`btn-chronos-toggle-complete ${isItemCompleted(modalState.eventData) ? 'is-done' : ''}`}
                      onClick={() => handleToggleEventComplete(modalState.eventData)}
                      title="Toggle task completion"
                    >
                      {isItemCompleted(modalState.eventData) ? '↩ Mark Incomplete' : '✓ Accomplish'}
                    </button>
                  )}
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
