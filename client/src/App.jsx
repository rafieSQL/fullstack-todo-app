import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as api from './api.js'
import './App.css'

/**
 * Format ISO date string into compact, readable relative time
 */
function formatTimeAgo(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

export default function App() {
  const [tasks, setTasks] = useState([])
  const [activities, setActivities] = useState([])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'active' | 'completed'
  const [priorityFilter, setPriorityFilter] = useState('all') // 'all' | 'high' | 'medium' | 'low'
  const [sortBy, setSortBy] = useState('newest') // 'newest' | 'oldest' | 'priority' | 'alphabetical'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTaskIds, setSelectedTaskIds] = useState([])
  const [isActivityOpen, setIsActivityOpen] = useState(false)

  // Inline editing state
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')

  // UI state
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [isServerConnected, setIsServerConnected] = useState(true)
  const [toasts, setToasts] = useState([])

  const taskInputRef = useRef(null)
  const searchInputRef = useRef(null)
  const editInputRef = useRef(null)

  // Toast helper with auto-dismiss
  const showToast = useCallback((message, type = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }, [])

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  // Load activities
  const loadActivities = useCallback(async () => {
    try {
      const actData = await api.getActivityLog(15)
      setActivities(actData)
    } catch {
      // Non-blocking activity fetch error
    }
  }, [])

  // Fetch tasks helper for manual reload/retry
  const loadTasks = useCallback(async () => {
    try {
      setIsLoading(true)
      setErrorMessage(null)
      const data = await api.getTasks()
      setTasks(data)
      setIsServerConnected(true)
      await loadActivities()
    } catch (err) {
      console.error('Failed to fetch tasks:', err)
      setErrorMessage(err.message || 'Failed to connect to backend server.')
      setIsServerConnected(false)
    } finally {
      setIsLoading(false)
    }
  }, [loadActivities])

  // Initial load on mount
  useEffect(() => {
    let isMounted = true

    Promise.all([api.getTasks(), api.getActivityLog(15)])
      .then(([tasksData, actData]) => {
        if (isMounted) {
          setTasks(tasksData)
          setActivities(actData)
          setIsServerConnected(true)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Failed to fetch initial data:', err)
          setErrorMessage(err.message || 'Failed to connect to backend server.')
          setIsServerConnected(false)
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  // Auto-focus edit input when inline editing starts
  useEffect(() => {
    if (editingTaskId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingTaskId])

  // Global Keyboard shortcuts (/ for search, Esc to dismiss)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        e.key === '/' &&
        document.activeElement !== taskInputRef.current &&
        document.activeElement !== searchInputRef.current &&
        document.activeElement !== editInputRef.current
      ) {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'Escape') {
        if (editingTaskId) {
          setEditingTaskId(null)
        } else if (document.activeElement === searchInputRef.current) {
          setSearchQuery('')
          searchInputRef.current?.blur()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingTaskId])

  // Add Task
  const handleAddTask = async (e) => {
    e.preventDefault()
    const trimmedTitle = newTaskTitle.trim()
    if (!trimmedTitle || isSubmitting) return

    setIsSubmitting(true)
    setErrorMessage(null)

    const tempId = `temp-${Date.now()}`
    const optimisticTask = {
      id: tempId,
      title: trimmedTitle,
      priority: newPriority,
      completed: false,
      createdAt: new Date().toISOString()
    }

    setTasks((prev) => [optimisticTask, ...prev])
    setNewTaskTitle('')

    try {
      const createdTask = await api.createTask({
        title: trimmedTitle,
        priority: newPriority
      })
      setTasks((prev) => prev.map((t) => (t.id === tempId ? createdTask : t)))
      setIsServerConnected(true)
      showToast(`Created task "${trimmedTitle}"`)
      loadActivities()
    } catch (err) {
      console.error('Failed to create task:', err)
      setTasks((prev) => prev.filter((t) => t.id !== tempId))
      setErrorMessage(`Failed to add task: ${err.message}`)
      showToast(`Error adding task: ${err.message}`, 'error')
      setNewTaskTitle(trimmedTitle)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Toggle Task Completion
  const handleToggleTask = async (task) => {
    const nextCompleted = !task.completed

    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, completed: nextCompleted } : t))
    )

    try {
      await api.updateTask(task.id, { completed: nextCompleted })
      setIsServerConnected(true)
      showToast(nextCompleted ? `Marked "${task.title}" complete` : `Marked "${task.title}" active`)
      loadActivities()
    } catch (err) {
      console.error('Failed to update task:', err)
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t))
      )
      setErrorMessage(`Failed to update task: ${err.message}`)
      showToast(`Failed to update task: ${err.message}`, 'error')
    }
  }

  // Start Inline Edit
  const handleStartEdit = (task) => {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
  }

  // Save Inline Edit
  const handleSaveEdit = async (task) => {
    if (!editingTaskId) return
    const trimmed = editingTitle.trim()

    if (!trimmed || trimmed === task.title) {
      setEditingTaskId(null)
      return
    }

    const previousTitle = task.title
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, title: trimmed } : t))
    )
    setEditingTaskId(null)

    try {
      await api.updateTask(task.id, { title: trimmed })
      setIsServerConnected(true)
      showToast(`Renamed task to "${trimmed}"`)
      loadActivities()
    } catch (err) {
      console.error('Failed to rename task:', err)
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, title: previousTitle } : t))
      )
      showToast(`Failed to rename task: ${err.message}`, 'error')
    }
  }

  // Delete Task
  const handleDeleteTask = async (task) => {
    const previousTasks = [...tasks]
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    setSelectedTaskIds((prev) => prev.filter((id) => id !== task.id))

    try {
      await api.deleteTask(task.id)
      setIsServerConnected(true)
      showToast(`Deleted "${task.title}"`)
      loadActivities()
    } catch (err) {
      console.error('Failed to delete task:', err)
      setTasks(previousTasks)
      showToast(`Failed to delete task: ${err.message}`, 'error')
    }
  }

  // Clear Completed Tasks
  const handleClearCompleted = async () => {
    const completedTasks = tasks.filter((t) => t.completed)
    if (completedTasks.length === 0) return

    const previousTasks = [...tasks]
    setTasks((prev) => prev.filter((t) => !t.completed))
    setSelectedTaskIds([])

    try {
      const res = await api.clearCompletedTasks()
      setIsServerConnected(true)
      showToast(res.message || `Purged ${completedTasks.length} completed tasks`)
      loadActivities()
    } catch (err) {
      console.error('Failed to clear completed tasks:', err)
      setTasks(previousTasks)
      showToast(`Failed to clear completed: ${err.message}`, 'error')
    }
  }

  // Multi-Selection Toggle
  const handleToggleSelect = (taskId) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    )
  }

  // Batch Status Update
  const handleBatchStatus = async (completed) => {
    if (selectedTaskIds.length === 0) return
    const idsToUpdate = [...selectedTaskIds]

    setTasks((prev) =>
      prev.map((t) => (idsToUpdate.includes(t.id) ? { ...t, completed } : t))
    )
    setSelectedTaskIds([])

    try {
      const res = await api.batchCompleteTasks(idsToUpdate, completed)
      setIsServerConnected(true)
      showToast(res.message || `Updated ${idsToUpdate.length} tasks`)
      loadActivities()
    } catch (err) {
      console.error('Failed to batch update:', err)
      loadTasks()
      showToast(`Failed to batch update: ${err.message}`, 'error')
    }
  }

  // Metrics Calculations
  const metrics = useMemo(() => {
    const total = tasks.length
    const completed = tasks.filter((t) => t.completed).length
    const pending = total - completed
    const highPriorityPending = tasks.filter((t) => !t.completed && t.priority === 'high').length
    return { total, completed, pending, highPriorityPending }
  }, [tasks])

  // Filtered & Sorted Tasks
  const filteredTasks = useMemo(() => {
    let result = tasks.filter((task) => {
      // Tab filter
      if (activeTab === 'active' && task.completed) return false
      if (activeTab === 'completed' && !task.completed) return false

      // Priority filter
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false

      // Search filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.trim().toLowerCase()
        return task.title.toLowerCase().includes(query)
      }

      return true
    })

    // Sorting
    if (sortBy === 'oldest') {
      result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    } else if (sortBy === 'priority') {
      const pWeights = { high: 3, medium: 2, low: 1 }
      result.sort((a, b) => (pWeights[b.priority] || 0) - (pWeights[a.priority] || 0))
    } else if (sortBy === 'alphabetical') {
      result.sort((a, b) => a.title.localeCompare(b.title))
    } else {
      // Default newest
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    }

    return result
  }, [tasks, activeTab, priorityFilter, searchQuery, sortBy])

  const areAllFilteredSelected =
    filteredTasks.length > 0 &&
    filteredTasks.every((t) => selectedTaskIds.includes(t.id))

  const handleSelectAllFiltered = () => {
    if (areAllFilteredSelected) {
      setSelectedTaskIds([])
    } else {
      setSelectedTaskIds(filteredTasks.map((t) => t.id))
    }
  }

  return (
    <div className="app-container">
      {/* Toast Notification Container */}
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type === 'error' ? 'toast-error' : ''}`}>
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast-close-btn"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="app-header">
        <div className="header-title-group">
          <h1>Task Registry</h1>
          <div className="header-meta">
            <span
              className={`status-dot ${isServerConnected ? '' : 'offline'}`}
              title={isServerConnected ? 'Backend Connected' : 'Backend Disconnected'}
            />
            <span>
              {isServerConnected
                ? `System active • ${metrics.pending} pending item${metrics.pending === 1 ? '' : 's'}`
                : 'Offline mode — cannot reach server'}
            </span>
          </div>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className={`btn-secondary ${isActivityOpen ? 'active' : ''}`}
            onClick={() => setIsActivityOpen(!isActivityOpen)}
            title="Toggle system activity log"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Activity {activities.length > 0 && `(${activities.length})`}
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={loadTasks}
            title="Refresh tasks from server"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            Sync
          </button>
        </div>
      </header>

      {/* Error / Offline Alert */}
      {errorMessage && (
        <div className="notice-banner" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={loadTasks}>
            Retry
          </button>
        </div>
      )}

      {/* Metrics Bar */}
      <section className="metrics-bar" aria-label="Task Summary Metrics">
        <div className="metric-card">
          <span className="metric-label">Total Tasks</span>
          <span className="metric-value">{metrics.total}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Pending</span>
          <span className="metric-value">{metrics.pending}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Completed</span>
          <span className="metric-value">{metrics.completed}</span>
        </div>
        <div className={`metric-card ${metrics.highPriorityPending > 0 ? 'highlight' : ''}`}>
          <span className="metric-label">High Priority</span>
          <span className="metric-value">{metrics.highPriorityPending}</span>
        </div>
      </section>

      {/* Task Input Form */}
      <section className="task-form-card" aria-label="Add Task">
        <form onSubmit={handleAddTask}>
          <div className="input-row">
            <input
              ref={taskInputRef}
              type="text"
              className="task-input"
              placeholder="Add a new task... (press Enter to save)"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              disabled={isSubmitting}
              autoFocus
              aria-label="New task title"
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={!newTaskTitle.trim() || isSubmitting}
            >
              {isSubmitting ? 'Adding...' : 'Add Task'}
            </button>
          </div>

          <div className="form-controls-row" style={{ marginTop: '10px' }}>
            <div className="priority-selector-group">
              <span className="priority-label">Priority:</span>
              <div className="priority-options" role="radiogroup" aria-label="Task Priority">
                <button
                  type="button"
                  className={`priority-btn ${newPriority === 'low' ? 'active priority-low' : ''}`}
                  onClick={() => setNewPriority('low')}
                  role="radio"
                  aria-checked={newPriority === 'low'}
                >
                  Low
                </button>
                <button
                  type="button"
                  className={`priority-btn ${newPriority === 'medium' ? 'active priority-medium' : ''}`}
                  onClick={() => setNewPriority('medium')}
                  role="radio"
                  aria-checked={newPriority === 'medium'}
                >
                  Medium
                </button>
                <button
                  type="button"
                  className={`priority-btn ${newPriority === 'high' ? 'active priority-high' : ''}`}
                  onClick={() => setNewPriority('high')}
                  role="radio"
                  aria-checked={newPriority === 'high'}
                >
                  High
                </button>
              </div>
            </div>
            <span className="input-hint">Enter ↵ to save</span>
          </div>
        </form>
      </section>

      {/* Primary Tabs & Search Toolbar */}
      <section className="toolbar" aria-label="Task Filters">
        <div className="tabs-group" role="tablist">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
            role="tab"
            aria-selected={activeTab === 'all'}
          >
            All <span className="tab-count">{metrics.total}</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => setActiveTab('active')}
            role="tab"
            aria-selected={activeTab === 'active'}
          >
            Active <span className="tab-count">{metrics.pending}</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'completed' ? 'active' : ''}`}
            onClick={() => setActiveTab('completed')}
            role="tab"
            aria-selected={activeTab === 'completed'}
          >
            Completed <span className="tab-count">{metrics.completed}</span>
          </button>
        </div>

        <div className="search-and-filters">
          <div className="search-input-wrapper">
            <input
              ref={searchInputRef}
              type="text"
              className="search-input"
              placeholder="Search tasks... (/)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search tasks"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search query"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Priority Filter Chips & Sort Controls */}
      <section className="filter-controls-bar" aria-label="Priority Filter and Sorting">
        <div className="priority-chips-group">
          <span className="sort-label">Priority:</span>
          {['all', 'high', 'medium', 'low'].map((p) => (
            <button
              key={p}
              type="button"
              className={`priority-chip ${priorityFilter === p ? 'active' : ''}`}
              onClick={() => setPriorityFilter(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        <div className="sort-group">
          <label htmlFor="sort-select" className="sort-label">Sort by:</label>
          <select
            id="sort-select"
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="priority">Priority (High to Low)</option>
            <option value="alphabetical">Title (A-Z)</option>
          </select>
        </div>
      </section>

      {/* Multi-Selection Batch Action Bar */}
      {selectedTaskIds.length > 0 && (
        <section className="selection-action-bar" aria-label="Batch Actions">
          <span className="selection-count-text">
            {selectedTaskIds.length} item{selectedTaskIds.length === 1 ? '' : 's'} selected
          </span>
          <div className="selection-buttons">
            <button
              type="button"
              className="btn-batch primary"
              onClick={() => handleBatchStatus(true)}
            >
              Mark Complete
            </button>
            <button
              type="button"
              className="btn-batch"
              onClick={() => handleBatchStatus(false)}
            >
              Mark Active
            </button>
            <button
              type="button"
              className="btn-batch"
              onClick={() => setSelectedTaskIds([])}
            >
              Deselect All
            </button>
          </div>
        </section>
      )}

      {/* Task List */}
      <section className="task-list-container" aria-label="Task List">
        <div className="task-list-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              className="select-checkbox"
              checked={areAllFilteredSelected}
              onChange={handleSelectAllFiltered}
              aria-label="Select all displayed tasks"
              title="Select all"
            />
            <span>Items ({filteredTasks.length})</span>
          </div>
          <span>Priority & Actions</span>
        </div>

        {isLoading ? (
          <div className="loading-state">Loading tasks from registry...</div>
        ) : filteredTasks.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-title">
              {searchQuery
                ? `No tasks matching "${searchQuery}"`
                : priorityFilter !== 'all'
                ? `No ${priorityFilter} priority tasks found`
                : activeTab === 'completed'
                ? 'No completed tasks recorded'
                : activeTab === 'active'
                ? 'All pending tasks completed'
                : 'No tasks registered'}
            </span>
            <span className="empty-state-subtitle">
              {searchQuery || priorityFilter !== 'all'
                ? 'Try adjusting your filters or search terms.'
                : 'Type a task in the field above and press Enter.'}
            </span>
          </div>
        ) : (
          <ul className="task-list">
            {filteredTasks.map((task) => (
              <li
                key={task.id}
                className={`task-item ${task.completed ? 'completed' : ''} ${
                  selectedTaskIds.includes(task.id) ? 'selected' : ''
                }`}
              >
                <div className="task-item-left">
                  <input
                    type="checkbox"
                    className="select-checkbox"
                    checked={selectedTaskIds.includes(task.id)}
                    onChange={() => handleToggleSelect(task.id)}
                    aria-label={`Select task "${task.title}"`}
                  />

                  <button
                    type="button"
                    className={`custom-checkbox-btn ${task.completed ? 'checked' : ''}`}
                    onClick={() => handleToggleTask(task)}
                    role="checkbox"
                    aria-checked={task.completed}
                    aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
                  >
                    {task.completed && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>

                  <div className="task-content">
                    {editingTaskId === task.id ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        className="inline-edit-input"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => handleSaveEdit(task)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(task)
                          if (e.key === 'Escape') setEditingTaskId(null)
                        }}
                        aria-label="Edit task title"
                      />
                    ) : (
                      <>
                        <span
                          className="task-title"
                          onDoubleClick={() => handleStartEdit(task)}
                          title="Double-click to edit title"
                        >
                          {task.title}
                        </span>
                        <button
                          type="button"
                          className="btn-edit-title"
                          onClick={() => handleStartEdit(task)}
                          aria-label={`Edit title for "${task.title}"`}
                          title="Edit title"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="task-item-right">
                  <span className={`priority-badge priority-${task.priority}`}>
                    {task.priority}
                  </span>

                  <span className="task-timestamp" title={task.createdAt ? new Date(task.createdAt).toLocaleString() : ''}>
                    {formatTimeAgo(task.createdAt)}
                  </span>

                  <button
                    type="button"
                    className="btn-delete"
                    onClick={() => handleDeleteTask(task)}
                    aria-label={`Delete task "${task.title}"`}
                    title="Delete task"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Footer */}
        <footer className="task-list-footer">
          <span>
            {metrics.completed} of {metrics.total} task{metrics.total === 1 ? '' : 's'} completed
          </span>
          {metrics.completed > 0 && (
            <button
              type="button"
              className="btn-link"
              onClick={handleClearCompleted}
            >
              Clear completed ({metrics.completed})
            </button>
          )}
        </footer>
      </section>

      {/* Collapsible Activity Log Drawer */}
      {isActivityOpen && (
        <section className="activity-drawer" aria-label="System Activity Log">
          <div
            className="activity-drawer-header"
            onClick={() => setIsActivityOpen(false)}
            title="Click to collapse activity log"
          >
            <div className="activity-drawer-title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Recent System Activity</span>
              <span className="activity-badge">{activities.length}</span>
            </div>
            <button
              type="button"
              className="btn-link"
              onClick={(e) => {
                e.stopPropagation()
                setIsActivityOpen(false)
              }}
            >
              Close
            </button>
          </div>

          <ul className="activity-list">
            {activities.length === 0 ? (
              <li className="activity-item">
                <span className="activity-item-message" style={{ color: 'var(--text-muted)' }}>
                  No recent activities recorded.
                </span>
              </li>
            ) : (
              activities.map((act) => (
                <li key={act.id} className="activity-item">
                  <span className="activity-item-message">{act.message}</span>
                  <span className="activity-item-time">{formatTimeAgo(act.timestamp)}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      )}

      {/* Shortcuts Legend */}
      <div className="shortcuts-legend">
        <span><kbd className="key-badge">↵</kbd> Save task / Edit</span>
        <span><kbd className="key-badge">2× Click</kbd> Inline edit</span>
        <span><kbd className="key-badge">/</kbd> Quick search</span>
        <span><kbd className="key-badge">Esc</kbd> Cancel edit / Clear search</span>
      </div>
    </div>
  )
}
