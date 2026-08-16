import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 5000
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

// Data persistence file path
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'tasks.json')

// Initial seed tasks
const INITIAL_TASKS = [
  {
    id: 'task-1',
    title: 'Audit database connection pooling and query timeouts',
    priority: 'high',
    completed: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString()
  },
  {
    id: 'task-2',
    title: 'Review pull request #104: Add idempotency headers to API endpoints',
    priority: 'medium',
    completed: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString()
  },
  {
    id: 'task-3',
    title: 'Standardize error response payloads across services',
    priority: 'low',
    completed: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 360).toISOString()
  },
  {
    id: 'task-4',
    title: 'Configure automated container vulnerability scanning',
    priority: 'high',
    completed: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 720).toISOString()
  }
]

// In-memory task store initialized from disk or default seed
let tasks = []

function loadTasks() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8')
      tasks = JSON.parse(data)
    } else {
      tasks = [...INITIAL_TASKS]
      saveTasks()
    }
  } catch (err) {
    console.error('Error loading tasks from disk:', err)
    tasks = [...INITIAL_TASKS]
  }
}

function saveTasks() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf-8')
  } catch (err) {
    console.error('Error persisting tasks to disk:', err)
  }
}

// Initialize task store
loadTasks()

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true)
      // Allow localhost dev servers or configured CLIENT_ORIGIN
      if (
        origin === CLIENT_ORIGIN ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:')
      ) {
        return callback(null, true)
      }
      return callback(null, true)
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
)

app.use(express.json())

// Request logger
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    console.log(`[API] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`)
  })
  next()
})

// Routes

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    totalTasks: tasks.length
  })
})

// 2. GET /api/tasks - Fetch all tasks with optional search and filter
app.get('/api/tasks', (req, res) => {
  try {
    const { status, priority, search } = req.query
    let filtered = [...tasks]

    if (status === 'active') {
      filtered = filtered.filter((t) => !t.completed)
    } else if (status === 'completed') {
      filtered = filtered.filter((t) => t.completed)
    }

    if (priority && ['low', 'medium', 'high'].includes(priority.toLowerCase())) {
      filtered = filtered.filter((t) => t.priority === priority.toLowerCase())
    }

    if (search && search.trim() !== '') {
      const term = search.trim().toLowerCase()
      filtered = filtered.filter((t) => t.title.toLowerCase().includes(term))
    }

    res.json(filtered)
  } catch (error) {
    console.error('Failed to get tasks:', error)
    res.status(500).json({ error: 'Failed to retrieve tasks' })
  }
})

// 3. POST /api/tasks - Create a new task
app.post('/api/tasks', (req, res) => {
  try {
    const { title, priority = 'medium' } = req.body

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ error: 'Task title is required and cannot be empty' })
    }

    const validPriorities = ['low', 'medium', 'high']
    const normalizedPriority = validPriorities.includes(priority?.toLowerCase())
      ? priority.toLowerCase()
      : 'medium'

    const newTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: title.trim(),
      priority: normalizedPriority,
      completed: false,
      createdAt: new Date().toISOString()
    }

    tasks.unshift(newTask)
    saveTasks()

    res.status(201).json(newTask)
  } catch (error) {
    console.error('Failed to create task:', error)
    res.status(500).json({ error: 'Failed to create task' })
  }
})

// 4. DELETE /api/tasks/completed - Clear all completed tasks
// Note: Must be placed BEFORE /api/tasks/:id route
app.delete('/api/tasks/completed', (req, res) => {
  try {
    const beforeCount = tasks.length
    tasks = tasks.filter((t) => !t.completed)
    const removedCount = beforeCount - tasks.length
    saveTasks()

    res.json({
      message: `Cleared ${removedCount} completed task${removedCount === 1 ? '' : 's'}`,
      clearedCount: removedCount
    })
  } catch (error) {
    console.error('Failed to clear completed tasks:', error)
    res.status(500).json({ error: 'Failed to clear completed tasks' })
  }
})

// 5. PATCH /api/tasks/:id - Update task (toggle complete, edit title/priority)
app.patch('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params
    const { completed, title, priority } = req.body

    const taskIndex = tasks.findIndex((t) => t.id === id)
    if (taskIndex === -1) {
      return res.status(404).json({ error: `Task with id '${id}' not found` })
    }

    const task = tasks[taskIndex]

    if (typeof completed === 'boolean') {
      task.completed = completed
    }

    if (typeof title === 'string' && title.trim() !== '') {
      task.title = title.trim()
    }

    if (priority && ['low', 'medium', 'high'].includes(priority.toLowerCase())) {
      task.priority = priority.toLowerCase()
    }

    task.updatedAt = new Date().toISOString()
    tasks[taskIndex] = task
    saveTasks()

    res.json(task)
  } catch (error) {
    console.error('Failed to update task:', error)
    res.status(500).json({ error: 'Failed to update task' })
  }
})

// 6. DELETE /api/tasks/:id - Delete a specific task
app.delete('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params
    const taskIndex = tasks.findIndex((t) => t.id === id)

    if (taskIndex === -1) {
      return res.status(404).json({ error: `Task with id '${id}' not found` })
    }

    const [deletedTask] = tasks.splice(taskIndex, 1)
    saveTasks()

    res.json({
      message: 'Task deleted successfully',
      deletedTask
    })
  } catch (error) {
    console.error('Failed to delete task:', error)
    res.status(500).json({ error: 'Failed to delete task' })
  }
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err)
  res.status(500).json({ error: 'Internal Server Error' })
})

// Start server
app.listen(PORT, () => {
  console.log(`========================================`)
  console.log(` Utilitarian Task REST API Server active`)
  console.log(` URL: http://localhost:${PORT}`)
  console.log(` CORS Allowed: ${CLIENT_ORIGIN}`)
  console.log(` Initialized with ${tasks.length} tasks`)
  console.log(`========================================`)
})
