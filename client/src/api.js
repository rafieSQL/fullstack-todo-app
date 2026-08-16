const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

/**
 * Custom API Error for clear error reporting
 */
export class ApiError extends Error {
  constructor(message, status, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

/**
 * Generic request helper with robust error handling
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers
    })

    if (!response.ok) {
      let errorMessage = `HTTP Error ${response.status}`
      let errorDetails = null
      try {
        const errorJson = await response.json()
        errorMessage = errorJson.error || errorJson.message || errorMessage
        errorDetails = errorJson
      } catch {
        // Response wasn't JSON
      }
      throw new ApiError(errorMessage, response.status, errorDetails)
    }

    return await response.json()
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    // Network or connection failure
    throw new ApiError(
      'Unable to connect to server. Ensure backend is running on port 5000.',
      0,
      error
    )
  }
}

/**
 * Fetch all tasks with optional filters and sorting
 * @param {Object} [filters] - { status?: 'all'|'active'|'completed', priority?: 'low'|'medium'|'high', search?: string, sort?: string }
 */
export async function getTasks(filters = {}) {
  const queryParams = new URLSearchParams()
  if (filters.status && filters.status !== 'all') {
    queryParams.set('status', filters.status)
  }
  if (filters.priority && filters.priority !== 'all') {
    queryParams.set('priority', filters.priority)
  }
  if (filters.search && filters.search.trim() !== '') {
    queryParams.set('search', filters.search.trim())
  }
  if (filters.sort) {
    queryParams.set('sort', filters.sort)
  }

  const queryStr = queryParams.toString()
  const endpoint = `/tasks${queryStr ? `?${queryStr}` : ''}`
  return await request(endpoint, { method: 'GET' })
}

/**
 * Create a new task
 * @param {{ title: string, priority: 'low'|'medium'|'high' }} payload
 */
export async function createTask({ title, priority = 'medium' }) {
  return await request('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, priority })
  })
}

/**
 * Update an existing task (toggle complete, edit title/priority)
 * @param {string} id
 * @param {Object} updates - { completed?: boolean, title?: string, priority?: 'low'|'medium'|'high' }
 */
export async function updateTask(id, updates) {
  return await request(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  })
}

/**
 * Batch update completion status for multiple tasks
 * @param {string[]} taskIds
 * @param {boolean} completed
 */
export async function batchCompleteTasks(taskIds, completed = true) {
  return await request('/tasks/batch-complete', {
    method: 'PATCH',
    body: JSON.stringify({ taskIds, completed })
  })
}

/**
 * Delete a specific task
 * @param {string} id
 */
export async function deleteTask(id) {
  return await request(`/tasks/${id}`, {
    method: 'DELETE'
  })
}

/**
 * Clear all completed tasks
 */
export async function clearCompletedTasks() {
  return await request('/tasks/completed', {
    method: 'DELETE'
  })
}

/**
 * Fetch recent activity events
 * @param {number} [limit=15]
 */
export async function getActivityLog(limit = 15) {
  return await request(`/activity?limit=${limit}`, { method: 'GET' })
}

/**
 * Health check ping
 */
export async function checkServerHealth() {
  return await request('/health', { method: 'GET' })
}
