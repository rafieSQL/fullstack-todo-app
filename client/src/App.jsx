import { useState, useEffect, useMemo, useRef } from 'react'
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
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'active' | 'completed'
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [isServerConnected, setIsServerConnected] = useState(true)

  const taskInputRef = useRef(null)
  const searchInputRef = useRef(null)

  // Fetch tasks helper for manual reload/retry
  const loadTasks = async () => {
    try {
      setIsLoading(true)
      setErrorMessage(null)
      const data = await api.getTasks()
      setTasks(data)
      setIsServerConnected(true)
    } catch (err) {
      console.error('Failed to fetch tasks:', err)
      setErrorMessage(err.message || 'Failed to connect to backend server.')
      setIsServerConnected(false)
    } finally {
      setIsLoading(false)
    }
  }

  // Initial load on mount with cancellation support
  useEffect(() => {
    let isMounted = true

    api.getTasks()
      .then((data) => {
        if (isMounted) {
          setTasks(data)
          setIsServerConnected(true)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Failed to fetch tasks:', err)
          setErrorMessage(err.message || 'Failed to connect to backend server.')
          setIsServerConnected(false)
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  // Keyboard shortcut listener (/ to focus search)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        e.key === '/' &&
        document.activeElement !== taskInputRef.current &&
        document.activeElement !== searchInputRef.current
      ) {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'Escape') {
        if (document.activeElement === searchInputRef.current) {
          setSearchQuery('')
          searchInputRef.current?.blur()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Add Task
  const handleAddTask = async (e) => {
    e.preventDefault()
    const trimmedTitle = newTaskTitle.trim()
    if (!trimmedTitle || isSubmitting) return

    setIsSubmitting(true)
    setErrorMessage(null)

    // Temporary optimistic task
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
      // Replace optimistic item with server item
      setTasks((prev) => prev.map((t) => (t.id === tempId ? createdTask : t)))
      setIsServerConnected(true)
    } catch (err) {
      console.error('Failed to create task:', err)
      // Rollback
      setTasks((prev) => prev.filter((t) => t.id !== tempId))
      setErrorMessage(`Failed to add task: ${err.message}`)
      setNewTaskTitle(trimmedTitle)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Toggle Task Completion
  const handleToggleTask = async (task) => {
    const nextCompleted = !task.completed

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, completed: nextCompleted } : t))
    )

    try {
      await api.updateTask(task.id, { completed: nextCompleted })
      setIsServerConnected(true)
    } catch (err) {
      console.error('Failed to update task:', err)
      // Rollback on error
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t))
      )
      setErrorMessage(`Failed to update task status: ${err.message}`)
    }
  }

  // Delete Task
  const handleDeleteTask = async (taskId) => {
    const previousTasks = [...tasks]
    setTasks((prev) => prev.filter((t) => t.id !== taskId))

    try {
      await api.deleteTask(taskId)
      setIsServerConnected(true)
    } catch (err) {
      console.error('Failed to delete task:', err)
      // Rollback
      setTasks(previousTasks)
      setErrorMessage(`Failed to delete task: ${err.message}`)
    }
  }

  // Clear All Completed
  const handleClearCompleted = async () => {
    const completedCount = tasks.filter((t) => t.completed).length
    if (completedCount === 0) return

    const previousTasks = [...tasks]
    setTasks((prev) => prev.filter((t) => !t.completed))

    try {
      await api.clearCompletedTasks()
      setIsServerConnected(true)
    } catch (err) {
      console.error('Failed to clear completed tasks:', err)
      setTasks(previousTasks)
      setErrorMessage(`Failed to clear completed tasks: ${err.message}`)
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

  // Filtered & Searched Tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Tab filter
      if (activeTab === 'active' && task.completed) return false
      if (activeTab === 'completed' && !task.completed) return false

      // Search filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.trim().toLowerCase()
        return task.title.toLowerCase().includes(query)
      }

      return true
    })
  }, [tasks, activeTab, searchQuery])

  return (
    <div className="app-container">
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

      {/* Toolbar & Filters */}
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

      {/* Task List */}
      <section className="task-list-container" aria-label="Task List">
        <div className="task-list-header">
          <span>Items ({filteredTasks.length})</span>
          <span>Priority & Actions</span>
        </div>

        {isLoading ? (
          <div className="loading-state">Loading tasks from registry...</div>
        ) : filteredTasks.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-title">
              {searchQuery
                ? `No tasks matching "${searchQuery}"`
                : activeTab === 'completed'
                ? 'No completed tasks recorded'
                : activeTab === 'active'
                ? 'All pending tasks completed'
                : 'No tasks registered'}
            </span>
            <span className="empty-state-subtitle">
              {searchQuery
                ? 'Try clearing the search query or changing active filters.'
                : 'Type a task in the field above and press Enter.'}
            </span>
          </div>
        ) : (
          <ul className="task-list">
            {filteredTasks.map((task) => (
              <li
                key={task.id}
                className={`task-item ${task.completed ? 'completed' : ''}`}
              >
                <div className="task-item-left">
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
                    <span className="task-title">{task.title}</span>
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
                    onClick={() => handleDeleteTask(task.id)}
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

      {/* Shortcuts Legend */}
      <div className="shortcuts-legend">
        <span><kbd className="key-badge">↵</kbd> Save task</span>
        <span><kbd className="key-badge">/</kbd> Quick search</span>
        <span><kbd className="key-badge">Esc</kbd> Clear filter</span>
      </div>
    </div>
  )
}
