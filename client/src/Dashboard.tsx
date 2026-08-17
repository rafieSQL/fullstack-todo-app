import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  ArrowUp,
  Mic,
  Play,
  Pause,
  RotateCcw,
  Check,
  Calendar,
  Clock,
  Home,
  Settings2,
  Flame,
  Layers,
  Search,
  Plus,
  Trash2,
  ArrowUpRight,
  SlidersHorizontal,
  Volume2
} from 'lucide-react'

// ============================================================================
// Types & Interfaces
// ============================================================================

export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskCategory = 'Design' | 'Development' | 'Architecture' | 'Personal' | 'Research'

export interface TaskItem {
  id: string
  title: string
  completed: boolean
  priority: TaskPriority
  category: TaskCategory
  imageUrl?: string
  dueDate?: string
  durationMinutes?: number
}

export interface CalendarEvent {
  id: string
  title: string
  time: string
  duration: string
  category: string
  isNext?: boolean
}

export interface DashboardProps {
  userName?: string
  initialTasks?: TaskItem[]
  onToggleTask?: (id: string) => void
  onAddTask?: (task: Partial<TaskItem>) => void
  onDeleteTask?: (id: string) => void
  onStartFocus?: (durationMinutes: number) => void
  onTriggerVoice?: () => void
  isVoiceListening?: boolean
  currentActiveTab?: 'home' | 'focus' | 'calendar' | 'settings'
  onTabChange?: (tab: 'home' | 'focus' | 'calendar' | 'settings') => void
}

// ============================================================================
// Curated Mock Data with Luxury visionOS Aesthetic Imagery
// ============================================================================

const DEFAULT_TASKS: TaskItem[] = [
  {
    id: 't-1',
    title: 'Refine visionOS Spatial Shaders & Glass Materials',
    completed: false,
    priority: 'high',
    category: 'Design',
    imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
    durationMinutes: 45
  },
  {
    id: 't-2',
    title: 'Architect Real-Time Supabase WebSocket Bridge',
    completed: false,
    priority: 'high',
    category: 'Development',
    imageUrl: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=600&q=80',
    durationMinutes: 60
  },
  {
    id: 't-3',
    title: 'Groq Whisper & Llama 3 Voice Partner Pipeline',
    completed: true,
    priority: 'medium',
    category: 'Architecture',
    imageUrl: 'https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?auto=format&fit=crop&w=600&q=80',
    durationMinutes: 30
  },
  {
    id: 't-4',
    title: 'Bento Grid Micro-Interactions & Fluid Animations',
    completed: false,
    priority: 'medium',
    category: 'Design',
    imageUrl: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=600&q=80',
    durationMinutes: 25
  },
  {
    id: 't-5',
    title: 'Review Weekly Cognitive Velocity & Deep Work Log',
    completed: false,
    priority: 'low',
    category: 'Personal',
    imageUrl: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=600&q=80',
    durationMinutes: 20
  }
]

const TODAY_SCHEDULE: CalendarEvent[] = [
  {
    id: 'ev-1',
    title: 'Spatial UI Review & Shader Sync',
    time: '10:00 AM',
    duration: '45m',
    category: 'Design',
    isNext: true
  },
  {
    id: 'ev-2',
    title: 'Core Engine Speed Optimization',
    time: '01:30 PM',
    duration: '60m',
    category: 'Development'
  },
  {
    id: 'ev-3',
    title: 'Chronos Timeboxing & Agenda Wrap',
    time: '04:15 PM',
    duration: '30m',
    category: 'Architecture'
  }
]

const AESTHETIC_THUMBNAILS = [
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?auto=format&fit=crop&w=600&q=80',
  'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=600&q=80'
]

// ============================================================================
// Main Dashboard Component
// ============================================================================

