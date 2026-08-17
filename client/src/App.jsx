import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as api from './api.js'
import { supabase, isSupabaseConfigured } from './supabaseClient.js'
import { validateTaskTitle, sanitizeText } from './utils/sanitize.js'
import { useFocus } from './context/useFocus.js'
import { useHashRoute } from './hooks/useHashRoute.js'
import Auth from './components/Auth.jsx'
import Header from './components/Header.jsx'
import AmbientAura from './components/AmbientAura.jsx'
import FocusSession from './components/focus/FocusSession.jsx'
import MinimizedFocusWidget from './components/focus/MinimizedFocusWidget.jsx'
import CalendarView from './components/calendar/CalendarView.jsx'
import LandingPage from './components/landing/LandingPage.jsx'
import TaskRegistryView from './components/tasks/TaskRegistryView.jsx'
import * as sfx from './utils/sfx.js'
import {
  startRecording,
  stopAndProcessAudio,
  cancelRecording,
  isRecordingSupported,
  processTextCommand
} from './utils/audioRecorder.js'
import { parseCommandWithAI, stringSimilarity } from './utils/aiService.js'
import './App.css'

const CATEGORIES = ['General', 'Engineering', 'Design', 'Personal']

function findBestMatchingTask(taskList, targetQuery) {
  if (!taskList || taskList.length === 0 || !targetQuery) return null

  // Normalize query: lowercase, remove excess spaces
  const rawQuery = String(targetQuery).toLowerCase().trim()
  if (!rawQuery) return null

  // Compact alphanumeric representation without spaces or special symbols (e.g. "lat sol" -> "latsol", "lat-sol" -> "latsol")
  const compactQuery = rawQuery.replace(/[^a-z0-9]/gi, '')

  // 1. Exact match (raw string)
  const exact = taskList.find((t) => (t.title || '').toLowerCase().trim() === rawQuery)
  if (exact) return exact

  // 2. Compact alphanumeric exact match (covers acronyms & split words like LATSOL vs "lat sol")
  if (compactQuery.length >= 2) {
    const compactExact = taskList.find((t) => {
      const comp = (t.title || '').toLowerCase().replace(/[^a-z0-9]/gi, '')
      return comp === compactQuery
    })
    if (compactExact) return compactExact
  }

  // 3. Substring match on raw strings
  const includes = taskList.find((t) => (t.title || '').toLowerCase().includes(rawQuery))
  if (includes) return includes

  // 4. Reverse substring match on raw strings
  const reverseIncludes = taskList.find((t) => {
    const tTitle = (t.title || '').toLowerCase().trim()
    return tTitle && rawQuery.includes(tTitle)
  })
  if (reverseIncludes) return reverseIncludes

  // 5. Compact alphanumeric substring / reverse substring match
  if (compactQuery.length >= 3) {
    const compactSub = taskList.find((t) => {
      const comp = (t.title || '').toLowerCase().replace(/[^a-z0-9]/gi, '')
      return comp.includes(compactQuery) || (comp.length >= 3 && compactQuery.includes(comp))
    })
    if (compactSub) return compactSub
  }

  // 6. Token overlap & Levenshtein similarity matching (>= 60% similarity threshold)
  let bestFuzzyTask = null
  let maxSimilarity = 0
  for (const t of taskList) {
    const titleRaw = (t.title || '').toLowerCase().trim()
    const titleCompact = titleRaw.replace(/[^a-z0-9]/gi, '')

    const simCompact = stringSimilarity(compactQuery, titleCompact)
    const simRaw = stringSimilarity(rawQuery, titleRaw)

    const titleWords = titleRaw.split(/[\s,.-]+/).filter((w) => w.length >= 2)
    const queryWords = rawQuery.split(/[\s,.-]+/).filter((w) => w.length >= 2)
    let tokenSim = 0
    if (queryWords.length > 0 && titleWords.length > 0) {
      let matchedTokens = 0
      for (const qw of queryWords) {
        for (const tw of titleWords) {
          if (stringSimilarity(qw, tw) >= 0.7 || qw.includes(tw) || tw.includes(qw)) {
            matchedTokens++
            break
          }
        }
      }
      tokenSim = matchedTokens / Math.max(queryWords.length, titleWords.length)
    }

    const currentMax = Math.max(simCompact, simRaw, tokenSim)
    if (currentMax > maxSimilarity) {
      maxSimilarity = currentMax
      bestFuzzyTask = t
    }
  }

  if (bestFuzzyTask && maxSimilarity >= 0.6) {
    return bestFuzzyTask
  }

  return null
}

