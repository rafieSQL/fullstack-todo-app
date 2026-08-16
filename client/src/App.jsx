import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as api from './api.js'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { validateTaskTitle, sanitizeText } from './utils/sanitize.js'
import Auth from './components/Auth.jsx'
import './App.css'

const CATEGORIES = ['General', 'Engineering', 'Design', 'Personal']

const CATEGORY_ABBR = {
  General: 'GEN',
  Engineering: 'ENG',
  Design: 'DES',
  Personal: 'PERS'
}

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
  // Auth state initialized based on configuration
  const [session, setSession] = useState(null)
  const [authInitialized, setAuthInitialized] = useState(() => !isSupabaseConfigured)
  const [isDemoMode, setIsDemoMode] = useState(() => !isSupabaseConfigured)

  // Data state
  const [tasks, setTasks] = useState([])
  const [activities, setActivities] = useState([])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [newCategory, setNewCategory] = useState('General')

  // Filter & Sort state
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'active' | 'completed'
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('custom') // 'custom' | 'newest' | 'oldest' | 'priority' | 'alphabetical'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTaskIds, setSelectedTaskIds] = useState([])
  const [isActivityOpen, setIsActivityOpen] = useState(false)

  // Theme state
  const [theme, setTheme] = useState(() => {
    return (
      localStorage.getItem('task-registry-theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light')
    )
  })

  // Drag-and-Drop state
  const [draggedTaskId, setDraggedTaskId] = useState(null)
  const [dragOverTaskId, setDragOverTaskId] = useState(null)
  const [dropPosition, setDropPosition] = useState(null)

  // Inline editing state
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')

  // UI state
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [toasts, setToasts] = useState([])

  const taskInputRef = useRef(null)
  const searchInputRef = useRef(null)
  const editInputRef = useRef(null)

  // Theme synchronization effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('task-registry-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  // Toast notification helper
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
      // Non-blocking
    }
  }, [])

  // Fetch tasks helper for manual user sync/retry
  const loadTasks = useCallback(
    async (showLoadingSpinner = true) => {
      try {
        if (showLoadingSpinner) setIsLoading(true)
        setErrorMessage(null)
        const data = await api.getTasks()
        setTasks(data)
        await loadActivities()
      } catch (err) {
        console.error('Failed to fetch tasks:', err)
        setErrorMessage(err.message || 'Failed to connect to database.')
      } finally {
        if (showLoadingSpinner) setIsLoading(false)
      }
    },
    [loadActivities]
  )

  // 1. Initialize Supabase Auth Session
  useEffect(() => {
    if (!isSupabaseConfigured) return

    let isMounted = true

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (isMounted) {
        setSession(currentSession)
        setAuthInitialized(true)
      }
    })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (isMounted) {
        setSession(currentSession)
        if (currentSession) {
          setIsDemoMode(false)
        }
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  // 2. Fetch Tasks when session or demo mode is active
  useEffect(() => {
    if (!authInitialized) return
    if (session || isDemoMode) {
      let isMounted = true

      Promise.all([api.getTasks(), api.getActivityLog(15)])
        .then(([tasksData, actData]) => {
          if (isMounted) {
            setTasks(tasksData)
            setActivities(actData)
            setIsLoading(false)
          }
        })
        .catch((err) => {
          if (isMounted) {
            console.error('Failed to fetch tasks:', err)
            setErrorMessage(err.message || 'Failed to connect to database.')
            setIsLoading(false)
          }
        })

      return () => {
        isMounted = false
      }
    }
  }, [authInitialized, session, isDemoMode])

  // 3. Supabase Realtime Channel Subscription
  useEffect(() => {
    if (!isSupabaseConfigured || !session) return

    const channel = supabase
      .channel('public:tasks-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        () => {
          loadTasks(false)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session, loadTasks])

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

  // Sign out handler
  const handleSignOut = async () => {
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut()
      }
      setSession(null)
      setIsDemoMode(false)
      showToast('Signed out of session')
    } catch (err) {
      console.error('Sign out error:', err)
      showToast('Failed to sign out', 'error')
    }
  }

  // Add Task with input sanitization and length validation
  const handleAddTask = async (e) => {
    e.preventDefault()
    const validation = validateTaskTitle(newTaskTitle)

    if (!validation.isValid) {
      setErrorMessage(validation.error)
      showToast(validation.error, 'error')
      return
    }

    if (isSubmitting) return

    setIsSubmitting(true)
    setErrorMessage(null)

    const sanitizedTitle = validation.sanitized
    const tempId = `temp-${Date.now()}`
    const optimisticTask = {
      id: tempId,
      title: sanitizedTitle,
      priority: newPriority,
      category: newCategory,
      order: 0,
      completed: false,
      created_at: new Date().toISOString()
    }

    setTasks((prev) => [optimisticTask, ...prev])
    setNewTaskTitle('')

    try {
      const createdTask = await api.createTask({
        title: sanitizedTitle,
        priority: newPriority,
        category: newCategory,
        userId: session?.user?.id
      })
      setTasks((prev) => prev.map((t) => (t.id === tempId ? createdTask : t)))
      showToast(`Created task in ${newCategory}`)
      loadActivities()
    } catch (err) {
      console.error('Failed to create task:', err)
      setTasks((prev) => prev.filter((t) => t.id !== tempId))
      setErrorMessage(`Failed to add task: ${err.message}`)
      showToast(`Error adding task: ${err.message}`, 'error')
      setNewTaskTitle(sanitizedTitle)
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
      await api.updateTask(task.id, { completed: nextCompleted }, session?.user?.id)
      showToast(nextCompleted ? `Marked "${task.title}" complete` : `Marked "${task.title}" active`)
      loadActivities()
    } catch (err) {
      console.error('Failed to update task:', err)
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t))
      )
      showToast(`Failed to update task: ${err.message}`, 'error')
    }
  }

  // Start Inline Edit
  const handleStartEdit = (task) => {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
  }

  // Save Inline Edit with sanitization and validation
  const handleSaveEdit = async (task) => {
    if (!editingTaskId) return
    const validation = validateTaskTitle(editingTitle)

    if (!validation.isValid) {
      showToast(validation.error, 'error')
      setEditingTaskId(null)
      return
    }

    const sanitizedTitle = validation.sanitized

    if (sanitizedTitle === task.title) {
      setEditingTaskId(null)
      return
    }

    const previousTitle = task.title
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, title: sanitizedTitle } : t))
    )
    setEditingTaskId(null)

    try {
      await api.updateTask(task.id, { title: sanitizedTitle }, session?.user?.id)
      showToast(`Renamed task to "${sanitizedTitle}"`)
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
      await api.deleteTask(task.id, task.title, session?.user?.id)
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
      const res = await api.clearCompletedTasks(session?.user?.id)
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
      await api.batchCompleteTasks(idsToUpdate, completed, session?.user?.id)
      showToast(`Updated ${idsToUpdate.length} tasks`)
      loadActivities()
    } catch (err) {
      console.error('Failed to batch update:', err)
      loadTasks(false)
      showToast(`Failed to batch update: ${err.message}`, 'error')
    }
  }

  // Drag and Drop Handlers
  const handleDragStart = (e, task) => {
    setDraggedTaskId(task.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', task.id)
  }

  const handleDragOver = (e, targetTask) => {
    e.preventDefault()
    if (!draggedTaskId || draggedTaskId === targetTask.id) return

    const rect = e.currentTarget.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const pos = e.clientY < midY ? 'top' : 'bottom'

    setDragOverTaskId(targetTask.id)
    setDropPosition(pos)
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOverTaskId(null)
    setDropPosition(null)
  }

  const handleDrop = async (e, targetTask) => {
    e.preventDefault()
    if (!draggedTaskId || draggedTaskId === targetTask.id) {
      setDraggedTaskId(null)
      setDragOverTaskId(null)
      setDropPosition(null)
      return
    }

    const currentList = [...tasks]
    const draggedIndex = currentList.findIndex((t) => t.id === draggedTaskId)
    const targetIndex = currentList.findIndex((t) => t.id === targetTask.id)

    if (draggedIndex === -1 || targetIndex === -1) return

    const [draggedItem] = currentList.splice(draggedIndex, 1)
    const insertIndex = currentList.findIndex((t) => t.id === targetTask.id)
    const finalIndex = dropPosition === 'bottom' ? insertIndex + 1 : insertIndex

    currentList.splice(finalIndex, 0, draggedItem)

    const updatedList = currentList.map((t, idx) => ({ ...t, order: idx }))
    setTasks(updatedList)

    setDraggedTaskId(null)
    setDragOverTaskId(null)
    setDropPosition(null)

    try {
      const orderedIds = updatedList.map((t) => t.id)
      await api.reorderTasks(orderedIds, session?.user?.id)
      showToast('Task sequence reordered')
      loadActivities()
    } catch (err) {
      console.error('Failed to save task order:', err)
      showToast('Failed to save order to database', 'error')
    }
  }

  const handleDragEnd = () => {
    setDraggedTaskId(null)
    setDragOverTaskId(null)
    setDropPosition(null)
  }

  // Metrics Calculations
  const metrics = useMemo(() => {
    const total = tasks.length
    const completed = tasks.filter((t) => t.completed).length
    const pending = total - completed
    const highPriorityPending = tasks.filter((t) => !t.completed && t.priority === 'high').length
    return { total, completed, pending, highPriorityPending }
  }, [tasks])

  // Category item counts
  const categoryCounts = useMemo(() => {
    const counts = { all: tasks.length }
    CATEGORIES.forEach((cat) => {
      counts[cat] = tasks.filter((t) => (t.category || 'General').toLowerCase() === cat.toLowerCase()).length
    })
    return counts
  }, [tasks])

  // Filtered & Sorted Tasks with search sanitization
  const filteredTasks = useMemo(() => {
    const sanitizedSearch = sanitizeText(searchQuery, 100).toLowerCase()

    let result = tasks.filter((task) => {
      if (activeTab === 'active' && task.completed) return false
      if (activeTab === 'completed' && !task.completed) return false

      if (
        categoryFilter !== 'all' &&
        (task.category || 'General').toLowerCase() !== categoryFilter.toLowerCase()
      ) {
        return false
      }

      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false

      if (sanitizedSearch !== '') {
        return (
          task.title.toLowerCase().includes(sanitizedSearch) ||
          (task.category || '').toLowerCase().includes(sanitizedSearch)
        )
      }

      return true
    })

    if (sortBy === 'newest') {
      result.sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt))
    } else if (sortBy === 'oldest') {
      result.sort((a, b) => new Date(a.created_at || a.createdAt) - new Date(b.created_at || b.createdAt))
    } else if (sortBy === 'priority') {
      const pWeights = { high: 3, medium: 2, low: 1 }
      result.sort((a, b) => (pWeights[b.priority] || 0) - (pWeights[a.priority] || 0))
    } else if (sortBy === 'alphabetical') {
      result.sort((a, b) => a.title.localeCompare(b.title))
    } else {
      result.sort((a, b) => {
        const orderA = typeof a.order === 'number' ? a.order : 9999
        const orderB = typeof b.order === 'number' ? b.order : 9999
        if (orderA !== orderB) return orderA - orderB
        return new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt)
      })
    }

    return result
  }, [tasks, activeTab, categoryFilter, priorityFilter, searchQuery, sortBy])

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

  const isDnDActive =
    sortBy === 'custom' &&
    searchQuery.trim() === '' &&
    categoryFilter === 'all' &&
    activeTab === 'all' &&
    priorityFilter === 'all'

  // If waiting for auth check
  if (!authInitialized) {
    return (
      <div className="loading-state" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Verifying security session...
      </div>
    )
  }

  // Render Auth screen if unauthenticated and not in demo mode
  if (!session && !isDemoMode) {
    return (
      <div className="app-container">
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

        <Auth onDemoAccess={() => setIsDemoMode(true)} />
      </div>
    )
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
              className={`status-dot ${session || isDemoMode ? '' : 'offline'}`}
              title={isSupabaseConfigured ? 'Supabase PostgreSQL Connected' : 'Demo Sandbox Mode'}
            />
            <span>
              {isSupabaseConfigured
                ? `Supabase DB Live • ${metrics.pending} pending item${metrics.pending === 1 ? '' : 's'}`
                : `Sandbox Mode • ${metrics.pending} pending item${metrics.pending === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        <div className="header-actions">
          {/* User Session Info */}
          {session ? (
            <div className="user-session-group" title={`Signed in as ${session.user?.email}`}>
              <span className="user-email-badge">{session.user?.email}</span>
              <button type="button" className="btn-signout" onClick={handleSignOut}>
                Sign Out
              </button>
            </div>
          ) : (
            <div className="user-session-group">
              <span className="user-email-badge">Guest Operator</span>
              <button
                type="button"
                className="btn-signout"
                onClick={() => setIsDemoMode(false)}
              >
                Sign In
              </button>
            </div>
          )}

          {/* Theme Switcher Button */}
          <button
            type="button"
            className="btn-theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

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
            onClick={() => loadTasks(true)}
            title="Refresh tasks from database"
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

      {/* Error / Notice Banner */}
      {errorMessage && (
        <div className="notice-banner" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => loadTasks(true)}>
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
              maxLength={250}
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

          <div className="form-controls-row" style={{ marginTop: '12px' }}>
            <div className="form-selectors-left">
              {/* Category Selector */}
              <div className="selector-group">
                <span className="selector-label">Category:</span>
                <div className="selector-options" role="radiogroup" aria-label="Task Category">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`control-btn ${newCategory === cat ? 'active category-active' : ''}`}
                      onClick={() => setNewCategory(cat)}
                      role="radio"
                      aria-checked={newCategory === cat}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Priority Selector */}
              <div className="selector-group">
                <span className="selector-label">Priority:</span>
                <div className="selector-options" role="radiogroup" aria-label="Task Priority">
                  {['low', 'medium', 'high'].map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`control-btn ${newPriority === p ? `active priority-${p}` : ''}`}
                      onClick={() => setNewPriority(p)}
                      role="radio"
                      aria-checked={newPriority === p}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <span className="input-hint">Enter ↵ to save</span>
          </div>
        </form>
      </section>

      {/* Horizontal Category Workspace Bar */}
      <section className="category-filter-bar" aria-label="Filter by Category">
        <span className="cat-filter-label">Workspaces:</span>
        <button
          type="button"
          className={`cat-filter-chip ${categoryFilter === 'all' ? 'active' : ''}`}
          onClick={() => setCategoryFilter('all')}
        >
          ALL ({categoryCounts.all || 0})
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`cat-filter-chip ${categoryFilter === cat ? 'active' : ''}`}
            onClick={() => setCategoryFilter(cat)}
          >
            {CATEGORY_ABBR[cat]} ({categoryCounts[cat] || 0})
          </button>
        ))}
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
              maxLength={100}
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

      {/* Secondary Filter Bar: Priority Chips & Sorting */}
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
          <label htmlFor="sort-select" className="sort-label">Sort:</label>
          <select
            id="sort-select"
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="custom">Custom Order (Drag & Drop)</option>
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
            <span>
              Items ({filteredTasks.length})
              {isDnDActive && (
                <span style={{ fontSize: '11px', fontWeight: 'normal', marginLeft: '6px', color: 'var(--text-subtle)' }}>
                  • Drag ⋮⋮ to reorder
                </span>
              )}
            </span>
          </div>
          <span>Tags, Priority & Actions</span>
        </div>

        {isLoading ? (
          <div className="loading-state">Loading tasks from registry...</div>
        ) : filteredTasks.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-title">
              {searchQuery
                ? `No tasks matching "${searchQuery}"`
                : categoryFilter !== 'all'
                ? `No tasks in workspace "${categoryFilter}"`
                : priorityFilter !== 'all'
                ? `No ${priorityFilter} priority tasks found`
                : activeTab === 'completed'
                ? 'No completed tasks recorded'
                : activeTab === 'active'
                ? 'All pending tasks completed'
                : 'No tasks registered'}
            </span>
            <span className="empty-state-subtitle">
              {searchQuery || categoryFilter !== 'all' || priorityFilter !== 'all'
                ? 'Try adjusting your filters or search terms.'
                : 'Type a task in the field above and press Enter.'}
            </span>
          </div>
        ) : (
          <ul className="task-list">
            {filteredTasks.map((task) => {
              const isDragging = draggedTaskId === task.id
              const isDragOver = dragOverTaskId === task.id
              const isDragOverTop = isDragOver && dropPosition === 'top'
              const isDragOverBottom = isDragOver && dropPosition === 'bottom'

              const categoryClass = `cat-${(task.category || 'general').toLowerCase()}`
              const categoryAbbr = CATEGORY_ABBR[task.category] || CATEGORY_ABBR.General

              return (
                <li
                  key={task.id}
                  draggable={isDnDActive}
                  onDragStart={(e) => isDnDActive && handleDragStart(e, task)}
                  onDragOver={(e) => isDnDActive && handleDragOver(e, task)}
                  onDragLeave={isDnDActive ? handleDragLeave : undefined}
                  onDrop={(e) => isDnDActive && handleDrop(e, task)}
                  onDragEnd={isDnDActive ? handleDragEnd : undefined}
                  className={`task-item ${task.completed ? 'completed' : ''} ${
                    selectedTaskIds.includes(task.id) ? 'selected' : ''
                  } ${isDragging ? 'dragging' : ''} ${isDragOverTop ? 'drag-over-top' : ''} ${
                    isDragOverBottom ? 'drag-over-bottom' : ''
                  }`}
                >
                  <div className="task-item-left">
                    {isDnDActive && (
                      <span className="drag-handle" title="Drag to reorder" aria-hidden="true">
                        ⋮⋮
                      </span>
                    )}

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
                          maxLength={250}
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
                    {/* Category Tag Badge */}
                    <span
                      className={`category-badge ${categoryClass}`}
                      title={`Workspace: ${task.category || 'General'}`}
                    >
                      {categoryAbbr}
                    </span>

                    {/* Priority Badge */}
                    <span className={`priority-badge priority-${task.priority}`}>
                      {task.priority}
                    </span>

                    <span className="task-timestamp" title={task.created_at ? new Date(task.created_at).toLocaleString() : ''}>
                      {formatTimeAgo(task.created_at || task.createdAt)}
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
              )
            })}
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
                  <span className="activity-item-time">{formatTimeAgo(act.created_at || act.timestamp)}</span>
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
        <span><kbd className="key-badge">⋮⋮ Drag</kbd> Reorder</span>
        <span><kbd className="key-badge">/</kbd> Quick search</span>
        <span><kbd className="key-badge">Esc</kbd> Cancel / Clear</span>
      </div>
    </div>
  )
}
