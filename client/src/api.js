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
    let query = supabase.from('tasks').select('*')

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

    let { data, error } = await query

    if (error) {
      let fallbackQuery = supabase.from('tasks').select(TASK_FIELDS)
      if (filters.status === 'active') fallbackQuery = fallbackQuery.eq('completed', false)
      if (filters.status === 'completed') fallbackQuery = fallbackQuery.eq('completed', true)
      if (filters.category && filters.category !== 'all') fallbackQuery = fallbackQuery.ilike('category', filters.category)
      if (filters.priority && filters.priority !== 'all') fallbackQuery = fallbackQuery.eq('priority', filters.priority)
      if (filters.search && filters.search.trim() !== '') {
        const sanitizedSearch = sanitizeText(filters.search, 100)
        fallbackQuery = fallbackQuery.ilike('title', `%${sanitizedSearch}%`)
      }
      fallbackQuery = fallbackQuery.order('order', { ascending: true }).order('created_at', { ascending: false })
      const fbResult = await fallbackQuery
      if (!fbResult.error) {
        data = fbResult.data
        error = null
      }
    }

    if (error) throw new ApiError(error.message, 400, error)
    return data || []
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(err.message || 'Failed to fetch tasks from Supabase', 500, err)
  }
}

/**
 * Create a new task with strict input sanitization and optional due_date
 */