export default function App() {
  // Focus Session global state from FocusContext
  const {
    viewMode,
    customMinutes,
    startSession,
    minimizeSession,
    endSession,
    activeTask,
    setActiveTask,
    setCustomDuration
  } = useFocus()

  // Auth state initialized based on configuration
  const [session, setSession] = useState(null)
  const [authInitialized, setAuthInitialized] = useState(() => !isSupabaseConfigured)
  const [isDemoMode, setIsDemoMode] = useState(() => !isSupabaseConfigured)

  // Data state
  const [tasks, setTasks] = useState([])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [newCategory, setNewCategory] = useState('General')

  // Hash Routing Manager & State Bridge (#home, #main, #focus, #calendar)
  const {
    navigate,
    exitFocusRoute,
    isHome,
    isFocus,
    isCalendar
  } = useHashRoute(session, isDemoMode)

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

  // Filter & Sort state
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'active' | 'completed'
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('custom') // 'custom' | 'newest' | 'oldest' | 'priority' | 'alphabetical'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTaskIds, setSelectedTaskIds] = useState([])

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

  // Cleanup Voice Partner state & hardware mic
  const cleanupVoicePartner = useCallback(() => {
    cancelRecording()
    setIsPartnerRecording(false)
    setIsPartnerProcessing(false)
    setIsPartnerTextPromptOpen(false)
    setInterimVoiceText('')
  }, [])

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

  // Fetch tasks helper for manual user sync/retry
  const loadTasks = useCallback(
    async (showLoadingSpinner = true) => {
      try {
        if (showLoadingSpinner) setIsLoading(true)
        setErrorMessage(null)
        const data = await api.getTasks()
        setTasks(data)
      } catch (err) {
        console.error('Failed to fetch tasks:', err)
        setErrorMessage(err.message || 'Failed to connect to database.')
      } finally {
        if (showLoadingSpinner) setIsLoading(false)
      }
    },
    []
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

      api.getTasks()
        .then((tasksData) => {
          if (isMounted) {
            setTasks(tasksData)
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

  // Launch Focus Session handler (navigates to #focus)
  const handleOpenFocusSession = useCallback(
    (targetTask = null) => {
      const selected = targetTask || tasks.find((t) => !t.completed) || tasks[0] || null
      startSession(selected)
      navigate('focus')
    },
    [tasks, startSession, navigate]
  )

  // Sign out handler (returns to #home)
  const handleSignOut = useCallback(async () => {
    try {
      cleanupVoicePartner()
      if (isSupabaseConfigured) {
        await supabase.auth.signOut()
      }
      setSession(null)
      setIsDemoMode(false)
      navigate('home')
      showToast('Signed out of session')
    } catch (err) {
      console.error('Sign out error:', err)
      showToast('Failed to sign out', 'error')
    }
  }, [showToast, navigate, cleanupVoicePartner])

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
        due_date: validDueDate,
        duration_minutes: duration_minutes || 30,
        order: 0,
        completed: false,
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

        setTasks((prev) =>
          prev.map((t) => (t.id === tempId ? { ...createdTask, due_date: validDueDate, duration_minutes } : t))
        )
        return createdTask
      } catch (err) {
        console.error('Failed to create task:', err)
        setTasks((prev) => prev.filter((t) => t.id !== tempId))
        showToast(`Failed to add task: ${err.message}`, 'error')
        throw err
      }
    },
    [session, showToast]
  )

  // Add Task with AI multi-task decomposition & mandatory deadline inference
  const handleAddTask = useCallback(
    async (e) => {
      e.preventDefault()
      const rawInput = (newTaskTitle || '').trim()
      if (!rawInput || isSubmitting) return

      setIsSubmitting(true)
      setErrorMessage(null)

      try {
        // Send input to AI parser for multi-task decomposition & deadline extraction
        const parsed = await parseCommandWithAI(rawInput, new Date().toISOString())

        if (parsed.action === 'CREATE_TASKS' || (Array.isArray(parsed.tasks) && parsed.tasks.length > 0)) {
          const taskList = parsed.tasks || []
          setNewTaskTitle('')

          for (const t of taskList) {
            await handleCreateTask({
              title: t.title,
              priority: (t.priority || newPriority || 'medium').toLowerCase(),
              category: t.category || newCategory || 'General',
              due_date: t.due_date,
              duration_minutes: t.duration_minutes || 30
            })
          }

          sfx.playSuccess()
          showToast(parsed.reply_summary || `Berhasil menambahkan ${taskList.length} tugas terjadwal ke kalender.`)
        } else if (parsed.action === 'SCHEDULE_EVENT') {
          setNewTaskTitle('')
          const startTime = parsed.start_time || new Date().toISOString()
          const endTime = parsed.end_time || new Date(new Date(startTime).getTime() + 3600000).toISOString()

          await api.createCalendarEvent({
            title: parsed.title || rawInput,
            startTime,
            endTime,
            category: parsed.category || newCategory,
            priority: (parsed.priority || newPriority).toLowerCase(),
            autoMorph: true,
            isCompleted: false,
            userId: session?.user?.id
          })
          sfx.playSuccess()
          showToast(parsed.reply_summary || `Jadwal "${parsed.title}" berhasil diatur.`)
          navigate('calendar')
        } else {
          // Standard single task fallback with validated title
          const validation = validateTaskTitle(rawInput)
          if (!validation.isValid) {
            setErrorMessage(validation.error)
            showToast(validation.error, 'error')
            return
          }
          setNewTaskTitle('')
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
        setErrorMessage(`Gagal menambahkan tugas: ${err.message}`)
        showToast(`Error: ${err.message}`, 'error')
        setNewTaskTitle(rawInput)
      } finally {
        setIsSubmitting(false)
      }
    },
    [newTaskTitle, newPriority, newCategory, isSubmitting, session, handleCreateTask, showToast, navigate]
  )

  // Toggle Task Completion with Spam-Click Protection & Busy Lock
  const handleToggleTask = useCallback(
    async (task) => {
      if (busyTaskIds.has(task.id)) return

      setBusyTaskIds((prev) => new Set(prev).add(task.id))
      const nextCompleted = !task.completed

      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, completed: nextCompleted } : t))
      )

      try {
        await api.updateTask(task.id, { completed: nextCompleted }, session?.user?.id)
        showToast(nextCompleted ? `Marked "${task.title}" complete` : `Marked "${task.title}" active`)
      } catch (err) {
        console.error('Failed to update task:', err)
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t))
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
    [busyTaskIds, session, showToast]
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
      } catch (err) {
        console.error('Failed to rename task:', err)
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, title: previousTitle } : t))
        )
        showToast(`Failed to rename task: ${err.message}`, 'error')
      }
    },
    [editingTaskId, editingTitle, session, showToast]
  )

  // Delete Task (accepts task object or taskId string)
  const handleDeleteTask = useCallback(
    async (taskOrId) => {
      const taskId = typeof taskOrId === 'object' ? taskOrId.id : taskOrId
      const target = tasks.find((t) => t.id === taskId)
      const taskTitle = typeof taskOrId === 'object' ? taskOrId.title : target?.title || ''
      const previousTasks = [...tasks]
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId))

      try {
        await api.deleteTask(taskId, taskTitle, session?.user?.id)
        showToast(`Deleted "${taskTitle || 'task'}"`)
      } catch (err) {
        console.error('Failed to delete task:', err)
        setTasks(previousTasks)
        showToast(`Failed to delete task: ${err.message}`, 'error')
      }
    },
    [tasks, session, showToast]
  )

  // Direct task update helper for calendar rescheduling and edits
  const handleUpdateTaskDirect = useCallback(
    async (taskId, updates) => {
      const prevTasks = [...tasks]
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
      )
      try {
        const updated = await api.updateTask(taskId, updates, session?.user?.id)
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t))
        )
        return updated
      } catch (err) {
        console.error('Failed to update task:', err)
        setTasks(prevTasks)
        showToast(`Failed to update task: ${err.message}`, 'error')
        throw err
      }
    },
    [tasks, session, showToast]
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
    } catch (err) {
      console.error('Failed to clear completed tasks:', err)
      setTasks(previousTasks)
      showToast(`Failed to clear completed: ${err.message}`, 'error')
    }
  }, [tasks, session, showToast])

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
      } catch (err) {
        console.error('Failed to batch update:', err)
        loadTasks(false)
        showToast(`Failed to batch update: ${err.message}`, 'error')
      }
    },
    [selectedTaskIds, session, showToast, loadTasks]
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
      } catch (err) {
        console.error('Failed to save task order:', err)
        showToast('Failed to save order to database', 'error')
      }
    },
    [draggedTaskId, dropPosition, tasks, session, showToast]
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
        return created
      } catch (err) {
        setTasks((prev) => prev.filter((t) => t.id !== tempId))
        showToast(`Failed to add task: ${err.message}`, 'error')
        return null
      }
    },
    [session, showToast]
  )

  // Centralized Partner Action Executor (Shared by Voice & Typed Fallback)
  const executePartnerAction = useCallback(
    async (result = {}, transcript = '') => {
      const action = result.action || 'UNKNOWN'

      if (action === 'CREATE_TASKS' || (Array.isArray(result.tasks) && result.tasks.length > 0)) {
        const taskList = result.tasks || []
        setInterimVoiceText(`⚡ Memproses ${taskList.length} tugas terjadwal...`)

        for (const t of taskList) {
          await handleCreateTask({
            title: t.title,
            priority: (t.priority || 'Medium').toLowerCase(),
            category: t.category || 'General',
            due_date: t.due_date,
            duration_minutes: t.duration_minutes || 30
          })
        }

        sfx.playSuccess()
        setInterimVoiceText(`✓ ${result.reply_summary || `Berhasil menambahkan ${taskList.length} tugas.`}`)
        showToast(`🤝 Partner: ${result.reply_summary || `Berhasil menambahkan ${taskList.length} tugas terjadwal ke kalender.`}`)
      } else if (action === 'CREATE_TASK') {
        setInterimVoiceText(`⚡ Executing: "${result.title}"...`)
        await handleCreateTask({
          title: result.title,
          priority: (result.priority || 'Medium').toLowerCase(),
          category: result.category || 'General',
          due_date: result.start_time || result.due_date,
          duration_minutes: 30
        })
        sfx.playSuccess()
        setInterimVoiceText(`✓ ${result.reply_summary || `Created: "${result.title}"`}`)
        showToast(`🤝 Partner: ${result.reply_summary || `Task "${result.title}" created.`}`)
      } else if (action === 'SCHEDULE_EVENT') {
        setInterimVoiceText(`⚡ Scheduling: "${result.title}"...`)
        const startTime = result.start_time || result.due_date || new Date().toISOString()
        await handleCreateTask({
          title: result.title,
          priority: (result.priority || 'Medium').toLowerCase(),
          category: result.category || 'General',
          due_date: startTime,
          duration_minutes: 60
        })
        sfx.playSuccess()
        navigate('calendar')
        setInterimVoiceText(`✓ ${result.reply_summary || `Scheduled: "${result.title}"`}`)
        showToast(`🤝 Partner: ${result.reply_summary || `Scheduled "${result.title}".`}`)
      } else if (action === 'NAVIGATE') {
        sfx.playSuccess()
        const targetView = result.target_view || 'tasks'
        if (targetView === 'focus') {
          handleOpenFocusSession()
          const reply = result.reply_summary || 'Membuka mode fokus.'
          setInterimVoiceText(`✓ ${reply}`)
          showToast(`🤝 Partner: ${reply}`)
        } else {
          navigate(targetView === 'calendar' ? 'calendar' : 'main')
          setInterimVoiceText(`✓ ${result.reply_summary || 'Switched view'}`)
          showToast(`🤝 Partner: ${result.reply_summary || 'Switched view'}`)
        }
      } else if (action === 'EXIT_FOCUS') {
        endSession()
        sfx.playSuccess()
        setInterimVoiceText(`✓ ${result.reply_summary || 'Menutup sesi fokus'}`)
        showToast(`🤝 Partner: ${result.reply_summary || 'Sesi fokus ditutup.'}`)
      } else if (action === 'MINIMIZE_FOCUS') {
        minimizeSession()
        sfx.playSuccess()
        setInterimVoiceText(`✓ ${result.reply_summary || 'Focus diminimize'}`)
        showToast(`🤝 Partner: ${result.reply_summary || 'Focus diminimize ke floating player.'}`)
      } else if (action === 'CLOSE_MINIMIZED_FOCUS') {
        if (viewMode === 'minimized') {
          endSession()
          sfx.playSuccess()
          const msg = 'Widget fokus berhasil ditutup.'
          setInterimVoiceText(`✓ ${msg}`)
          showToast(`🤝 Partner: ${msg}`)
        } else {
          sfx.playDeactivate()
          const msg = 'Tidak ada widget fokus yang sedang di-minimize.'
          setInterimVoiceText(`✓ ${msg}`)
          showToast(`🤝 Partner: ${msg}`, 'info')
        }
      } else if (action === 'FOCUS_TASK') {
        const queryTitle = result.target_task_title || result.title || ''
        const duration = result.duration_minutes
          ? Math.max(1, Math.min(180, parseInt(result.duration_minutes, 10)))
          : null
        const effectiveMinutes = duration || customMinutes || 25
        if (duration) {
          setCustomDuration(duration, true)
        }

        const pendingTasks = tasks.filter((t) => !t.completed)
        const matched = findBestMatchingTask(pendingTasks, queryTitle) || findBestMatchingTask(tasks, queryTitle)

        if (matched) {
          startSession(matched, matched.title, effectiveMinutes)
          sfx.playSuccess()
          const msg = `Memulai sesi fokus untuk task "${matched.title}" selama ${effectiveMinutes} menit.`
          setInterimVoiceText(`✓ ${msg}`)
          showToast(`🤝 Partner: ${msg}`)
        } else if (queryTitle) {
          startSession(null, queryTitle, effectiveMinutes)
          sfx.playSuccess()
          const msg = `Memulai sesi fokus untuk task "${queryTitle}" selama ${effectiveMinutes} menit.`
          setInterimVoiceText(`✓ ${msg}`)
          showToast(`🤝 Partner: ${msg}`)
        } else {
          handleOpenFocusSession()
          sfx.playSuccess()
          setInterimVoiceText('✓ Membuka mode fokus.')
          showToast('🤝 Partner: Membuka mode fokus.')
        }
      } else if (
        action === 'COMPLETE_ACTIVE_FOCUS_TASK' ||
        action === 'COMPLETE_ACTIVE_TASK'
      ) {
        const targetToComplete = activeTask
        if (targetToComplete) {
          if (!targetToComplete.completed) {
            await handleToggleTask(targetToComplete)
          }
          setActiveTask(null)
          sfx.playSuccess()
          const msg = `Tugas "${targetToComplete.title}" berhasil diselesaikan.`
          setInterimVoiceText(`✓ ${msg}`)
          showToast(`🤝 Partner: ${msg}`)
        } else {
          sfx.playDeactivate()
          const msg = 'Tidak ada tugas yang sedang aktif di mode fokus.'
          setInterimVoiceText(`✓ ${msg}`)
          showToast(`🤝 Partner: ${msg}`, 'info')
        }
      } else if (action === 'CLEAR_COMPLETED') {
        setInterimVoiceText('⚡ Purging completed tasks...')
        await handleClearCompleted()
        sfx.playSuccess()
        setInterimVoiceText(`✓ ${result.reply_summary || 'Cleared completed tasks'}`)
        showToast(`🤝 Partner: ${result.reply_summary || 'Cleared completed tasks.'}`)
      } else {
        // Fast-path regex checks for Focus mode commands
        const lowerTranscript = (transcript || '').toLowerCase().trim()
        if (
          /^(?:buka|lihat|masuk|start|mulai|open|switch to|go to)\s+(?:ke\s+|tab\s+|mode\s+)?(?:mode\s+)?(?:focus|fokus)(?:\s+mode)?$/i.test(
            lowerTranscript
          ) ||
          /buka (tab |mode )?fokus|masuk mode fokus|start focus mode|open focus( mode)?/i.test(lowerTranscript)
        ) {
          handleOpenFocusSession()
          sfx.playSuccess()
          setInterimVoiceText('✓ Membuka mode fokus.')
          showToast('🤝 Partner: Membuka mode fokus.')
          return
        }
        if (
          /tutup (mode )?fokus|keluar (dari )?fokus|selesai fokus|akhiri fokus|exit focus|end focus|close focus/.test(
            lowerTranscript
          )
        ) {
          endSession()
          sfx.playSuccess()
          setInterimVoiceText('✓ Menutup sesi fokus')
          showToast('🤝 Partner: Sesi fokus ditutup.')
          return
        }
        if (
          /tutup minimize|hapus minimize|close minimize|matikan minimize|tutup widget fokus|hapus widget fokus|tutup widget|hapus widget|close widget/i.test(
            lowerTranscript
          )
        ) {
          if (viewMode === 'minimized') {
            endSession()
            sfx.playSuccess()
            const msg = 'Widget fokus berhasil ditutup.'
            setInterimVoiceText(`✓ ${msg}`)
            showToast(`🤝 Partner: ${msg}`)
          } else {
            sfx.playDeactivate()
            const msg = 'Tidak ada widget fokus yang sedang di-minimize.'
            setInterimVoiceText(`✓ ${msg}`)
            showToast(`🤝 Partner: ${msg}`, 'info')
          }
          return
        }
        if (
          /minimize (mode )?fokus|kecilkan (mode )?fokus|\bminimize\b/.test(lowerTranscript)
        ) {
          minimizeSession()
          sfx.playSuccess()
          setInterimVoiceText('✓ Focus diminimize')
          showToast('🤝 Partner: Focus diminimize ke floating mini-player.')
          return
        }
        if (
          /(?:tandai|mark)?\s*(?:task|tugas)\s+(?:saat ini|ini|fokus|current)?\s*(?:selesai|as done|done|beres|sudah beres)/i.test(
            lowerTranscript
          ) ||
          /selesaikan\s+(?:task|tugas)(?:\s+(?:ini|saat ini|fokus))?/i.test(lowerTranscript) ||
          /(?:tugas|task)\s+(?:ini|saat ini|fokus|sudah)\s*(?:selesai|beres|sudah beres)/i.test(lowerTranscript) ||
          /tugas ini selesai|tugas saat ini selesai|selesaikan tugas ini|tugas fokus selesai|task ini beres|tugas sudah beres/i.test(
            lowerTranscript
          )
        ) {
          const targetToComplete = activeTask
          if (targetToComplete) {
            if (!targetToComplete.completed) {
              await handleToggleTask(targetToComplete)
            }
            setActiveTask(null)
            sfx.playSuccess()
            const msg = `Tugas "${targetToComplete.title}" berhasil diselesaikan.`
            setInterimVoiceText(`✓ ${msg}`)
            showToast(`🤝 Partner: ${msg}`)
          } else {
            sfx.playDeactivate()
            const msg = 'Tidak ada tugas yang sedang aktif di mode fokus.'
            setInterimVoiceText(`✓ ${msg}`)
            showToast(`🤝 Partner: ${msg}`, 'info')
          }
          return
        }
        const focusRegex = /(?:fokus(?:kan)?(?:\s+(?:ke|pada))?|kerjakan)\s+(?:task|tugas)?\s*(.+?)(?:\s+(?:selama|for)\s+(\d+)\s*(?:menit|mins?|m)|\s+(\d+)\s*(?:menit|mins?|m))?$/i
        const focusMatch = lowerTranscript.match(focusRegex)
        if (focusMatch && !/tutup|keluar|selesai|akhiri|minimize|kalender|calendar/.test(focusMatch[1])) {
          let rawTarget = focusMatch[1].replace(/^(?:task|tugas)\s+/i, '').trim()
          rawTarget = rawTarget.replace(/\s+(?:selama|for)?\s*\d+\s*(?:menit|mins?|minutes|m\b).*$/i, '').trim()
          const rawMinutes = parseInt(focusMatch[2] || focusMatch[3], 10) || null
          const effectiveMinutes = rawMinutes || customMinutes || 25
          if (rawMinutes) {
            setCustomDuration(rawMinutes, true)
          }
          const pendingTasks = tasks.filter((t) => !t.completed)
          const matched = findBestMatchingTask(pendingTasks, rawTarget) || findBestMatchingTask(tasks, rawTarget)
          if (matched) {
            startSession(matched, matched.title, effectiveMinutes)
          } else {
            startSession(null, rawTarget, effectiveMinutes)
          }
          sfx.playSuccess()
          const msg = `Memulai sesi fokus untuk task "${matched ? matched.title : rawTarget}" selama ${effectiveMinutes} menit.`
          setInterimVoiceText(`✓ ${msg}`)
          showToast(`🤝 Partner: ${msg}`)
          return
        }

        setInterimVoiceText(transcript ? `"${transcript}"` : 'Suara tidak terdeteksi')
        showToast(
          `🤝 Partner: ${
            result.reply_summary ||
            (transcript ? `"${transcript}"` : 'Perintah tidak dikenali.')
          }`,
          'info'
        )
      }
    },
    [
      handleCreateTask,
      handleClearCompleted,
      handleOpenFocusSession,
      handleToggleTask,
      minimizeSession,
      endSession,
      startSession,
      setActiveTask,
      setCustomDuration,
      customMinutes,
      activeTask,
      tasks,
      viewMode,
      showToast,
      navigate
    ]
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
        const { transcript, result } = await processTextCommand(text, new Date().toISOString(), tasks)
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
    [partnerPromptInput, executePartnerAction, showToast, tasks]
  )

  // Partner Voice Agent - Direct MediaRecorder + Groq Whisper + Llama 3 Pipeline
  const handleTogglePartner = useCallback(async () => {
    // Restrict Voice Partner activation strictly to #main, #calendar, and #focus
    const allowedRoutes = ['#main', '#calendar', '#focus']
    const currentHash = window.location.hash || '#home'
    if (!allowedRoutes.includes(currentHash)) {
      return
    }

    if (!isRecordingSupported()) {
      setIsPartnerTextPromptOpen(true)
      return
    }

    if (isPartnerProcessing) return

    if (isPartnerRecording) {
      // Stop recording and process with Groq Whisper & Llama 3
      setIsPartnerRecording(false)
      setIsPartnerProcessing(true)
      setInterimVoiceText('⚡ Mentranskripsi via Groq Whisper...')

      try {
        const { transcript, result } = await stopAndProcessAudio((statusText) => {
          setInterimVoiceText(statusText)
        }, new Date().toISOString(), tasks)
        await executePartnerAction(result, transcript)
      } catch (err) {
        console.warn('Partner voice error:', err.message)
        sfx.playDeactivate()
        setIsPartnerTextPromptOpen(true)
        showToast(`Partner Voice: ${err.message || 'Ketik perintah Anda di bawah'}.`, 'info')
        setInterimVoiceText('Ketik perintah Anda pada kotak Partner...')
      } finally {
        setIsPartnerRecording(false)
        setIsPartnerProcessing(false)
        setTimeout(() => {
          setInterimVoiceText('')
        }, 3500)
      }
    } else {
      // Start recording raw audio via MediaRecorder
      try {
        await startRecording()
        setIsPartnerRecording(true)
        setIsPartnerProcessing(false)
        setInterimVoiceText('🎙️ Merekam suara... Bicara sekarang lalu tekan V untuk selesai.')
        sfx.playActivate()
        showToast('🎙️ Partner sedang merekam suara... Bicara lalu tekan V untuk selesai.')
      } catch (err) {
        console.warn('Partner recording start error:', err.message)
        sfx.playDeactivate()
        setIsPartnerTextPromptOpen(true)
        showToast(err.message || 'Gagal mengakses mikrofon', 'error')
        setIsPartnerRecording(false)
        setIsPartnerProcessing(false)
      }
    }
  }, [
    isPartnerRecording,
    isPartnerProcessing,
    executePartnerAction,
    showToast,
    tasks
  ])

  // Auto Cleanup Hardware Mic when on #home (Landing Page)
  useEffect(() => {
    if (isHome) {
      cancelRecording()
    }
  }, [isHome])

  // Sync viewMode with hash route seamlessly
  useEffect(() => {
    if (isFocus && viewMode !== 'fullscreen') {
      const selected = activeTask || tasks.find((t) => !t.completed) || tasks[0] || null
      startSession(selected)
    } else if (!isFocus && viewMode === 'fullscreen') {
      minimizeSession()
    }
  }, [isFocus, viewMode, activeTask, tasks, startSession, minimizeSession])

  // Global Keyboard shortcuts (/ for search, F for focus, V for Voice Partner, Esc to dismiss)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInputActive =
        document.activeElement === taskInputRef.current ||
        document.activeElement === searchInputRef.current ||
        document.activeElement === editInputRef.current ||
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT' ||
        document.activeElement?.isContentEditable

      if (isInputActive) {
        if (e.key === 'Escape') {
          if (editingTaskId) {
            setEditingTaskId(null)
          } else if (document.activeElement === searchInputRef.current) {
            setSearchQuery('')
            searchInputRef.current?.blur()
          } else {
            document.activeElement?.blur()
          }
        }
        return
      }

      // Voice Partner shortcut (V) works ONLY in #main, #calendar, and #focus
      const allowedRoutes = ['#main', '#calendar', '#focus']
      const currentHash = window.location.hash || '#home'

      if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!allowedRoutes.includes(currentHash)) {
          // Do not activate mic when on #home (Landing Page)
          return
        }
        e.preventDefault()
        handleTogglePartner()
        return
      }

      // Focus Mode shortcuts (F to toggle, Esc to return to previous route)
      if (isFocus || viewMode === 'fullscreen') {
        if (e.key === 'Escape' || e.key === 'f' || e.key === 'F') {
          e.preventDefault()
          exitFocusRoute()
          minimizeSession()
        }
        return
      }

      // Non-focus shortcuts
      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        handleOpenFocusSession()
      } else if (e.key === 'c' || e.key === 'C') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          navigate('calendar')
        }
      } else if (e.key === 't' || e.key === 'T') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault()
          navigate('main')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    editingTaskId,
    isFocus,
    viewMode,
    handleOpenFocusSession,
    handleTogglePartner,
    exitFocusRoute,
    minimizeSession,
    navigate
  ])

  // If waiting for auth check
  if (!authInitialized) {
    return (
      <div className="loading-state" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Verifying security session...
      </div>
    )
  }

  // Render Landing Page if current route is #home
  if (isHome) {
    return (
      <div className="landing-view-container">
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

        <LandingPage
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onEnterApp={() => {
            setIsDemoMode(true)
            navigate('main')
          }}
          session={session}
          displayName={displayName}
        />

        {/* Auth Modal Overlay when opened from Landing Page */}
        {isAuthModalOpen && (
          <div
            className="auth-modal-overlay"
            onClick={() => setIsAuthModalOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(8px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px'
            }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '440px' }}>
              <Auth
                onDemoAccess={() => {
                  setIsDemoMode(true)
                  setIsAuthModalOpen(false)
                  navigate('main')
                }}
                onClose={() => setIsAuthModalOpen(false)}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  // Render Auth screen if in app view but unauthenticated and not in demo mode
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

        <Auth
          onDemoAccess={() => {
            setIsDemoMode(true)
            navigate('main')
          }}
          onClose={() => navigate('home')}
        />
      </div>
    )
  }

  return (
    <div className="app-container">
      {/* Ambient Aura Background Layer for Partner Voice Agent */}
      <AmbientAura
        isActive={isPartnerRecording || isPartnerProcessing}
        isListening={isPartnerRecording}
      />

      {/* Fullscreen Zen Pomodoro Overlay (#focus) */}
      {(viewMode === 'fullscreen' || isFocus) && (
        <FocusSession
          tasks={tasks}
          busyTaskIds={busyTaskIds}
          onToggleTask={handleToggleTask}
          onQuickAddTask={handleQuickAddTask}
          isPartnerActive={isPartnerRecording}
          isPartnerProcessing={isPartnerProcessing}
          onTogglePartner={handleTogglePartner}
        />
      )}

      {/* Floating Picture-in-Picture (PiP) Mini Player */}
      {viewMode === 'minimized' && !isFocus && (
        <MinimizedFocusWidget
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
      {(isPartnerRecording || isPartnerProcessing) && (
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
        mainTab={isCalendar ? 'calendar' : 'tasks'}
        setMainTab={(tab) => navigate(tab === 'calendar' ? 'calendar' : 'main')}
        session={session}
        displayName={displayName}
        handleSignOut={handleSignOut}
        setIsDemoMode={setIsDemoMode}
        handleOpenFocusSession={handleOpenFocusSession}
        theme={theme}
        toggleTheme={toggleTheme}
        loadTasks={loadTasks}
        isPartnerActive={isPartnerRecording}
        isPartnerProcessing={isPartnerProcessing}
        onTogglePartner={handleTogglePartner}
        onNavigateLanding={() => {
          cleanupVoicePartner()
          navigate('home')
        }}
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

      {/* Main Content: Adaptive Timebox Calendar (#calendar) vs Task Registry (#main) */}
      {isCalendar ? (
        <CalendarView
          todos={tasks}
          tasks={tasks}
          onStartFocusSession={(targetTask) => handleOpenFocusSession(targetTask)}
          onToggleTask={handleToggleTask}
          onUpdateTask={handleUpdateTaskDirect}
          onCreateTask={handleCreateTask}
          onDeleteTask={handleDeleteTask}
          user={session?.user}
          showToast={showToast}
        />
      ) : (
        <TaskRegistryView
          metrics={metrics}
          taskInputRef={taskInputRef}
          newTaskTitle={newTaskTitle}
          setNewTaskTitle={setNewTaskTitle}
          newCategory={newCategory}
          setNewCategory={setNewCategory}
          newPriority={newPriority}
          setNewPriority={setNewPriority}
          isSubmitting={isSubmitting}
          handleAddTask={handleAddTask}
          categories={CATEGORIES}
          categoryCounts={categoryCounts}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          searchInputRef={searchInputRef}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          priorityFilter={priorityFilter}
          setPriorityFilter={setPriorityFilter}
          sortBy={sortBy}
          setSortBy={setSortBy}
          selectedTaskIds={selectedTaskIds}
          setSelectedTaskIds={setSelectedTaskIds}
          handleBatchStatus={handleBatchStatus}
          areAllFilteredSelected={areAllFilteredSelected}
          handleSelectAllFiltered={handleSelectAllFiltered}
          handleToggleSelect={handleToggleSelect}
          handleToggleTask={handleToggleTask}
          handleDeleteTask={handleDeleteTask}
          handleOpenFocusSession={handleOpenFocusSession}
          handleStartEdit={handleStartEdit}
          handleSaveEdit={handleSaveEdit}
          editingTaskId={editingTaskId}
          setEditingTaskId={setEditingTaskId}
          editingTitle={editingTitle}
          setEditingTitle={setEditingTitle}
          editInputRef={editInputRef}
          busyTaskIds={busyTaskIds}
          isDnDActive={isDnDActive}
          draggedTaskId={draggedTaskId}
          dragOverTaskId={dragOverTaskId}
          dropPosition={dropPosition}
          handleDragStart={handleDragStart}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
          handleDrop={handleDrop}
          handleDragEnd={handleDragEnd}
          isLoading={isLoading}
          filteredTasks={filteredTasks}
          handleClearCompleted={handleClearCompleted}
        />
      )}

      {/* Shortcuts Legend */}
      <div className="shortcuts-legend">
        <span><kbd className="key-badge">F</kbd> Focus session</span>
        <span><kbd className="key-badge">T</kbd> Tasks (#main)</span>
        <span><kbd className="key-badge">C</kbd> Calendar (#calendar)</span>
        <span><kbd className="key-badge">V</kbd> Voice Partner</span>
        <span><kbd className="key-badge">↵</kbd> Save task / Edit</span>
        <span><kbd className="key-badge">2× Click</kbd> Inline edit</span>
        <span><kbd className="key-badge">⋮⋮ Drag</kbd> Reorder</span>
        <span><kbd className="key-badge">/</kbd> Quick search</span>
        <span><kbd className="key-badge">Esc</kbd> Cancel / Exit Focus</span>
      </div>
    </div>
  )
}
