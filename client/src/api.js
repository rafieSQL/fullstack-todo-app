import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { sanitizeText, validateTaskTitle } from './utils/sanitize.js'

/**
 * Custom API Error for clear error reporting
 */
export class ApiError extends Error {
  constructor(message, status = 400, details = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

// Columns to fetch for minimal payload transfer
const TASK_FIELDS = 'id, title, priority, category, completed, "order", created_at, updated_at'
const ACTIVITY_FIELDS = 'id, type, message, details, created_at'
const CALENDAR_FIELDS = 'id, task_id, title, start_time, end_time, category, priority, auto_morph, is_completed, event_type, recurrence, created_at, updated_at'

// In-memory fallback dataset for sandbox/preview mode
let mockTasks = [
  {
    id: 'mock-1',
    title: 'Audit database connection pooling and query timeouts',
    priority: 'high',
    category: 'Engineering',
    order: 0,
    completed: false,
    created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString()
  },
  {
    id: 'mock-2',
    title: 'Review pull request #104: Add idempotency headers to API endpoints',
    priority: 'medium',
    category: 'Engineering',
    order: 1,
    completed: false,
    created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString()
  },
  {
    id: 'mock-3',
    title: 'Standardize error response payloads across services',
    priority: 'low',
    category: 'Design',
    order: 2,
    completed: true,
    created_at: new Date(Date.now() - 1000 * 60 * 360).toISOString()
  }
]

let mockActivities = [
  {
    id: 'act-init',
    type: 'create',
    message: 'System initialized with engineering backlog tasks',
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString()
  }
]

let mockCalendarEvents = [
  {
    id: 'cal-1',
    task_id: 'mock-1',
    title: 'Audit database connection pooling',
    start_time: new Date(new Date().setHours(9, 0, 0, 0)).toISOString(),
    end_time: new Date(new Date().setHours(10, 30, 0, 0)).toISOString(),
    category: 'Engineering',
    priority: 'high',
    auto_morph: true,
    is_completed: false,
    created_at: new Date().toISOString()
  },
  {
    id: 'cal-2',
    task_id: 'mock-2',
    title: 'PR #104 Review & API Idempotency Verification',
    start_time: new Date(new Date().setHours(11, 0, 0, 0)).toISOString(),
    end_time: new Date(new Date().setHours(12, 0, 0, 0)).toISOString(),
    category: 'Engineering',
    priority: 'medium',
    auto_morph: true,
    is_completed: false,
    created_at: new Date().toISOString()
  },
  {
    id: 'cal-3',
    task_id: null,
    title: 'Sprint Planning & Architecture Sync',
    start_time: new Date(new Date().setHours(14, 0, 0, 0)).toISOString(),
    end_time: new Date(new Date().setHours(15, 0, 0, 0)).toISOString(),
    category: 'General',
    priority: 'medium',
    auto_morph: false,
    is_completed: false,
    created_at: new Date().toISOString()
  }
]

/**
 * Fetch all tasks for the active user with explicit column selection
 */
export async function getTasks(filters = {}) {
  if (!isSupabaseConfigured) {
    let list = [...mockTasks]
    if (filters.status === 'active') list = list.filter((t) => !t.completed)
    if (filters.status === 'completed') list = list.filter((t) => t.completed)
    if (filters.category && filters.category !== 'all') {
      list = list.filter((t) => (t.category || 'General').toLowerCase() === filters.category.toLowerCase())
    }
    if (filters.priority && filters.priority !== 'all') {
      list = list.filter((t) => t.priority === filters.priority)
    }
    if (filters.search && filters.search.trim()) {
      const q = sanitizeText(filters.search, 100).toLowerCase()
      list = list.filter((t) => t.title.toLowerCase().includes(q))
    }
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    return list
  }

  try {
    let query = supabase.from('tasks').select(TASK_FIELDS)

    if (filters.status === 'active') {
      query = query.eq('completed', false)
    } else if (filters.status === 'completed') {
      query = query.eq('completed', true)
    }

    if (filters.category && filters.category !== 'all') {
      query = query.ilike('category', filters.category)
    }

    if (filters.priority && filters.priority !== 'all') {
      query = query.eq('priority', filters.priority)
    }

    if (filters.search && filters.search.trim() !== '') {
      const sanitizedSearch = sanitizeText(filters.search, 100)
      query = query.ilike('title', `%${sanitizedSearch}%`)
    }

    if (filters.sort === 'newest') {
      query = query.order('created_at', { ascending: false })
    } else if (filters.sort === 'oldest') {
      query = query.order('created_at', { ascending: true })
    } else if (filters.sort === 'alphabetical') {
      query = query.order('title', { ascending: true })
    } else {
      // Default: Custom persistent sequence
      query = query.order('order', { ascending: true }).order('created_at', { ascending: false })
    }

    const { data, error } = await query

    if (error) throw new ApiError(error.message, 400, error)
    return data || []
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(err.message || 'Failed to fetch tasks from Supabase', 500, err)
  }
}

/**
 * Create a new task with strict input sanitization
 */
export async function createTask({ title, priority = 'medium', category = 'General', userId = null }) {
  const validation = validateTaskTitle(title)
  if (!validation.isValid) {
    throw new ApiError(validation.error, 400)
  }

  const cleanTitle = validation.sanitized
  const cleanCategory = sanitizeText(category, 50) || 'General'

  if (!isSupabaseConfigured) {
    const newTask = {
      id: `mock-${Date.now()}`,
      title: cleanTitle,
      priority,
      category: cleanCategory,
      order: 0,
      completed: false,
      created_at: new Date().toISOString()
    }
    mockTasks = [newTask, ...mockTasks.map((t) => ({ ...t, order: (t.order || 0) + 1 }))]
    logActivity({
      type: 'create',
      message: `Created task "${cleanTitle}" [${cleanCategory} • ${priority.toUpperCase()}]`
    })
    return newTask
  }

  try {
    const payload = {
      title: cleanTitle,
      priority,
      category: cleanCategory,
      completed: false,
      order: 0
    }
    if (userId) {
      payload.user_id = userId
    }

    const { data, error } = await supabase.from('tasks').insert([payload]).select(TASK_FIELDS).single()

    if (error) throw new ApiError(error.message, 400, error)

    await logActivity({
      type: 'create',
      message: `Created task "${data.title}" [${data.category} • ${data.priority.toUpperCase()}]`,
      userId,
      details: { taskId: data.id }
    })

    return data
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(err.message || 'Failed to create task in Supabase', 500, err)
  }
}

/**
 * Update task
 */
export async function updateTask(id, updates) {
  const sanitizedUpdates = { ...updates }
  if (typeof sanitizedUpdates.title === 'string') {
    const validation = validateTaskTitle(sanitizedUpdates.title)
    if (!validation.isValid) {
      throw new ApiError(validation.error, 400)
    }
    sanitizedUpdates.title = validation.sanitized
  }

  if (!isSupabaseConfigured) {
    const idx = mockTasks.findIndex((t) => t.id === id)
    if (idx === -1) throw new ApiError('Task not found', 404)
    mockTasks[idx] = { ...mockTasks[idx], ...sanitizedUpdates, updated_at: new Date().toISOString() }
    return mockTasks[idx]
  }

  try {
    const { data, error } = await supabase
      .from('tasks')
      .update({ ...sanitizedUpdates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(TASK_FIELDS)
      .single()

    if (error) throw new ApiError(error.message, 400, error)
    return data
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(err.message || 'Failed to update task in Supabase', 500, err)
  }
}

// Debounce timer reference for persistent reordering
let reorderDebounceTimer = null

/**
 * Reorder task sequences persistently with a 350ms trailing debounce
 */
export async function reorderTasks(orderedIds, userId = null) {
  if (!isSupabaseConfigured) {
    const idMap = new Map(mockTasks.map((t) => [t.id, t]))
    mockTasks = orderedIds.map((id, index) => {
      const item = idMap.get(id)
      return { ...item, order: index }
    })
    logActivity({
      type: 'reorder',
      message: `Reordered task list sequence (${orderedIds.length} items)`
    })
    return { count: orderedIds.length }
  }

  return new Promise((resolve, reject) => {
    if (reorderDebounceTimer) {
      clearTimeout(reorderDebounceTimer)
    }

    reorderDebounceTimer = setTimeout(async () => {
      try {
        const updatePromises = orderedIds.map((id, index) =>
          supabase.from('tasks').update({ order: index }).eq('id', id)
        )

        await Promise.all(updatePromises)

        await logActivity({
          type: 'reorder',
          message: `Reordered task sequence (${orderedIds.length} items)`,
          userId
        })

        resolve({ count: orderedIds.length })
      } catch (err) {
        reject(new ApiError(err.message || 'Failed to reorder tasks in Supabase', 500, err))
      }
    }, 350)
  })
}

/**
 * Batch update completion status
 */
export async function batchCompleteTasks(taskIds, completed = true, userId = null) {
  if (!isSupabaseConfigured) {
    mockTasks = mockTasks.map((t) =>
      taskIds.includes(t.id) ? { ...t, completed, updated_at: new Date().toISOString() } : t
    )
    logActivity({
      type: 'batch-complete',
      message: `Marked ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} as ${
        completed ? 'completed' : 'active'
      }`
    })
    return { count: taskIds.length }
  }

  try {
    const { error } = await supabase
      .from('tasks')
      .update({ completed, updated_at: new Date().toISOString() })
      .in('id', taskIds)

    if (error) throw new ApiError(error.message, 400, error)

    await logActivity({
      type: 'batch-complete',
      message: `Marked ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} as ${
        completed ? 'completed' : 'active'
      }`,
      userId
    })

    return { count: taskIds.length }
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(err.message || 'Failed to batch update tasks', 500, err)
  }
}

/**
 * Delete a specific task
 */
export async function deleteTask(id, taskTitle = '', userId = null) {
  if (!isSupabaseConfigured) {
    mockTasks = mockTasks.filter((t) => t.id !== id)
    logActivity({
      type: 'delete',
      message: `Deleted task "${taskTitle || id}"`
    })
    return { id }
  }

  try {
    const { error } = await supabase.from('tasks').delete().eq('id', id)

    if (error) throw new ApiError(error.message, 400, error)

    if (taskTitle) {
      await logActivity({
        type: 'delete',
        message: `Deleted task "${sanitizeText(taskTitle, 200)}"`,
        userId
      })
    }

    return { id }
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(err.message || 'Failed to delete task', 500, err)
  }
}

/**
 * Clear all completed tasks
 */
export async function clearCompletedTasks(userId = null) {
  if (!isSupabaseConfigured) {
    const prevCount = mockTasks.length
    mockTasks = mockTasks.filter((t) => !t.completed)
    const count = prevCount - mockTasks.length
    logActivity({
      type: 'clear-completed',
      message: `Purged ${count} completed task${count === 1 ? '' : 's'}`
    })
    return { count }
  }

  try {
    const { error } = await supabase.from('tasks').delete().eq('completed', true)

    if (error) throw new ApiError(error.message, 400, error)

    await logActivity({
      type: 'clear-completed',
      message: 'Purged completed tasks',
      userId
    })

    return { message: 'Cleared completed tasks' }
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(err.message || 'Failed to clear completed tasks', 500, err)
  }
}

/**
 * Fetch recent activity events with explicit column selection
 */
export async function getActivityLog(limit = 15) {
  if (!isSupabaseConfigured) {
    return mockActivities.slice(0, limit)
  }

  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select(ACTIVITY_FIELDS)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('Activity log query notice:', error.message)
      return []
    }
    return data || []
  } catch (err) {
    console.warn('Failed to retrieve activity log:', err)
    return []
  }
}

/**
 * Record a system activity event
 */
export async function logActivity({ type, message, details = {}, userId = null }) {
  const cleanMessage = sanitizeText(message, 500)
  if (!cleanMessage) return null

  if (!isSupabaseConfigured) {
    const act = {
      id: `act-${Date.now()}`,
      type,
      message: cleanMessage,
      created_at: new Date().toISOString()
    }
    mockActivities.unshift(act)
    if (mockActivities.length > 30) mockActivities = mockActivities.slice(0, 30)
    return act
  }

  try {
    const payload = { type, message: cleanMessage, details }
    if (userId) payload.user_id = userId

    const { data } = await supabase.from('activity_logs').insert([payload]).select(ACTIVITY_FIELDS).single()
    return data
  } catch {
    return null
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(val) {
  if (!val || typeof val !== 'string') return false
  return UUID_REGEX.test(val.trim())
}

/**
 * Fetch calendar events within a given time range
 */
export async function getCalendarEvents({ start = null, end = null } = {}) {
  if (!isSupabaseConfigured) {
    let list = [...mockCalendarEvents]
    if (start) {
      list = list.filter((e) => new Date(e.end_time) >= new Date(start))
    }
    if (end) {
      list = list.filter((e) => new Date(e.start_time) <= new Date(end))
    }
    return list.sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
  }

  try {
    let query = supabase
      .from('calendar_events')
      .select(CALENDAR_FIELDS)
      .order('start_time', { ascending: true })

    if (start) query = query.gte('end_time', start)
    if (end) query = query.lte('start_time', end)

    const { data, error } = await query
    if (error) {
      console.warn('Calendar fetch error, using local fallback:', error.message)
      return mockCalendarEvents
    }
    return data || []
  } catch (err) {
    console.warn('Calendar query failed:', err)
    return mockCalendarEvents
  }
}

/**
 * Create a new calendar event
 */
export async function createCalendarEvent({
  title,
  startTime,
  endTime,
  taskId = null,
  category = 'General',
  priority = 'medium',
  autoMorph = true,
  eventType = 'task',
  recurrence = 'none',
  userId = null
}) {
  const cleanTitle = sanitizeText(title, 250)
  if (!cleanTitle) {
    throw new ApiError('Event title is required and cannot be empty.', 400)
  }

  const sTime = new Date(startTime).toISOString()
  const eTime = new Date(endTime).toISOString()
  const safeTaskId = isValidUuid(taskId) ? taskId : null

  // Check if Supabase session is active
  let activeUserId = isValidUuid(userId) ? userId : null
  if (isSupabaseConfigured && !activeUserId) {
    try {
      const { data } = await supabase.auth.getUser()
      if (data?.user?.id) activeUserId = data.user.id
    } catch {
      // ignore
    }
  }

  const safeEventType = eventType === 'routine' ? 'routine' : 'task'
  const safeRecurrence = ['none', 'daily', 'weekdays', 'weekly'].includes(recurrence) ? recurrence : 'none'

  // Fallback to local memory if Supabase not configured or no active authenticated user
  if (!isSupabaseConfigured || !activeUserId) {
    const newEvent = {
      id: `cal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      task_id: safeTaskId,
      title: cleanTitle,
      start_time: sTime,
      end_time: eTime,
      category: ['General', 'Engineering', 'Design', 'Personal'].includes(category) ? category : 'General',
      priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
      auto_morph: Boolean(autoMorph),
      event_type: safeEventType,
      recurrence: safeRecurrence,
      is_completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    mockCalendarEvents.push(newEvent)
    return newEvent
  }

  try {
    const payload = {
      title: cleanTitle,
      start_time: sTime,
      end_time: eTime,
      task_id: safeTaskId,
      category: ['General', 'Engineering', 'Design', 'Personal'].includes(category) ? category : 'General',
      priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
      auto_morph: Boolean(autoMorph),
      event_type: safeEventType,
      recurrence: safeRecurrence,
      is_completed: false
    }
    if (activeUserId) payload.user_id = activeUserId

    const { data, error } = await supabase
      .from('calendar_events')
      .insert([payload])
      .select(CALENDAR_FIELDS)
      .single()

    if (error) {
      console.warn('Supabase calendar insert notice, using local store:', error.message)
      const fallbackEvent = {
        id: `cal-${Date.now()}`,
        ...payload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      mockCalendarEvents.push(fallbackEvent)
      return fallbackEvent
    }

    return data
  } catch (err) {
    console.warn('Calendar schedule fallback due to error:', err)
    const fallbackEvent = {
      id: `cal-${Date.now()}`,
      title: cleanTitle,
      start_time: sTime,
      end_time: eTime,
      task_id: safeTaskId,
      category: ['General', 'Engineering', 'Design', 'Personal'].includes(category) ? category : 'General',
      priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
      auto_morph: Boolean(autoMorph),
      event_type: safeEventType,
      recurrence: safeRecurrence,
      is_completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    mockCalendarEvents.push(fallbackEvent)
    return fallbackEvent
  }
}

/**
 * Update an existing calendar event (e.g. reschedule, auto-morph shift, complete)
 */
export async function updateCalendarEvent(id, updates = {}) {
  if (!id) throw new ApiError('Event ID is required for update.', 400)

  if (!isSupabaseConfigured || id.startsWith('cal-') || id.startsWith('temp-')) {
    const idx = mockCalendarEvents.findIndex((e) => e.id === id)
    if (idx !== -1) {
      mockCalendarEvents[idx] = {
        ...mockCalendarEvents[idx],
        ...updates,
        updated_at: new Date().toISOString()
      }
      return mockCalendarEvents[idx]
    }
    return { id, ...updates, updated_at: new Date().toISOString() }
  }

  try {
    const payload = { ...updates, updated_at: new Date().toISOString() }
    if (payload.task_id && !isValidUuid(payload.task_id)) {
      payload.task_id = null
    }

    const { data, error } = await supabase
      .from('calendar_events')
      .update(payload)
      .eq('id', id)
      .select(CALENDAR_FIELDS)
      .single()

    if (error) {
      console.warn('Supabase calendar update notice:', error.message)
      return { id, ...updates }
    }
    return data
  } catch (err) {
    console.warn('Calendar update network fallback:', err)
    return { id, ...updates }
  }
}

/**
 * Delete a calendar event
 */
export async function deleteCalendarEvent(id) {
  if (!id) throw new ApiError('Event ID is required for deletion.', 400)

  if (!isSupabaseConfigured || id.startsWith('cal-') || id.startsWith('temp-')) {
    mockCalendarEvents = mockCalendarEvents.filter((e) => e.id !== id)
    return true
  }

  try {
    const { error } = await supabase.from('calendar_events').delete().eq('id', id)
    if (error) {
      console.warn('Supabase calendar delete notice:', error.message)
      mockCalendarEvents = mockCalendarEvents.filter((e) => e.id !== id)
    }
    return true
  } catch (err) {
    console.warn('Calendar delete network fallback:', err)
    mockCalendarEvents = mockCalendarEvents.filter((e) => e.id !== id)
    return true
  }
}


