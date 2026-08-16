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
