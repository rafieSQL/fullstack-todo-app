/**
 * Chronos Calendar & Velocity-Driven Time-Morphing Engine
 * Utilitarian scheduling, overlap resolution, and dynamic timeline packing.
 */

/**
 * Get the starting day (Monday) of the week for a given date
 */
export function getStartOfWeek(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Adjust for Sunday
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Return an array of 7 Date objects representing the week of baseDate
 */
export function getWeekDays(baseDate = new Date()) {
  const start = getStartOfWeek(baseDate)
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  return days
}

/**
 * Check if two dates are the same calendar day
 */
export function isSameDay(d1, d2) {
  if (!d1 || !d2) return false
  const a = new Date(d1)
  const b = new Date(d2)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Format Date to readable day title (e.g., "Mon, Aug 16")
 */
export function formatDayHeader(date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(date))
}

/**
 * Format Date to full date header (e.g., "August 16, 2026")
 */
export function formatFullDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(date))
}

/**
 * Format Date to Month Year header (e.g., "August 2026")
 */
export function formatMonthYear(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric'
  }).format(new Date(date))
}

/**
 * Get a complete 5 or 6-week matrix (35 or 42 days) representing the month view
 */
export function getMonthMatrix(baseDate = new Date()) {
  const d = new Date(baseDate)
  d.setDate(1) // First day of the month
  const start = getStartOfWeek(d)
  
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const daysSpanned = Math.ceil((lastDay.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  const totalDays = daysSpanned > 35 ? 42 : 35

  const days = []
  for (let i = 0; i < totalDays; i++) {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    days.push(day)
  }
  return days
}

/**
 * Format hour number to 24h string (e.g. 9 -> "09:00", 14 -> "14:00")
 */
export function formatHour(hour) {
  return `${hour.toString().padStart(2, '0')}:00`
}

/**
 * Format timestamp to HH:MM string
 */
export function formatTimeShort(dateInput) {
  const d = new Date(dateInput)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

/**
 * Calculate duration in minutes between two timestamps
 */
export function getDurationMinutes(start, end) {
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  return Math.max(1, Math.round((e - s) / (1000 * 60)))
}

/**
 * Compute vertical CSS top and height percentages for an event within a day column
 * Standard 24-hour viewport, protected from clipping or bottom-right overflow.
 */
export function getEventPosition(startTime, endTime, startHour = 0, totalHours = 24) {
  const s = new Date(startTime)
  const e = new Date(endTime)

  const startMinutes = (s.getHours() - startHour) * 60 + s.getMinutes()
  let endMinutes = (e.getHours() - startHour) * 60 + e.getMinutes()

  // Handle midnight or multi-day boundary
  if (endMinutes <= startMinutes) {
    const diff = (e.getTime() - s.getTime()) / (1000 * 60)
    endMinutes = startMinutes + (diff > 0 ? diff : 60)
  }

  const totalMinutes = totalHours * 60
  const topPercent = Math.min(97.5, Math.max(0, (startMinutes / totalMinutes) * 100))
  // Clamp height to prevent overflowing bottom of grid
  const rawHeightPercent = Math.max(2.2, ((endMinutes - startMinutes) / totalMinutes) * 100)
  const heightPercent = Math.min(rawHeightPercent, 100 - topPercent)

  return {
    top: `${topPercent}%`,
    height: `${heightPercent}%`
  }
}

/**
 * Expand recurring routines/habits across the active date range
 */
export function expandRecurringEvents(events = [], daysInRange = []) {
  const result = []

  events.forEach((ev) => {
    result.push(ev)

    // Items with repeat active get virtual recurrence expansion
    if (ev.recurrence && ev.recurrence !== 'none') {
      const origStart = new Date(ev.start_time)
      const origEnd = new Date(ev.end_time)
      const durationMs = origEnd.getTime() - origStart.getTime()

      daysInRange.forEach((day) => {
        if (isSameDay(day, origStart)) return // Already present as original

        let matches = false
        if (ev.recurrence === 'daily') {
          matches = true
        } else if (ev.recurrence === 'weekdays') {
          const dow = day.getDay()
          matches = dow >= 1 && dow <= 5 // Mon - Fri
        } else if (ev.recurrence === 'weekly') {
          matches = day.getDay() === origStart.getDay()
        }

        if (matches) {
          const recStart = new Date(day)
          recStart.setHours(origStart.getHours(), origStart.getMinutes(), origStart.getSeconds(), 0)
          const recEnd = new Date(recStart.getTime() + durationMs)

          result.push({
            ...ev,
            id: `${ev.id}-rec-${day.getTime()}`,
            _isRecurringInstance: true,
            _parentEventId: ev.id,
            start_time: recStart.toISOString(),
            end_time: recEnd.toISOString()
          })
        }
      })
    }
  })

  return result
}

/**
 * Velocity-Driven Time-Morphing Engine
 * Adjusts subsequent auto-morphable blocks forward or backward to prevent collisions and resolve drift.
 *
 * @param {Array} events - All events in the current scope
 * @param {string|Object} triggeringEvent - Event that triggered the velocity update
 * @param {boolean} autoMorphEnabled - Global engine toggle
 * @returns {Object} { morphedEvents, changedEvents, summary }
 */
export function morphSchedule(events = [], autoMorphEnabled = true) {
  if (!autoMorphEnabled || !events || events.length === 0) {
    return { morphedEvents: events, changedEvents: [], summary: { count: 0, totalShiftMinutes: 0 } }
  }

  // Clone list
  const list = events.map((e) => ({ ...e }))
  const changedEvents = []
  let totalShiftMinutes = 0

  // Group events by day
  const dayGroups = new Map()
  list.forEach((ev) => {
    const dayKey = new Date(ev.start_time).toDateString()
    if (!dayGroups.has(dayKey)) dayGroups.set(dayKey, [])
    dayGroups.get(dayKey).push(ev)
  })

  // Process each day group
  dayGroups.forEach((dayEvents) => {
    // Sort chronologically
    dayEvents.sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

    for (let i = 0; i < dayEvents.length - 1; i++) {
      const current = dayEvents[i]
      const next = dayEvents[i + 1]

      const currentEnd = new Date(current.end_time).getTime()
      const nextStart = new Date(next.start_time).getTime()
      const nextEnd = new Date(next.end_time).getTime()
      const nextDuration = nextEnd - nextStart

      // Check collision/overlap
      if (currentEnd > nextStart) {
        // If next event has auto_morph enabled, ripple it forward
        if (next.auto_morph !== false) {
          const shiftMs = currentEnd - nextStart
          const shiftMinutes = Math.round(shiftMs / (1000 * 60))

          const newNextStart = new Date(currentEnd)
          const newNextEnd = new Date(currentEnd + nextDuration)

          next.start_time = newNextStart.toISOString()
          next.end_time = newNextEnd.toISOString()
          next._morphed = true
          next._morphDelta = shiftMinutes

          changedEvents.push(next)
          totalShiftMinutes += shiftMinutes
        }
      }
    }
  })

  return {
    morphedEvents: list,
    changedEvents,
    summary: {
      count: changedEvents.length,
      totalShiftMinutes
    }
  }
}