export async function createTask({
  title,
  priority = 'medium',
  category = 'General',
  due_date = null,
  userId = null
}) {
  const validation = validateTaskTitle(title)
  if (!validation.isValid) {
    throw new ApiError(validation.error, 400)
  }

  const cleanTitle = validation.sanitized
  const cleanCategory = sanitizeText(category, 50) || 'General'
  const validDueDate = due_date ? new Date(due_date).toISOString() : null

  if (!isSupabaseConfigured) {
    const newTask = {
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: cleanTitle,
      priority,
      category: cleanCategory,
      due_date: validDueDate,
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
    if (validDueDate) {
      payload.due_date = validDueDate
    }
    if (userId) {
      payload.user_id = userId
    }

    let { data, error } = await supabase.from('tasks').insert([payload]).select('*').single()

    // If 'due_date' column is not in remote database schema, retry without it
    if (error && (error.message?.includes('due_date') || error.code === '42703')) {
      delete payload.due_date
      const retry = await supabase.from('tasks').insert([payload]).select(TASK_FIELDS).single()
      data = retry.data
      error = retry.error
    }

    if (error) throw new ApiError(error.message, 400, error)

    const finalData = { ...data, due_date: data?.due_date || validDueDate }

    // Non-blocking activity logging
    logActivity({
      type: 'create',
      message: `Created task "${finalData.title}" [${finalData.category} • ${finalData.priority.toUpperCase()}]`,
      userId,
      details: { taskId: finalData.id, due_date: validDueDate }
    }).catch(() => {})

    return finalData
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

        logActivity({
          type: 'reorder',
          message: `Reordered task sequence (${orderedIds.length} items)`,
          userId
        }).catch(() => {})

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

    logActivity({
      type: 'batch-complete',
      message: `Marked ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} as ${
        completed ? 'completed' : 'active'
      }`,
      userId
    }).catch(() => {})

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
      logActivity({
        type: 'delete',
        message: `Deleted task "${sanitizeText(taskTitle, 200)}"`,
        userId
      }).catch(() => {})
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

    logActivity({
      type: 'clear-completed',
      message: 'Purged completed tasks',
      userId
    }).catch(() => {})

    return { message: 'Cleared completed tasks' }
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(err.message || 'Failed to clear completed tasks', 500, err)
  }
}

/**
 * Fetch recent activity events with explicit column selection
 */
/**
 * Retrieve recent system activities
 * Safely handles missing 'type' column with fallback to id, message, details, created_at
 */
export async function getActivityLog(limit = 15) {
  if (!isSupabaseConfigured) {
    return mockActivities.slice(0, limit)
  }

  try {
    // Attempt standard query first
    let res = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    // If query fails (e.g., column mismatch or specific column error), fallback to safe core columns
    if (res.error) {
      res = await supabase
        .from('activity_logs')
        .select('id, message, details, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
    }

    if (res.error) {
      console.warn('Activity log query notice (falling back gracefully):', res.error.message || res.error)
      return mockActivities.slice(0, limit)
    }

    return Array.isArray(res.data)
      ? res.data.map((d) => ({
          id: d.id,
          type: d.type || d.action || 'info',
          message: d.message || d.content || '',
          details: d.details || {},
          created_at: d.created_at || new Date().toISOString()
        }))
      : []
  } catch (err) {
    console.warn('Failed to retrieve activity log (safely swallowed):', err?.message || err)
    return mockActivities.slice(0, limit)
  }
}

/**
 * Record a system activity event (non-blocking, safe failover)
 * Safely falls back if 'type' column is absent in the database schema
 */
export async function logActivity({ type = 'info', message, details = {}, userId = null }) {
  const cleanMessage = sanitizeText(message, 500)
  if (!cleanMessage) return null

  const fallbackAct = {
    id: `act-${Date.now()}`,
    type: type || 'info',
    message: cleanMessage,
    details,
    created_at: new Date().toISOString()
  }

  if (!isSupabaseConfigured) {
    mockActivities.unshift(fallbackAct)
    if (mockActivities.length > 30) mockActivities = mockActivities.slice(0, 30)
    return fallbackAct
  }

  try {
    const payload = { type: type || 'info', message: cleanMessage, details }
    if (userId) payload.user_id = userId

    let { data, error } = await supabase
      .from('activity_logs')
      .insert([payload])
      .select('id, message, details, created_at')
      .single()

    if (error) {
      // If column 'type' does not exist in the remote schema, retry inserting without 'type'
      const retryPayload = { message: cleanMessage, details }
      if (userId) retryPayload.user_id = userId

      const retryRes = await supabase
        .from('activity_logs')
        .insert([retryPayload])
        .select('id, message, details, created_at')
        .single()

      if (!retryRes.error && retryRes.data) {
        return {
          ...retryRes.data,
          type: type || 'info'
        }
      }

      console.warn('Activity log notice (falling back gracefully):', error.message || error)
      mockActivities.unshift(fallbackAct)
      return fallbackAct
    }

    return data ? { ...data, type: type || 'info' } : fallbackAct
  } catch (err) {
    console.warn('Error recording activity log (non-blocking fallback used):', err?.message || err)
    mockActivities.unshift(fallbackAct)
    return fallbackAct
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
      .select('*')
      .order('start_time', { ascending: true })

    if (start) query = query.gte('end_time', start)
    if (end) query = query.lte('start_time', end)

    const { data, error } = await query
    if (error) {
      console.error('Calendar fetch error from Supabase:', error.message)
      throw new ApiError(error.message, 400, error)
    }
    return data || []
  } catch (err) {
    console.error('Calendar query failed:', err)
    if (err instanceof ApiError) throw err
    return []
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
  isCompleted = false,
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
      const { data: sessionData } = await supabase.auth.getSession()
      if (sessionData?.session?.user?.id && isValidUuid(sessionData.session.user.id)) {
        activeUserId = sessionData.session.user.id
      } else {
        const { data: userData } = await supabase.auth.getUser()
        if (userData?.user?.id && isValidUuid(userData.user.id)) {
          activeUserId = userData.user.id
        }
      }
    } catch {
      // ignore
    }
  }

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
      is_completed: Boolean(isCompleted),
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
      is_completed: Boolean(isCompleted),
      user_id: activeUserId
    }

    const { data, error } = await supabase
      .from('calendar_events')
      .insert([payload])
      .select('*')
      .single()

    if (error) {
      console.error('Supabase calendar insert error:', error.message)
      throw new ApiError(error.message, 400, error)
    }

    return data
  } catch (err) {
    if (err instanceof ApiError) throw err
    console.error('Calendar schedule failed:', err)
    throw new ApiError(err.message || 'Failed to schedule calendar task', 500, err)
  }
}

/**
 * Sanitize calendar payload to ensure ONLY valid PostgreSQL columns are sent
 */
