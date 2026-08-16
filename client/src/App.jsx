import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as api from './api.js'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { validateTaskTitle, sanitizeText } from './utils/sanitize.js'
import { useFocus } from './context/useFocus.js'
import Auth from './components/Auth.jsx'
import Header from './components/Header.jsx'
import AmbientAura from './components/AmbientAura.jsx'
import FocusSession from './components/FocusSession.jsx'
import FocusMiniPlayer from './components/FocusMiniPlayer.jsx'
import ChronosCalendar from './components/ChronosCalendar.jsx'
import * as sfx from './utils/sfx.js'
import {
  startRecording,
  stopRecording,
  startVoiceListening,
  stopVoiceListening,
  isRecordingSupported,
  processTextCommand
} from './utils/audioRecorder.js'
import { parseCommandWithAI } from './utils/aiService.js'
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
  // Focus Session global state from FocusContext
  const { viewMode, startSession } = useFocus()

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

  // Helper untuk selalu mendapatkan context tasks terbaru kapan pun dipanggil
  const getActiveContextTasks = useCallback(() => {
    const taskList = tasks || []
    return taskList.map((t) => ({
      id: t.id || t._id,
      title: t.title || t.text,
      completed: Boolean(t.completed),
      category: t.category || t.workspace || 'General',
      workspace: t.category || t.workspace || 'General',
      priority: t.priority || 'Medium',
      dueDate: t.due_date || t.dueDate || t.scheduled_at || null,
      time: t.due_date || t.scheduled_at || 'tanpa jadwal'
    }))
  }, [tasks])

  // Navigation state (Tasks vs Chronos Calendar)
  const [mainTab, setMainTab] = useState('tasks') // 'tasks' | 'calendar'

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
  const [busyTaskIds, setBusyTaskIds] = useState(new Set())

  // Partner Ambient Voice Agent state
  const [isPartnerRecording, setIsPartnerRecording] = useState(false)
  const [isPartnerProcessing, setIsPartnerProcessing] = useState(false)
  const [interimVoiceText, setInterimVoiceText] = useState('')
  const [isPartnerTextPromptOpen, setIsPartnerTextPromptOpen] = useState(false)
  const [partnerPromptInput, setPartnerPromptInput] = useState('')

  const taskInputRef = useRef(null)
  const searchInputRef = useRef(null)
  const editInputRef = useRef(null)
  const isProcessingVoiceRef = useRef(false)

  // Theme synchronization effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('task-registry-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  // Toast notification helper with max 3 concurrent alerts and deduplication
  const showToast = useCallback((message, type = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`
    setToasts((prev) => {
      const filtered = prev.filter((t) => t.message !== message)
      return [...filtered, { id, message, type }].slice(-3)
    })
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

  // Launch Focus Session handler
  const handleOpenFocusSession = useCallback(
    (targetTask = null) => {
      const selected = targetTask || tasks.find((t) => !t.completed) || tasks[0] || null
      startSession(selected)
    },
    [tasks, startSession]
  )

  // Global Keyboard shortcuts (/ for search, F for focus session, Esc to dismiss)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (viewMode === 'fullscreen') return // Let FocusSession handle its own keyboard events

      const isInputActive =
        document.activeElement === taskInputRef.current ||
        document.activeElement === searchInputRef.current ||
        document.activeElement === editInputRef.current ||
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'

      if (isInputActive) {
        if (e.key === 'Escape') {
          if (editingTaskId) {
            setEditingTaskId(null)
          } else if (document.activeElement === searchInputRef.current) {
            setSearchQuery('')
            searchInputRef.current?.blur()
          }
        }
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        handleOpenFocusSession()
      } else if (e.key === 'c' || e.key === 'C') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          setMainTab('calendar')
        }
      } else if (e.key === 't' || e.key === 'T') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          setMainTab('tasks')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingTaskId, viewMode, handleOpenFocusSession])

  // Sign out handler
  const handleSignOut = useCallback(async () => {
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
  }, [showToast])

  // Direct programmatic task creation helper for components & AI actions
  const handleCreateTask = useCallback(
    async ({
      title,
      priority = 'medium',
      category = 'General',
      due_date = null,
      duration_minutes = 30
    }) => {
      const validation = validateTaskTitle(title)
      if (!validation.isValid) {
        showToast(validation.error, 'error')
        throw new Error(validation.error)
      }

      const sanitizedTitle = validation.sanitized
      const validDueDate = due_date
        ? new Date(due_date).toISOString()
        : new Date(new Date().setHours(23, 59, 0, 0)).toISOString()

      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const optimisticTask = {
        id: tempId,
        title: sanitizedTitle,
        priority: priority.toLowerCase(),
        category,
        workspace: category,
        due_date: validDueDate,
        scheduled_at: validDueDate,
        order: 0,
        completed: false,
        is_optimistic: true,
        created_at: new Date().toISOString()
      }

      setTasks((prev) => [optimisticTask, ...prev])

      try {
        const createdTask = await api.createTask({
          title: sanitizedTitle,
          priority: priority.toLowerCase(),
          category,
          due_date: validDueDate,
          userId: session?.user?.id
        })

        // Synchronously register in Calendar so it displays on the grid immediately
        const startTime = validDueDate
        const endTime = new Date(new Date(startTime).getTime() + (duration_minutes || 30) * 60000).toISOString()
        await api
          .createCalendarEvent({
            title: sanitizedTitle,
            startTime,
            endTime,
            taskId: createdTask.id,
            category,
            priority: priority.toLowerCase(),
            autoMorph: true,
            userId: session?.user?.id
          })
          .catch((calErr) => {
            console.warn('Calendar sync notice for created task:', calErr)
          })

        setTasks((prev) =>
          prev.map((t) => (t.id === tempId ? { ...createdTask, is_optimistic: false } : t))
        )
        loadActivities()
        return createdTask
      } catch (err) {
        console.error('Failed to create task:', err)
        setTasks((prev) => prev.filter((t) => t.id !== tempId))
        showToast(`Failed to add task: ${err.message}`, 'error')
        throw err
      }
    },
    [session, showToast, loadActivities]
  )

  // Add Task with AI multi-task decomposition & mandatory deadline inference
  const handleAddTask = useCallback(
    async (e) => {
      e.preventDefault()
      const rawInput = (newTaskTitle || '').trim()
      if (!rawInput || isSubmitting) return

      setIsSubmitting(true)
      setErrorMessage(null)

      const tempPreviewId = `opt-preview-${Date.now()}`
      const previewTask = {
        id: tempPreviewId,
        title: rawInput,
        priority: newPriority,
        category: newCategory,
        workspace: newCategory,
        order: 0,
        completed: false,
        is_optimistic: true,
        created_at: new Date().toISOString()
      }

      setTasks((prev) => [previewTask, ...prev])
      setNewTaskTitle('')

      try {
        // Send input to AI parser for multi-task decomposition & deadline extraction (with 7s timeout & active task memory)
        const parsed = await parseCommandWithAI(rawInput, new Date().toISOString(), null, getActiveContextTasks())

        // Ambiguity check
        if (parsed.is_ambiguous) {
          showToast('⚠️ Partner kurang yakin dengan waktunya. Silakan sesuaikan manual.', 'info')
        }

        // Remove preview task before actual creation
        setTasks((prev) => prev.filter((t) => t.id !== tempPreviewId))

        if (parsed.action === 'CREATE_TASKS' || (Array.isArray(parsed.tasks) && parsed.tasks.length > 0)) {
          const taskList = parsed.tasks || []

          for (const t of taskList) {
            await handleCreateTask({
              title: t.title,
              priority: (t.priority || newPriority || 'medium').toLowerCase(),
              category: t.workspace || t.category || newCategory || 'General',
              due_date: t.scheduled_at || t.due_date,
              duration_minutes: t.duration_minutes || 30
            })
          }

          sfx.playSuccess()
          showToast(parsed.confirmation_reply || parsed.reply_summary || `Berhasil menambahkan ${taskList.length} tugas terjadwal ke kalender.`)
        } else if (parsed.action === 'SCHEDULE_EVENT') {
          const startTime = parsed.scheduled_at || parsed.start_time || new Date().toISOString()
          const endTime = parsed.end_time || new Date(new Date(startTime).getTime() + 3600000).toISOString()

          await api.createCalendarEvent({
            title: parsed.title || rawInput,
            startTime,
            endTime,
            category: parsed.workspace || parsed.category || newCategory,
            priority: (parsed.priority || newPriority).toLowerCase(),
            autoMorph: true,
            isCompleted: false,
            userId: session?.user?.id
          })
          sfx.playSuccess()
          showToast(parsed.confirmation_reply || parsed.reply_summary || `Jadwal "${parsed.title}" berhasil diatur.`)
          setMainTab('calendar')
        } else {
          // Standard single task fallback with validated title
          const validation = validateTaskTitle(rawInput)
          if (!validation.isValid) {
            setErrorMessage(validation.error)
            showToast(validation.error, 'error')
            return
          }
          const defaultDue = parsed.start_time || new Date(new Date().setHours(23, 59, 0, 0)).toISOString()
          await handleCreateTask({
            title: validation.sanitized,
            priority: newPriority,
            category: newCategory,
            due_date: defaultDue,
            duration_minutes: 30
          })
          sfx.playSuccess()
          showToast(`Tugas "${validation.sanitized}" berhasil ditambahkan.`)
        }
      } catch (err) {
        console.error('Failed to add task:', err)
        setTasks((prev) => prev.filter((t) => t.id !== tempPreviewId))
        if (err.message && err.message.includes('TIMEOUT')) {
          showToast('⏳ Partner timeout. Jaringan lambat, coba ulangi lagi.', 'error')
        } else {
          showToast(`❌ Gagal memproses: ${err.message}`, 'error')
        }
        setNewTaskTitle(rawInput)
      } finally {
        setIsSubmitting(false)
      }
    },
    [newTaskTitle, newPriority, newCategory, isSubmitting, session, handleCreateTask, showToast]
  )

  // Toggle Task Completion with Spam-Click Protection & Busy Lock
  const handleToggleTask = useCallback(
    async (taskOrId) => {
      const task =
        typeof taskOrId === 'object' && taskOrId !== null
          ? taskOrId
          : tasks.find((t) => String(t.id || t._id) === String(taskOrId))

      if (!task || !task.id) return
      if (busyTaskIds.has(task.id)) return

      setBusyTaskIds((prev) => new Set(prev).add(task.id))
      const nextCompleted = !task.completed

      setTasks((prev) =>
        prev.map((t) => (String(t.id || t._id) === String(task.id) ? { ...t, completed: nextCompleted } : t))
      )

      try {
        await api.updateTask(task.id, { completed: nextCompleted }, session?.user?.id)
        showToast(nextCompleted ? `Marked "${task.title}" complete` : `Marked "${task.title}" active`)
        loadActivities()
      } catch (err) {
        console.error('Failed to update task:', err)
        setTasks((prev) =>
          prev.map((t) => (String(t.id || t._id) === String(task.id) ? { ...t, completed: task.completed } : t))
        )
        showToast(`Failed to update task: ${err.message}`, 'error')
      } finally {
        setTimeout(() => {
          setBusyTaskIds((prev) => {
            const next = new Set(prev)
            next.delete(task.id)
            return next
          })
        }, 400)
      }
    },
    [tasks, busyTaskIds, session, showToast, loadActivities]
  )

  // Start Inline Edit
  const handleStartEdit = useCallback((task) => {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
  }, [])

  // Save Inline Edit with sanitization and validation
  const handleSaveEdit = useCallback(
    async (task) => {
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
    },
    [editingTaskId, editingTitle, session, showToast, loadActivities]
  )

  // Delete Task
  const handleDeleteTask = useCallback(
    async (taskOrId) => {
      const task =
        typeof taskOrId === 'object' && taskOrId !== null
          ? taskOrId
          : tasks.find((t) => String(t.id || t._id) === String(taskOrId))

      if (!task || !task.id) return

      const previousTasks = [...tasks]
      setTasks((prev) => prev.filter((t) => String(t.id || t._id) !== String(task.id)))
      setSelectedTaskIds((prev) => prev.filter((id) => String(id) !== String(task.id)))

      try {
        await api.deleteTask(task.id, task.title, session?.user?.id)
        showToast(`Deleted "${task.title}"`)
        loadActivities()
      } catch (err) {
        console.error('Failed to delete task:', err)
        setTasks(previousTasks)
        showToast(`Failed to delete task: ${err.message}`, 'error')
      }
    },
    [tasks, session, showToast, loadActivities]
  )

  // Clear Completed Tasks
  const handleClearCompleted = useCallback(async () => {
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
  }, [tasks, session, showToast, loadActivities])

  // Multi-Selection Toggle
  const handleToggleSelect = useCallback((taskId) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    )
  }, [])

  // Batch Status Update
  const handleBatchStatus = useCallback(
    async (completed) => {
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
    },
    [selectedTaskIds, session, showToast, loadActivities, loadTasks]
  )

  // Drag and Drop Handlers
  const handleDragStart = useCallback((e, task) => {
    setDraggedTaskId(task.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', task.id)
  }, [])

  const handleDragOver = useCallback(
    (e, targetTask) => {
      e.preventDefault()
      if (!draggedTaskId || draggedTaskId === targetTask.id) return

      const rect = e.currentTarget.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const pos = e.clientY < midY ? 'top' : 'bottom'

      setDragOverTaskId(targetTask.id)
      setDropPosition(pos)
      e.dataTransfer.dropEffect = 'move'
    },
    [draggedTaskId]
  )

  const handleDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOverTaskId(null)
    setDropPosition(null)
  }, [])

  const handleDrop = useCallback(
    async (e, targetTask) => {
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
    },
    [draggedTaskId, dropPosition, tasks, session, showToast, loadActivities]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedTaskId(null)
    setDragOverTaskId(null)
    setDropPosition(null)
  }, [])

  // Metrics Calculations
  const metrics = useMemo(() => {
    const total = tasks.length
    const completed = tasks.filter((t) => t.completed).length
    const pending = total - completed
    const highPriorityPending = tasks.filter((t) => !t.completed && t.priority === 'high').length
    return { total, completed, pending, highPriorityPending }
  }, [tasks])

  // User display name with username fallback logic
  const displayName = useMemo(() => {
    if (!session?.user) return 'Guest Operator'
    return (
      session.user.user_metadata?.username ||
      session.user.user_metadata?.full_name ||
      session.user.email?.split('@')[0] ||
      'Operator'
    )
  }, [session])


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

  const handleSelectAllFiltered = useCallback(() => {
    if (areAllFilteredSelected) {
      setSelectedTaskIds([])
    } else {
      setSelectedTaskIds(filteredTasks.map((t) => t.id))
    }
  }, [areAllFilteredSelected, filteredTasks])

  const isDnDActive =
    sortBy === 'custom' &&
    searchQuery.trim() === '' &&
    categoryFilter === 'all' &&
    activeTab === 'all' &&
    priorityFilter === 'all'

  // Quick Task Add Handler for Focus Session
  const handleQuickAddTask = useCallback(
    async ({ title, category = 'General', priority = 'medium' }) => {
      const validation = validateTaskTitle(title)
      if (!validation.isValid) {
        showToast(validation.error, 'error')
        return null
      }

      const cleanTitle = validation.sanitized
      const tempId = `temp-${Date.now()}`
      const optimistic = {
        id: tempId,
        title: cleanTitle,
        priority,
        category,
        order: 0,
        completed: false,
        created_at: new Date().toISOString()
      }

      setTasks((prev) => [optimistic, ...prev])

      try {
        const created = await api.createTask({
          title: cleanTitle,
          priority,
          category,
          userId: session?.user?.id
        })
        setTasks((prev) => prev.map((t) => (t.id === tempId ? created : t)))
        showToast(`Added "${cleanTitle}" to ${category}`)
        loadActivities()
        return created
      } catch (err) {
        setTasks((prev) => prev.filter((t) => t.id !== tempId))
        showToast(`Failed to add task: ${err.message}`, 'error')
        return null
      }
    },
    [session, showToast, loadActivities]
  )

  // Centralized Partner Action Executor (Shared by Voice & Typed Fallback)
  const executePartnerAction = useCallback(
    async (result = {}, transcript = '') => {
      if (!result) return
      const action = (result.action || result.intent || 'UNKNOWN').toUpperCase()
      const targetId = result.target_task_id || result.targetId
      const replyMsg =
        result.reply ||
        result.confirmation_reply ||
        result.reply_summary ||
        ''

      // Defensive Speech Synthesis Playback Helper
      const safeSpeakBack = (text) => {
        if (!text) return
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          try {
            window.speechSynthesis.cancel()
            const utterance = new SpeechSynthesisUtterance(text.replace(/[#*`_~]/g, '').trim())
            utterance.lang = 'id-ID'
            utterance.rate = 1.0
            window.speechSynthesis.speak(utterance)
          } catch {
            // ignore
          }
        }
      }

      // Safety Net Pengecekan Bulk Delete & Duplikat
      const userTextLower = (transcript || '').toLowerCase()
      const isBulkIntent =
        action === 'BULK_DELETE_TASK' ||
        action === 'BULK_DELETE' ||
        userTextLower.includes('semua') ||
        userTextLower.includes('all') ||
        userTextLower.includes('bersihkan') ||
        userTextLower.includes('duplikat')

      if (isBulkIntent || action === 'DELETE_TASK' || action === 'DELETE') {
        let idsToDelete = (result.target_task_ids || []).map(String)

        // Jika hanya 1 ID dikirim atau target_task_id ada, tapi user berniat hapus semua atau ada duplikat kembar
        if (idsToDelete.length === 0) {
          const targetTask = targetId
            ? tasks.find((t) => String(t.id || t._id) === String(targetId))
            : result.title
            ? tasks.find((t) => t.title.toLowerCase().includes(result.title.toLowerCase()))
            : null

          if (targetTask) {
            const sameTitleTasks = tasks.filter(
              (t) =>
                (t.title || '').trim().toLowerCase() ===
                (targetTask.title || '').trim().toLowerCase()
            )

            if (isBulkIntent || sameTitleTasks.length > 1) {
              idsToDelete = sameTitleTasks.map((t) => String(t.id || t._id))
            } else {
              idsToDelete = [String(targetTask.id || targetTask._id)]
            }
          }
        }

        if (idsToDelete.length > 0) {
          // 1. LANGSUNG HAPUS DARI TAMPILAN (UI Instant / 0 Detik Optimistic Update)
          setTasks((prev) =>
            prev.filter((task) => !idsToDelete.includes(String(task.id || task._id)))
          )
          setSelectedTaskIds((prev) =>
            prev.filter((id) => !idsToDelete.includes(String(id)))
          )

          // 2. HAPUS DI DATABASE SECARA PARALEL (Sekaligus)
          const deletePromises = idsToDelete.map(async (id) => {
            const taskObj = tasks.find((t) => String(t.id || t._id) === id)
            return api.deleteTask(id, taskObj?.title || 'task', session?.user?.id).catch((err) =>
              console.error(`Gagal menghapus task ${id}:`, err)
            )
          })

          Promise.all(deletePromises).then(() => {
            loadActivities()
          })

          const reply =
            replyMsg ||
            (idsToDelete.length > 1
              ? `Siap bro, ${idsToDelete.length} tugas berhasil dihapus sekaligus.`
              : 'Siap bro, tugas berhasil dihapus.')

          sfx.playSuccess()
          setInterimVoiceText(`✓ ${reply}`)
          showToast(`🤝 Partner: ${reply}`)
          safeSpeakBack(reply)
        } else {
          const fallbackReply = replyMsg || 'Tidak ada tugas yang cocok untuk dihapus.'
          setInterimVoiceText(`⚠️ ${fallbackReply}`)
          showToast(`🤝 Partner: ${fallbackReply}`, 'info')
          safeSpeakBack(fallbackReply)
        }
        return
      }

      // 2. Aksi SELESAI / TOGGLE (COMPLETE_TASK)
      if (
        action === 'COMPLETE_TASK' ||
        action === 'COMPLETE' ||
        action === 'TOGGLE'
      ) {
        const targetTask = targetId
          ? tasks.find((t) => t.id === targetId)
          : result.title
          ? tasks.find((t) => t.title.toLowerCase().includes(result.title.toLowerCase()))
          : null

        if (targetTask) {
          await handleToggleTask(targetTask)
          const reply = replyMsg || `Siap bro, tugas "${targetTask.title}" sudah ditandai selesai!`
          sfx.playSuccess()
          setInterimVoiceText(`✓ ${reply}`)
          showToast(`🤝 Partner: ${reply}`)
          safeSpeakBack(reply)
        } else {
          const fallbackReply = replyMsg || 'Tugas yang dimaksud tidak ditemukan di daftar aktif.'
          setInterimVoiceText(`⚠️ ${fallbackReply}`)
          showToast(`🤝 Partner: ${fallbackReply}`, 'info')
          safeSpeakBack(fallbackReply)
        }
        return
      }

      // 3. Aksi BUAT BARU (Hanya jika benar-benar CREATE / CREATE_TASKS)
      if (action === 'CREATE_TASKS' || action === 'CREATE_TASK' || action === 'CREATE') {
        if (Array.isArray(result.tasks) && result.tasks.length > 0) {
          const taskList = result.tasks
          setInterimVoiceText(`⚡ Memproses ${taskList.length} tugas terjadwal...`)

          for (const t of taskList) {
            await handleCreateTask({
              title: t.title,
              priority: (t.priority || 'Medium').toLowerCase(),
              category: t.workspace || t.category || 'General',
              due_date: t.scheduled_at || t.due_date,
              duration_minutes: t.duration_minutes || 30
            })
          }

          const reply =
            replyMsg ||
            (taskList.length === 1
              ? `Siap bro, tugas "${taskList[0].title}" udah masuk kalender.`
              : `Siap bro, ${taskList.length} tugas terjadwal udah masuk kalender.`)

          sfx.playSuccess()
          setInterimVoiceText(`✓ ${reply}`)
          showToast(`🤝 Partner: ${reply}`)
          safeSpeakBack(reply)
          return
        } else if (result.title || result.taskData) {
          const taskPayload = result.taskData || {
            title: result.title,
            priority: (result.priority || 'Medium').toLowerCase(),
            category: result.workspace || result.category || 'General',
            due_date: result.scheduled_at || result.start_time || result.due_date,
            duration_minutes: 30
          }
          setInterimVoiceText(`⚡ Executing: "${taskPayload.title}"...`)
          await handleCreateTask(taskPayload)
          const reply = replyMsg || `Siap bro, tugas "${taskPayload.title}" berhasil dibuat.`
          sfx.playSuccess()
          setInterimVoiceText(`✓ ${reply}`)
          showToast(`🤝 Partner: ${reply}`)
          safeSpeakBack(reply)
          return
        }
      }

      // 4. Aksi SCHEDULE_EVENT
      if (action === 'SCHEDULE_EVENT') {
        setInterimVoiceText(`⚡ Scheduling: "${result.title}"...`)
        const startTime = result.scheduled_at || result.start_time || new Date().toISOString()
        const endTime =
          result.end_time ||
          new Date(new Date(startTime).getTime() + 3600000).toISOString()

        await api.createCalendarEvent({
          title: result.title,
          startTime,
          endTime,
          category: result.workspace || result.category || 'General',
          priority: (result.priority || 'Medium').toLowerCase(),
          autoMorph: true,
          isCompleted: false,
          userId: session?.user?.id
        })
        const reply = replyMsg || `Siap bro, jadwal "${result.title}" berhasil diatur.`
        sfx.playSuccess()
        setMainTab('calendar')
        setInterimVoiceText(`✓ ${reply}`)
        showToast(`🤝 Partner: ${reply}`)
        safeSpeakBack(reply)
        return
      }

      // 5. Aksi NAVIGATE
      if (action === 'NAVIGATE') {
        sfx.playSuccess()
        const targetView = result.target_view || 'tasks'
        if (targetView === 'focus') {
          handleOpenFocusSession()
        } else {
          setMainTab(targetView)
        }
        const reply = replyMsg || 'Siap bro, beralih tampilan.'
        setInterimVoiceText(`✓ ${reply}`)
        showToast(`🤝 Partner: ${reply}`)
        safeSpeakBack(reply)
        return
      }

      // 6. Aksi CLEAR_COMPLETED
      if (action === 'CLEAR_COMPLETED') {
        setInterimVoiceText('⚡ Purging completed tasks...')
        await handleClearCompleted()
        const reply = replyMsg || 'Siap bro, tugas selesai telah dibersihkan.'
        sfx.playSuccess()
        setInterimVoiceText(`✓ ${reply}`)
        showToast(`🤝 Partner: ${reply}`)
        safeSpeakBack(reply)
        return
      }

      // Fallback
      const fallbackMsg =
        replyMsg ||
        (transcript ? `Perintah "${transcript}" tidak dikenali.` : 'Suara tidak terdeteksi.')
      setInterimVoiceText(transcript ? `"${transcript}"` : 'Suara tidak terdeteksi')
      showToast(`🤝 Partner: ${fallbackMsg}`, 'info')
      safeSpeakBack(fallbackMsg)
    },
    [session, tasks, handleCreateTask, handleToggleTask, handleDeleteTask, handleClearCompleted, handleOpenFocusSession, showToast]
  )

  // Partner Typed Command Submission (Fallback when voice is unavailable)
  const handlePartnerTextSubmit = useCallback(
    async (e) => {
      e?.preventDefault()
      if (!partnerPromptInput.trim()) return
      const text = partnerPromptInput.trim()
      setIsPartnerTextPromptOpen(false)
      setPartnerPromptInput('')
      setIsPartnerProcessing(true)
      setInterimVoiceText(`⚡ Memproses: "${text}"...`)
      sfx.playActivate()

      try {
        const { transcript, result } = await processTextCommand(text, new Date().toISOString(), getActiveContextTasks())
        await executePartnerAction(result, transcript)
      } catch (err) {
        console.error('Partner text command error:', err)
        sfx.playDeactivate()
        showToast(err.message || 'Perintah tidak dapat diproses', 'error')
        setInterimVoiceText(`Error: ${err.message}`)
      } finally {
        setIsPartnerProcessing(false)
        setTimeout(() => {
          setInterimVoiceText('')
        }, 3500)
      }
    },
    [partnerPromptInput, getActiveContextTasks, executePartnerAction, showToast]
  )

  // Partner Voice Agent - Click Start / Click Stop Native Recording with Groq Whisper & Llama
  const handleTogglePartner = useCallback(async () => {
    if (!isRecordingSupported()) {
      setIsPartnerTextPromptOpen(true)
      return
    }

    if (isProcessingVoiceRef.current || isPartnerProcessing) return

    if (!isPartnerRecording) {
      setIsPartnerRecording(true)
      setIsPartnerProcessing(false)
      sfx.playActivate()
      showToast('🎙️ Merekam suara... Klik tombol mic lagi jika sudah selesai.')

      await startRecording({
        onStatusChange: (status) => setInterimVoiceText(status),
        onError: (err) => {
          setIsPartnerRecording(false)
          setIsPartnerProcessing(false)
          isProcessingVoiceRef.current = false
          sfx.playDeactivate()
          setIsPartnerTextPromptOpen(true)
          showToast(err.message || 'Gagal merekam suara.', 'warning')
          setInterimVoiceText('Ketik perintah Anda pada kotak Partner...')
        }
      })
    } else {
      isProcessingVoiceRef.current = true
      setIsPartnerRecording(false)
      setIsPartnerProcessing(true)
      setInterimVoiceText('⏳ Memproses audio via Groq...')
      sfx.playDeactivate()

      try {
        const transcribedText = await stopRecording({
          onStatusChange: (status) => setInterimVoiceText(status),
          onError: (err) => {
            showToast(err.message || 'Gagal mentranskripsi.', 'warning')
          }
        })

        if (transcribedText && transcribedText.trim()) {
          console.log('🎙️ Transcribed Audio:', transcribedText)
          showToast(`🎙️ Mendengar: "${transcribedText}"`, 'info')
          setInterimVoiceText(`🧠 Memproses: "${transcribedText}"...`)
          try {
            const result = await parseCommandWithAI(
              transcribedText,
              new Date().toISOString(),
              null,
              getActiveContextTasks()
            )
            await executePartnerAction(result, transcribedText)
          } catch (err) {
            console.warn('Partner parse error:', err.message)
            sfx.playDeactivate()
            if (err.message && err.message.includes('TIMEOUT')) {
              showToast('⏳ Partner timeout. Jaringan lambat, coba ulangi lagi.', 'error')
            } else {
              showToast(`❌ ${err.message || 'Gagal memproses suara'}`, 'error')
            }
            setInterimVoiceText(`Error: ${err.message}`)
          }
        } else {
          setInterimVoiceText('Suara tidak terdeteksi. Silakan coba lagi.')
          showToast('Suara tidak terdengar jelas, silakan coba lagi.', 'info')
        }
      } catch (voiceErr) {
        console.error('Voice processing error:', voiceErr)
      } finally {
        setIsPartnerProcessing(false)
        setTimeout(() => {
          isProcessingVoiceRef.current = false
          setInterimVoiceText('')
        }, 1000)
      }
    }
  }, [
    isPartnerRecording,
    isPartnerProcessing,
    tasks,
    getActiveContextTasks,
    executePartnerAction,
    showToast
  ])

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
      {/* Ambient Aura Background Layer for Partner Voice Agent */}
      <AmbientAura
        isActive={(isPartnerRecording || isPartnerProcessing) && viewMode !== 'fullscreen'}
        isListening={isPartnerRecording}
      />

      {/* Fullscreen Zen Pomodoro Overlay */}
      {viewMode === 'fullscreen' && (
        <FocusSession
          tasks={tasks}
          busyTaskIds={busyTaskIds}
          onToggleTask={handleToggleTask}
          onQuickAddTask={handleQuickAddTask}
        />
      )}

      {/* Floating Picture-in-Picture (PiP) Mini Player */}
      {viewMode === 'minimized' && (
        <FocusMiniPlayer
          tasks={tasks}
          busyTaskIds={busyTaskIds}
          onToggleTask={handleToggleTask}
          onQuickAddTask={handleQuickAddTask}
        />
      )}

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

      {/* Partner Voice Live Audio Note Floating Capsule */}
      {(isPartnerRecording || isPartnerProcessing) && viewMode !== 'fullscreen' && (
        <div className="partner-transcript-capsule" role="status" aria-live="polite">
          <div className="partner-capsule-mic">
            <div className="partner-sound-wave" aria-hidden="true">
              <span className="partner-sound-bar" />
              <span className="partner-sound-bar" />
              <span className="partner-sound-bar" />
            </div>
            <span style={{ fontSize: '13px' }}>
              {isPartnerProcessing ? '⚡' : '🎙️'}
            </span>
          </div>
          <span
            className={`partner-capsule-text ${!interimVoiceText ? 'listening-placeholder' : ''}`}
          >
            {interimVoiceText ||
              (isPartnerRecording
                ? 'Mendengarkan suara Anda... (Bicara tugas / jadwal Anda)'
                : 'Memproses perintah...')}
          </span>
          <button
            type="button"
            className="partner-capsule-close"
            onClick={handleTogglePartner}
            title="Tutup Partner (V)"
            aria-label="Tutup Partner"
          >
            ✕
          </button>
        </div>
      )}

      {/* Partner Voice Fallback Typed Command Modal */}
      {isPartnerTextPromptOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setIsPartnerTextPromptOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Partner Command Box"
        >
          <div
            className="modal-content partner-fallback-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '480px', padding: '20px', borderRadius: '12px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
                🎙️ Partner Assistant
              </h3>
              <button
                type="button"
                className="toast-close-btn"
                onClick={() => setIsPartnerTextPromptOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Partner Voice sedang sibuk. Ketik perintah Anda di sini:
            </p>
            <form onSubmit={handlePartnerTextSubmit}>
              <input
                type="text"
                autoFocus
                className="task-input-primary"
                value={partnerPromptInput}
                onChange={(e) => setPartnerPromptInput(e.target.value)}
                placeholder="Contoh: Tambah tugas Audit Database besok jam 10..."
                style={{ width: '100%', marginBottom: '12px', padding: '10px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsPartnerTextPromptOpen(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!partnerPromptInput.trim()}
                >
                  Kirim Perintah
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Application Header with Navigation & Partner Voice */}
      <Header
        metrics={metrics}
        mainTab={mainTab}
        setMainTab={setMainTab}
        session={session}
        displayName={displayName}
        handleSignOut={handleSignOut}
        setIsDemoMode={setIsDemoMode}
        handleOpenFocusSession={handleOpenFocusSession}
        theme={theme}
        toggleTheme={toggleTheme}
        isActivityOpen={isActivityOpen}
        setIsActivityOpen={setIsActivityOpen}
        activities={activities}
        loadTasks={loadTasks}
        isPartnerActive={isPartnerRecording}
        isPartnerProcessing={isPartnerProcessing}
        onTogglePartner={handleTogglePartner}
      />

      {/* Error / Notice Banner */}
      {errorMessage && (
        <div className="notice-banner" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => loadTasks(true)}>
            Retry
          </button>
        </div>
      )}

      {/* Main Content: Chronos Calendar vs Task Registry */}
      {mainTab === 'calendar' ? (
        <ChronosCalendar
          tasks={tasks}
          onStartFocusSession={(targetTask) => handleOpenFocusSession(targetTask)}
          onToggleTask={handleToggleTask}
          onCreateTask={handleCreateTask}
          user={session?.user}
          showToast={showToast}
        />
      ) : (
        <>
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
            {/* Tombol AI / Mic di bar input task */}
            <button
              type="button"
              onClick={handleTogglePartner}
              title={isPartnerRecording ? 'Klik untuk selesai merekam' : 'Voice / AI Action'}
              className={`btn-ai-voice ${isPartnerRecording ? 'is-recording' : ''}`}
            >
              {isPartnerRecording ? '🔴 Stop' : '✨ AI'}
            </button>
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
                  } ${task.is_optimistic ? 'is-optimistic' : ''}`}
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
                      disabled={busyTaskIds.has(task.id) || task.is_optimistic}
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
                          {task.is_optimistic && (
                            <span className="optimistic-processing-tag">
                              <span className="pulsing-dot"></span>
                              Memproses...
                            </span>
                          )}
                          {!task.is_optimistic && (
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
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="task-item-right">
                    {/* Launch Focus Session on this Task Button */}
                    <button
                      type="button"
                      className="btn-edit-title"
                      onClick={() => handleOpenFocusSession(task)}
                      title={`Focus on "${task.title}"`}
                      aria-label={`Focus on "${task.title}"`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </button>

                    {/* Due Date Deadline Badge */}
                    {task.due_date && (
                      <span
                        className="task-deadline-badge"
                        title={`Deadline: ${new Date(task.due_date).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}`}
                      >
                        📅 {new Date(task.due_date).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' })}{' '}
                        {new Date(task.due_date).getHours() !== 23 || new Date(task.due_date).getMinutes() !== 59
                          ? new Date(task.due_date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                          : ''}
                      </span>
                    )}

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
      </>
      )}

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
        <span><kbd className="key-badge">F</kbd> Focus session</span>
        <span><kbd className="key-badge">↵</kbd> Save task / Edit</span>
        <span><kbd className="key-badge">2× Click</kbd> Inline edit</span>
        <span><kbd className="key-badge">⋮⋮ Drag</kbd> Reorder</span>
        <span><kbd className="key-badge">/</kbd> Quick search</span>
        <span><kbd className="key-badge">Esc</kbd> Cancel / Clear</span>
      </div>
    </div>
  )
}