export const Dashboard: React.FC<DashboardProps> = ({
  userName = 'Operator Hormozi',
  initialTasks = DEFAULT_TASKS,
  onToggleTask,
  onAddTask,
  onDeleteTask,
  onStartFocus,
  onTriggerVoice,
  isVoiceListening = false,
  currentActiveTab = 'home',
  onTabChange
}) => {
  // Task Registry State
  const [tasks, setTasks] = useState<TaskItem[]>(initialTasks)
  const [inputQuery, setInputQuery] = useState<string>('')
  const [activeCategory, setActiveCategory] = useState<string>('ALL')
  const [activeTab, setActiveTab] = useState<'home' | 'focus' | 'calendar' | 'settings'>(currentActiveTab)

  // Focus Timer State (Default 45:00 as requested)
  const [focusDuration, setFocusDuration] = useState<number>(45)
  const [timeLeft, setTimeLeft] = useState<number>(45 * 60)
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false)

  // Local Voice State
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(isVoiceListening)
  const [voiceTranscript, setVoiceTranscript] = useState<string>('')

  // Sync external props
  useEffect(() => {
    if (initialTasks && initialTasks.length > 0) {
      setTasks(initialTasks)
    }
  }, [initialTasks])

  useEffect(() => {
    setIsVoiceActive(isVoiceListening)
  }, [isVoiceListening])

  // Focus countdown timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    if (isTimerRunning && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1)
      }, 1000)
    } else if (timeLeft === 0) {
      setIsTimerRunning(false)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isTimerRunning, timeLeft])

  // Timer format (mm:ss)
  const formattedTime = useMemo(() => {
    const minutes = Math.floor(timeLeft / 60)
    const seconds = timeLeft % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }, [timeLeft])

  // Reset timer helper
  const handleResetTimer = (minutes: number = focusDuration) => {
    setIsTimerRunning(false)
    setFocusDuration(minutes)
    setTimeLeft(minutes * 60)
  }

  // Toggle task completion
  const handleToggle = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    )
    if (onToggleTask) onToggleTask(id)
  }

  // Delete task
  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTasks((prev) => prev.filter((t) => t.id !== id))
    if (onDeleteTask) onDeleteTask(id)
  }

  // Handle AI / Manual task submission from top input
  const handleSubmitTask = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputQuery.trim()) return

    const randomThumb = AESTHETIC_THUMBNAILS[Math.floor(Math.random() * AESTHETIC_THUMBNAILS.length)]
    const newTask: TaskItem = {
      id: `task-${Date.now()}`,
      title: inputQuery.trim(),
      completed: false,
      priority: inputQuery.toLowerCase().includes('urgent') || inputQuery.toLowerCase().includes('penting') ? 'high' : 'medium',
      category: inputQuery.toLowerCase().includes('design') ? 'Design' : inputQuery.toLowerCase().includes('code') || inputQuery.toLowerCase().includes('dev') ? 'Development' : 'Architecture',
      imageUrl: randomThumb,
      durationMinutes: 30
    }

    setTasks((prev) => [newTask, ...prev])
    setInputQuery('')
    if (onAddTask) onAddTask(newTask)
  }

  // Global Voice trigger toggle
  const handleVoiceToggle = () => {
    if (onTriggerVoice) {
      onTriggerVoice()
    } else {
      setIsVoiceActive((prev) => !prev)
      if (!isVoiceActive) {
        setVoiceTranscript('Listening to crystal clear voice command...')
        setTimeout(() => {
          setVoiceTranscript('✓ AI scheduled: "Review visionOS Spatial Shaders at 2:00 PM"')
          setTimeout(() => setVoiceTranscript(''), 3500)
        }, 2200)
      }
    }
  }

  // Filter tasks based on category
  const filteredTasks = useMemo(() => {
    if (activeCategory === 'ALL') return tasks
    return tasks.filter((t) => t.category.toUpperCase() === activeCategory.toUpperCase())
  }, [tasks, activeCategory])

  const pendingCount = tasks.filter((t) => !t.completed).length
  const completedCount = tasks.filter((t) => t.completed).length

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-[#1a1c29] to-slate-900 text-white/90 relative overflow-hidden font-sans selection:bg-white/20 selection:text-white pb-32">
      
      {/* ========================================================================= */}
      {/* Background Ambient Aurora Glow Orbs (Provides depth for Glassmorphism)   */}
      {/* ========================================================================= */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <motion.div
          animate={{
            x: [0, 40, -30, 0],
            y: [0, -50, 30, 0],
            scale: [1, 1.15, 0.9, 1]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-indigo-600/15 blur-[160px]"
        />
        <motion.div
          animate={{
            x: [0, -50, 40, 0],
            y: [0, 40, -40, 0],
            scale: [1, 0.9, 1.2, 1]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-1/3 -right-48 h-[700px] w-[700px] rounded-full bg-teal-500/10 blur-[180px]"
        />
        <motion.div
          animate={{
            x: [0, 30, -40, 0],
            y: [0, 30, -30, 0],
            scale: [1, 1.1, 0.95, 1]
          }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -bottom-40 left-1/3 h-[650px] w-[650px] rounded-full bg-violet-600/15 blur-[170px]"
        />
      </div>

      {/* Main Glass Workspace Container */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-8 md:pt-12">
        
        {/* ======================================================================= */}
        {/* COMPONENT 1: AI Task Input (Top Section - Sleek Wide Pill)              */}
        {/* ======================================================================= */}
        <motion.section
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="w-full max-w-3xl mx-auto mb-10 md:mb-12"
          aria-label="AI Task Input"
        >
          {/* Header Title & Date Meta */}
          <div className="flex items-center justify-between px-2 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-indigo-300/80">
                Spatial Workspace
              </span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span className="text-xs text-white/50">
                {pendingCount} Pending • {completedCount} Done
              </span>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-white/70 backdrop-blur-md">
              <Sparkles className="w-3 h-3 text-indigo-300" />
              <span>Voice & Natural AI Ready</span>
            </div>
          </div>

          {/* Glassmorphic Pill Input Bar */}
          <form
            onSubmit={handleSubmitTask}
            className="group relative flex items-center w-full bg-white/5 dark:bg-white/5 backdrop-blur-2xl border border-white/10 hover:border-white/25 focus-within:border-white/40 focus-within:bg-white/10 rounded-full shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] transition-all duration-300 p-1.5 sm:p-2"
          >
            {/* Sparkles Icon Prefix */}
            <div className="flex items-center justify-center pl-4 pr-2 text-indigo-300/80 group-focus-within:text-indigo-200 transition-colors">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>

            {/* Input Field */}
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Ask AI to add a task, or type manually..."
              className="flex-1 bg-transparent text-sm md:text-base text-white/90 placeholder-white/40 font-normal focus:outline-none px-2 py-2"
            />

            {/* Glowing Send/Enter Button */}
            <motion.button
              type="submit"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              disabled={!inputQuery.trim()}
              className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 ${
                inputQuery.trim()
                  ? 'bg-gradient-to-tr from-indigo-500 to-teal-400 text-white shadow-[0_0_24px_rgba(99,102,241,0.6)] cursor-pointer'
                  : 'bg-white/10 border border-white/10 text-white/40 cursor-not-allowed'
              }`}
              aria-label="Submit Task"
            >
              <ArrowUp className="w-5 h-5 stroke-[2.5]" />
            </motion.button>
          </form>

          {/* Quick AI Filter / Category Selector Chips */}
          <div className="flex items-center justify-center gap-2 mt-4 overflow-x-auto px-2 py-1">
            {['ALL', 'Design', 'Development', 'Architecture', 'Personal'].map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`px-3.5 py-1 rounded-full text-xs font-medium transition-all duration-200 backdrop-blur-md ${
                  activeCategory === category
                    ? 'bg-white/20 border border-white/30 text-white shadow-inner font-semibold'
                    : 'bg-white/5 hover:bg-white/10 border border-white/5 text-white/50 hover:text-white/80'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </motion.section>

        {/* ======================================================================= */}
        {/* BENTO GRID: Main Content Area (Tasks + Large Featured Control Widget)   */}
        {/* ======================================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

          {/* ===================================================================== */}
          {/* COMPONENT 3: Focus Mode / Calendar Widget (Featured Large Widget)     */}
          {/* ===================================================================== */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="md:col-span-2 lg:col-span-2 bg-white/5 dark:bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[24px] md:rounded-[32px] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-6 md:p-8 flex flex-col justify-between relative overflow-hidden group hover:border-white/20 transition-all duration-300"
          >
            {/* Subtle Glass Card Glow */}
            <div className="absolute -top-24 -right-24 w-60 h-60 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

            <div>
              {/* Top Control Panel Header */}
              <div className="flex items-center justify-between pb-6 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shadow-inner">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold tracking-wide text-white/90 uppercase">
                      Deep Work Focus Control
                    </h2>
                    <span className="text-xs text-white/50 font-mono">Binaural Alpha Wave Active</span>
                  </div>
                </div>

                {/* Preset Duration Switchers */}
                <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-2xl p-1 backdrop-blur-md">
                  {[25, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => handleResetTimer(mins)}
                      className={`px-3 py-1 rounded-xl text-xs font-mono transition-all duration-200 ${
                        focusDuration === mins
                          ? 'bg-white/20 border border-white/30 text-white font-bold shadow-sm'
                          : 'text-white/40 hover:text-white/80'
                      }`}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Massive, Thin Typography Focus Timer Display (Like 19°C in Smart Home) */}
              <div className="my-8 text-center relative">
                <motion.div
                  key={timeLeft}
                  initial={{ opacity: 0.9 }}
                  animate={{ opacity: 1 }}
                  className="font-mono text-6xl sm:text-7xl md:text-8xl font-extralight tracking-tighter text-white drop-shadow-[0_4px_32px_rgba(0,0,0,0.5)]"
                >
                  {formattedTime}
                </motion.div>
                
                <p className="mt-2 text-xs font-medium text-indigo-200/70 tracking-widest uppercase">
                  {isTimerRunning ? 'Session in Progress' : 'Ready for Immersion'}
                </p>
              </div>

              {/* Sleek Timer Action Buttons */}
              <div className="flex items-center justify-center gap-4 mb-8">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setIsTimerRunning((prev) => !prev)}
                  className={`px-8 py-3.5 rounded-full flex items-center gap-2.5 text-sm font-semibold border transition-all duration-300 backdrop-blur-xl shadow-lg ${
                    isTimerRunning
                      ? 'bg-amber-500/20 border-amber-400/40 text-amber-200 shadow-[0_0_30px_rgba(245,158,11,0.25)] hover:bg-amber-500/30'
                      : 'bg-white/20 border-white/40 text-white shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:bg-white/30'
                  }`}
                >
                  {isTimerRunning ? (
                    <>
                      <Pause className="w-4 h-4 fill-current" />
                      <span>Pause Session</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>Start Focus</span>
                    </>
                  )}
                </motion.button>

                <button
                  type="button"
                  onClick={() => handleResetTimer(focusDuration)}
                  className="w-12 h-12 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all backdrop-blur-md"
                  title="Reset Timer"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Mini Timeline for Today's Calendar Schedule */}
            <div className="pt-6 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white/80 uppercase tracking-wider">
                  <Calendar className="w-3.5 h-3.5 text-indigo-300" />
                  <span>Today's Timeboxed Schedule</span>
                </div>
                <span className="text-[11px] font-mono text-emerald-400">Chronos Sync ✓</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TODAY_SCHEDULE.map((event) => (
                  <div
                    key={event.id}
                    className={`p-3 rounded-2xl border backdrop-blur-md transition-all duration-200 flex flex-col justify-between ${
                      event.isNext
                        ? 'bg-indigo-500/15 border-indigo-400/30 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                        : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                      <span className="text-white/90 font-bold">{event.time}</span>
                      {event.isNext && (
                        <span className="px-1.5 py-0.2 rounded bg-indigo-400 text-slate-950 text-[9px] font-bold uppercase">
                          Next
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-medium text-white/90 truncate">{event.title}</div>
                    <div className="text-[10px] text-white/40 mt-1">{event.category} • {event.duration}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* ===================================================================== */}
          {/* COMPONENT 2: Task List Bento Grid Items                              */}
          {/* ===================================================================== */}
          <AnimatePresence>
            {filteredTasks.map((task, index) => (
              <motion.article
                key={task.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, delay: index * 0.05 }}
                className={`bg-white/5 dark:bg-white/5 backdrop-blur-2xl border border-white/10 hover:border-white/20 rounded-[24px] md:rounded-[32px] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-5 md:p-6 flex flex-col justify-between group transition-all duration-300 relative overflow-hidden ${
                  task.completed ? 'opacity-50' : 'hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.05)]'
                }`}
              >
                <div>
                  {/* Top Area: Aesthetic Image Thumbnail Placeholder */}
                  {task.imageUrl && (
                    <div className="relative w-full h-36 rounded-2xl overflow-hidden mb-4 border border-white/10 bg-white/5 group-hover:border-white/20 transition-all">
                      <img
                        src={task.imageUrl}
                        alt={task.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 filter brightness-90 contrast-105"
                        loading="lazy"
                      />
                      {/* Subtle Dark Gradient Overlay for Glass Text Pop */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                      
                      {/* Floating Category Pill on Image */}
                      <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/20 text-[10px] font-medium tracking-wide text-white/90 uppercase">
                        {task.category}
                      </span>
                    </div>
                  )}

                  {/* Middle Area: Task Title & Meta */}
                  <div className="mb-4">
                    <h3
                      onClick={() => handleToggle(task.id)}
                      className={`text-sm md:text-base font-semibold leading-snug cursor-pointer transition-colors ${
                        task.completed
                          ? 'line-through text-white/40'
                          : 'text-white/90 group-hover:text-white'
                      }`}
                    >
                      {task.title}
                    </h3>
                  </div>
                </div>

                {/* Bottom Area: Priority Indicator & Custom Circular Checkbox */}
                <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                  {/* Priority Indicator Tag */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-md border ${
                        task.priority === 'high'
                          ? 'bg-rose-500/20 border-rose-400/30 text-rose-300'
                          : task.priority === 'medium'
                          ? 'bg-amber-500/20 border-amber-400/30 text-amber-300'
                          : 'bg-slate-500/20 border-slate-400/30 text-slate-300'
                      }`}
                    >
                      {task.priority.toUpperCase()}
                    </span>

                    {task.durationMinutes && (
                      <span className="text-[11px] text-white/40 font-mono">
                        {task.durationMinutes}m
                      </span>
                    )}
                  </div>

                  {/* Right Actions: Delete & Custom visionOS Circular Checkbox */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => handleDelete(task.id, e)}
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-full bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 flex items-center justify-center transition-all"
                      title="Delete task"
                      aria-label={`Delete task ${task.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Custom Circular Checkbox */}
                    <button
                      type="button"
                      onClick={() => handleToggle(task.id)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all duration-300 ${
                        task.completed
                          ? 'bg-emerald-500/80 border-emerald-400 text-slate-950 shadow-[0_0_15px_rgba(52,211,153,0.5)]'
                          : 'bg-white/5 hover:bg-white/20 border-white/25 text-transparent hover:border-white/50'
                      }`}
                      aria-label={`Toggle task completion for ${task.title}`}
                    >
                      <Check className="w-4 h-4 stroke-[3]" />
                    </button>
                  </div>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      </main>

      {/* ========================================================================= */}
      {/* COMPONENT 4: Floating Bottom Navigation Dock & Global AI Voice Partner    */}
      {/* ========================================================================= */}
      <footer className="fixed bottom-6 inset-x-0 z-50 flex flex-col items-center justify-center pointer-events-none px-4">
        {/* Live Voice Status Feedback Capsule (Appears when Voice is Active) */}
        <AnimatePresence>
          {(isVoiceActive || voiceTranscript) && (
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9 }}
              className="mb-3 pointer-events-auto px-5 py-2 rounded-full bg-indigo-950/80 dark:bg-black/60 backdrop-blur-2xl border border-indigo-400/40 shadow-[0_0_30px_rgba(99,102,241,0.4)] text-xs text-indigo-200 font-mono flex items-center gap-2.5"
            >
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
              <span>{voiceTranscript || '🎙️ Listening for natural voice commands...'}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating Glassmorphic Dock Pill */}
        <div className="pointer-events-auto inline-flex items-center gap-3 md:gap-4 bg-white/5 dark:bg-white/5 backdrop-blur-2xl border border-white/10 rounded-full shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] px-5 md:px-6 py-2.5 md:py-3 transition-all duration-300 hover:border-white/20">
          {/* Nav Item: Home */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('home')
              if (onTabChange) onTabChange('home')
            }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              activeTab === 'home'
                ? 'bg-white/20 text-white shadow-inner border border-white/20'
                : 'text-white/50 hover:text-white/90 hover:bg-white/10'
            }`}
            title="Home Workspace"
            aria-label="Navigate to Home"
          >
            <Home className="w-4 h-4 md:w-5 md:h-5" />
          </button>

          {/* Nav Item: Focus */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('focus')
              if (onTabChange) onTabChange('focus')
            }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              activeTab === 'focus'
                ? 'bg-white/20 text-white shadow-inner border border-white/20'
                : 'text-white/50 hover:text-white/90 hover:bg-white/10'
            }`}
            title="Focus Mode"
            aria-label="Navigate to Focus Mode"
          >
            <Clock className="w-4 h-4 md:w-5 md:h-5" />
          </button>

          {/* ===================================================================== */}
          {/* CRITICAL: Prominent Glowing AI Voice Orb (Center Global Trigger)      */}
          {/* ===================================================================== */}
          <div className="relative flex items-center justify-center mx-1">
            {/* Glowing Breathing Ambient Aura */}
            <motion.div
              animate={{
                scale: isVoiceActive ? [1, 1.35, 1] : [1, 1.15, 1],
                opacity: isVoiceActive ? [0.7, 1, 0.7] : [0.3, 0.6, 0.3]
              }}
              transition={{ duration: isVoiceActive ? 1.2 : 3, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-500 via-teal-400 to-violet-500 blur-md pointer-events-none"
            />

            {/* Main Interactive Mic Orb */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.92 }}
              onClick={handleVoiceToggle}
              className={`w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center relative z-10 backdrop-blur-3xl border transition-all duration-300 shadow-xl ${
                isVoiceActive
                  ? 'bg-indigo-600/60 border-indigo-300/80 text-white shadow-[0_0_35px_rgba(99,102,241,0.7)]'
                  : 'bg-white/15 border-white/30 text-white/90 hover:bg-white/25 hover:border-white/50 shadow-[0_0_20px_rgba(255,255,255,0.15)]'
              }`}
              title="Trigger Registry AI Voice Partner"
              aria-label="Global Voice AI Partner"
            >
              <Mic className="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
            </motion.button>
          </div>

          {/* Nav Item: Calendar */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('calendar')
              if (onTabChange) onTabChange('calendar')
            }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              activeTab === 'calendar'
                ? 'bg-white/20 text-white shadow-inner border border-white/20'
                : 'text-white/50 hover:text-white/90 hover:bg-white/10'
            }`}
            title="Chronos Calendar"
            aria-label="Navigate to Calendar"
          >
            <Calendar className="w-4 h-4 md:w-5 md:h-5" />
          </button>

          {/* Nav Item: Settings */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('settings')
              if (onTabChange) onTabChange('settings')
            }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              activeTab === 'settings'
                ? 'bg-white/20 text-white shadow-inner border border-white/20'
                : 'text-white/50 hover:text-white/90 hover:bg-white/10'
            }`}
            title="Settings & Soundscapes"
            aria-label="Navigate to Settings"
          >
            <Settings2 className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>
      </footer>
    </div>
  )
}

export default Dashboard