export function sanitizeCalendarPayload(rawUpdates = {}) {
  const sanitized = {}
  if (rawUpdates.title !== undefined) {
    sanitized.title = sanitizeText(rawUpdates.title, 250)
  }
  if (rawUpdates.start_time !== undefined) {
    sanitized.start_time = new Date(rawUpdates.start_time).toISOString()
  }
  if (rawUpdates.end_time !== undefined) {
    sanitized.end_time = new Date(rawUpdates.end_time).toISOString()
  }
  if (rawUpdates.task_id !== undefined) {
    sanitized.task_id = isValidUuid(rawUpdates.task_id) ? rawUpdates.task_id : null
  }
  if (rawUpdates.category !== undefined) {
    sanitized.category = ['General', 'Engineering', 'Design', 'Personal'].includes(rawUpdates.category)
      ? rawUpdates.category
      : 'General'
  }
  if (rawUpdates.priority !== undefined) {
    sanitized.priority = ['low', 'medium', 'high'].includes(rawUpdates.priority)
      ? rawUpdates.priority
      : 'medium'
  }
  if (rawUpdates.auto_morph !== undefined) {
    sanitized.auto_morph = Boolean(rawUpdates.auto_morph)
  }
  if (rawUpdates.is_completed !== undefined) {
    sanitized.is_completed = Boolean(rawUpdates.is_completed)
  }
  if (rawUpdates.user_id !== undefined && isValidUuid(rawUpdates.user_id)) {
    sanitized.user_id = rawUpdates.user_id
  }
  sanitized.updated_at = new Date().toISOString()
  return sanitized
}

/**
 * Update an existing calendar event (e.g. reschedule, auto-morph shift, complete)
 * with strict column sanitization and upsert fallback.
 */
export async function updateCalendarEvent(id, updates = {}) {
  if (!id) throw new ApiError('Event ID is required for update.', 400)

  const payload = sanitizeCalendarPayload(updates)

  // In-memory mock fallback if Supabase not configured
  if (!isSupabaseConfigured) {
    const idx = mockCalendarEvents.findIndex((e) => e.id === id)
    if (idx !== -1) {
      mockCalendarEvents[idx] = {
        ...mockCalendarEvents[idx],
        ...payload
      }
      return mockCalendarEvents[idx]
    }
    const fallbackItem = { id, ...payload }
    mockCalendarEvents.push(fallbackItem)
    return fallbackItem
  }

  // Handle temporary or non-UUID IDs by creating or upserting to Supabase
  if (!isValidUuid(id)) {
    try {
      let activeUserId = payload.user_id
      if (!activeUserId) {
        const { data: sess } = await supabase.auth.getSession()
        activeUserId = sess?.session?.user?.id
      }
      return await createCalendarEvent({
        title: payload.title || updates.title || 'Scheduled Task',
        startTime: payload.start_time || updates.start_time,
        endTime: payload.end_time || updates.end_time,
        taskId: payload.task_id || updates.task_id,
        category: payload.category || updates.category,
        priority: payload.priority || updates.priority,
        autoMorph: payload.auto_morph !== undefined ? payload.auto_morph : updates.auto_morph,
        isCompleted: payload.is_completed !== undefined ? payload.is_completed : updates.is_completed,
        userId: activeUserId
      })
    } catch (createErr) {
      console.error('Failed to convert temporary event to database record:', createErr)
      throw createErr
    }
  }

  try {
    const { data, error } = await supabase
      .from('calendar_events')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      // If row does not exist in DB, attempt upsert fallback
      if (error.code === 'PGRST116' || error.message?.includes('0 rows')) {
        let activeUserId = payload.user_id
        if (!activeUserId) {
          const { data: sess } = await supabase.auth.getSession()
          activeUserId = sess?.session?.user?.id
        }
        if (activeUserId) payload.user_id = activeUserId

        const { data: upsertData, error: upsertErr } = await supabase
          .from('calendar_events')
          .upsert([{ id, ...payload }])
          .select('*')
          .single()

        if (!upsertErr && upsertData) return upsertData
      }

      console.error('Supabase calendar update error:', error.message)
      throw new ApiError(error.message, 400, error)
    }
    return data
  } catch (err) {
    if (err instanceof ApiError) throw err
    console.error('Calendar update failed:', err)
    throw new ApiError(err.message || 'Failed to update calendar event', 500, err)
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
      console.error('Supabase calendar delete error:', error.message)
      throw new ApiError(error.message, 400, error)
    }
    return true
  } catch (err) {
    if (err instanceof ApiError) throw err
    console.error('Calendar delete failed:', err)
    throw new ApiError(err.message || 'Failed to delete calendar event', 500, err)
  }
}


