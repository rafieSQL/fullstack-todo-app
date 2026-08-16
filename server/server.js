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

// Data persistence file paths
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'tasks.json')
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json')

const VALID_CATEGORIES = ['General', 'Engineering', 'Design', 'Personal']

function normalizeCategory(cat) {
  if (!cat || typeof cat !== 'string') return 'General'
  const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === cat.trim().toLowerCase())
  return match || 'General'
}

// Initial seed tasks
const INITIAL_TASKS = [
  {
    id: 'task-1',
    title: 'Audit database connection pooling and query timeouts',
    priority: 'high',
    category: 'Engineering',
    order: 0,
    completed: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString()
  },
  {
    id: 'task-2',
    title: 'Review pull request #104: Add idempotency headers to API endpoints',
    priority: 'medium',
    category: 'Engineering',
    order: 1,
    completed: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString()
  },
  {
    id: 'task-3',
    title: 'Standardize error response payloads across services',
    priority: 'low',
    category: 'Design',
    order: 2,
    completed: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 360).toISOString()
  },
  {
    id: 'task-4',
    title: 'Configure automated container vulnerability scanning',
    priority: 'high',
    category: 'Engineering',
    order: 3,
    completed: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 720).toISOString()
  }
]

// In-memory data stores
let tasks = []
let activities = []

function loadData() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }

    // Load tasks
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8')
      tasks = JSON.parse(data)
      // Ensure category and order exist on legacy items
      tasks = tasks.map((t, idx) => ({
        ...t,
        category: normalizeCategory(t.category),
        order: typeof t.order === 'number' ? t.order : idx
      }))
    } else {
      tasks = [...INITIAL_TASKS]
      saveTasks()
    }

    // Load activities
    if (fs.existsSync(ACTIVITY_FILE)) {
      const actData = fs.readFileSync(ACTIVITY_FILE, 'utf-8')
      activities = JSON.parse(actData)
    } else {
      activities = [
        {
          id: `act-${Date.now()}-1`,
          type: 'create',
          message: 'Initialized system with standard engineering backlog tasks',
          timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString()
        }
      ]
      saveActivities()
    }
  } catch (err) {
    console.error('Error loading data from disk:', err)
    tasks = [...INITIAL_TASKS]
    activities = []
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

function saveActivities() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(activities.slice(0, 50), null, 2), 'utf-8')
  } catch (err) {
    console.error('Error persisting activities to disk:', err)
  }
}

function logActivity(type, message, details = {}) {
  const newActivity = {
    id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    type,
    message,
    timestamp: new Date().toISOString(),
    ...details
  }
  activities.unshift(newActivity)
  if (activities.length > 50) {
    activities = activities.slice(0, 50)
  }
  saveActivities()
  return newActivity
}

// Initialize data store
loadData()

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
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

// Raw Body Buffer Middleware for audio uploads
app.use(
  '/api/partner-voice',
  express.raw({
    type: ['multipart/form-data', 'audio/*', 'application/octet-stream'],
    limit: '35mb'
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

/**
 * Helper to parse multipart/form-data audio or direct raw binary audio
 */
function parseAudioPayload(buffer, contentType) {
  if (!buffer || (Buffer.isBuffer(buffer) && buffer.length === 0)) {
    return { audioBuffer: null, mimeType: 'audio/webm', currentTimeISO: null }
  }

  const cType = (contentType || '').toLowerCase()

  // 1. If sent as JSON with audioBase64
  if (cType.includes('application/json')) {
    try {
      const parsed =
        typeof buffer === 'object' && !Buffer.isBuffer(buffer)
          ? buffer
          : JSON.parse(buffer.toString('utf-8'))
      if (parsed.audioBase64) {
        return {
          audioBuffer: Buffer.from(parsed.audioBase64, 'base64'),
          mimeType: parsed.mimeType || 'audio/webm',
          currentTimeISO: parsed.currentTimeISO || new Date().toISOString()
        }
      }
    } catch {
      // continue
    }
  }

  // 2. If sent directly as raw audio binary
  if (cType.startsWith('audio/') || cType.includes('application/octet-stream')) {
    const mime = cType.split(';')[0].trim()
    return { audioBuffer: buffer, mimeType: mime || 'audio/webm', currentTimeISO: null }
  }

  // 3. If sent as multipart/form-data
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  if (!boundaryMatch) {
    return { audioBuffer: buffer, mimeType: 'audio/webm', currentTimeISO: null }
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2]
  const boundaryBuffer = Buffer.from(`--${boundary}`)

  let audioBuffer = null
  let mimeType = 'audio/webm'
  let currentTimeISO = null

  let startIndex = buffer.indexOf(boundaryBuffer)
  while (startIndex !== -1) {
    const nextIndex = buffer.indexOf(boundaryBuffer, startIndex + boundaryBuffer.length)
    if (nextIndex === -1) break

    const part = buffer.subarray(startIndex + boundaryBuffer.length, nextIndex)
    const headerEndIndex = part.indexOf('\r\n\r\n')
    if (headerEndIndex !== -1) {
      const headers = part.subarray(0, headerEndIndex).toString('utf-8')
      let body = part.subarray(headerEndIndex + 4)
      if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) {
        body = body.subarray(0, body.length - 2)
      }

      if (headers.includes('name="audio"') || headers.includes('filename=')) {
        const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i)
        if (mimeMatch) mimeType = mimeMatch[1].trim()
        audioBuffer = body
      } else if (headers.includes('name="currentTimeISO"')) {
        currentTimeISO = body.toString('utf-8').trim()
      }
    }
    startIndex = nextIndex
  }

  return { audioBuffer: audioBuffer || buffer, mimeType, currentTimeISO }
}

// ==========================================
// ROUTES
// ==========================================

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    totalTasks: tasks.length,
    totalActivities: activities.length
  })
})

// 2. POST /api/partner-voice - Server-side Whisper Transcription & Llama 3 Reasoning
app.post('/api/partner-voice', async (req, res) => {
  try {
    const groqApiKey = (process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || '').trim()
    if (!groqApiKey) {
      return res.status(500).json({
        error: 'GROQ_API_KEY is not configured on the server.',
        details: 'Please set GROQ_API_KEY in server/.env'
      })
    }

    const { audioBuffer, mimeType, currentTimeISO } = parseAudioPayload(
      req.body,
      req.headers['content-type']
    )

    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({ error: 'No audio data received.' })
    }

    console.log(`[Partner Voice] Processing ${audioBuffer.length} bytes of audio (${mimeType})...`)

    // Step A: Speech-to-Text via Groq Whisper (whisper-large-v3)
    const whisperFormData = new FormData()
    const audioBlob = new Blob([audioBuffer], { type: mimeType })
    whisperFormData.append('file', audioBlob, 'voice_recording.webm')
    whisperFormData.append('model', 'whisper-large-v3')
    whisperFormData.append('response_format', 'json')

    const whisperResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`
      },
      body: whisperFormData
    })

    if (!whisperResponse.ok) {
      const errText = await whisperResponse.text()
      console.error('[Partner Voice] Whisper transcription error:', errText)
      return res.status(502).json({
        error: 'Whisper audio transcription failed',
        details: errText
      })
    }

    const whisperData = await whisperResponse.json()
    const transcript = (whisperData.text || '').trim()
    console.log(`[Partner Voice] Transcribed: "${transcript}"`)

    if (!transcript) {
      return res.json({
        transcript: '',
        result: {
          action: 'UNKNOWN',
          title: '',
          reply_summary: 'Suara tidak terdeteksi. Silakan coba lagi.'
        }
      })
    }

    // Step B: Intent Reasoning via Groq Llama 3 (llama-3.3-70b-versatile)
    const referenceTime =
      currentTimeISO || req.headers['x-current-time'] || new Date().toISOString()
    const systemPrompt = `You are an intelligent task & calendar assistant for a productivity application.
Extract task/schedule actions from the user's Indonesian or English command.
Current local ISO time: ${referenceTime}.

Return STRICT JSON ONLY matching this schema without markdown blocks:
{
  "action": "CREATE_TASK" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "title": "Concise task or event title (omit command verbs like 'tambah' or 'add')",
  "start_time": "ISO-8601 string or null",
  "end_time": "ISO-8601 string or null",
  "priority": "High" | "Medium" | "Low",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "target_view": "calendar" | "tasks" | "focus" | null,
  "reply_summary": "Friendly Indonesian acknowledgment (e.g. 'Tugas [judul] berhasil ditambahkan', 'Jadwal [judul] diatur pukul [jam]')"
}`

    const llamaResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `User Command: "${transcript}"` }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!llamaResponse.ok) {
      const errText = await llamaResponse.text()
      console.error('[Partner Voice] Llama reasoning error:', errText)
      return res.status(502).json({
        error: 'Llama intent reasoning failed',
        transcript,
        details: errText
      })
    }

    const llamaData = await llamaResponse.json()
    const content = llamaData.choices?.[0]?.message?.content || '{}'

    let result
    try {
      result = JSON.parse(content)
    } catch {
      const match = content.match(/\{[\s\S]*\}/)
      result = match ? JSON.parse(match[0]) : { action: 'UNKNOWN', reply_summary: content }
    }

    console.log(`[Partner Voice] Action: ${result.action}, Title: ${result.title}`)

    return res.json({
      transcript,
      result: {
        action: result.action || 'UNKNOWN',
        title: (result.title || '').trim(),
        start_time: result.start_time || null,
        end_time: result.end_time || null,
        priority: result.priority || 'Medium',
        category: result.category || 'General',
        target_view: result.target_view || null,
        reply_summary: result.reply_summary || `Perintah diproses: "${transcript}"`
      }
    })
  } catch (error) {
    console.error('[Partner Voice] Server error:', error)
    return res.status(500).json({
      error: 'Internal server error while processing partner voice command.',
      details: error.message
    })
  }
})

// 3. GET /api/activity - Fetch last 15 activity events
app.get('/api/activity', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 15
    res.json(activities.slice(0, limit))
  } catch (error) {
    console.error('Failed to get activity log:', error)
    res.status(500).json({ error: 'Failed to retrieve activity log' })
  }
})

// 3. GET /api/tasks - Fetch all tasks with optional search, category, priority, and sort
app.get('/api/tasks', (req, res) => {
  try {
    const { status, priority, category, search, sort } = req.query
    let filtered = [...tasks]

    // Status filter
    if (status === 'active') {
      filtered = filtered.filter((t) => !t.completed)
    } else if (status === 'completed') {
      filtered = filtered.filter((t) => t.completed)
    }

    // Priority filter
    if (priority && ['low', 'medium', 'high'].includes(priority.toLowerCase())) {
      filtered = filtered.filter((t) => t.priority === priority.toLowerCase())
    }

    // Category filter
    if (category && category !== 'all') {
      const normalizedCat = normalizeCategory(category)
      filtered = filtered.filter(
        (t) => (t.category || 'General').toLowerCase() === normalizedCat.toLowerCase()
      )
    }

    // Search query
    if (search && search.trim() !== '') {
      const term = search.trim().toLowerCase()
      filtered = filtered.filter((t) => t.title.toLowerCase().includes(term))
    }

    // Sorting
    if (sort === 'newest') {
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } else if (sort === 'oldest') {
      filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    } else if (sort === 'priority') {
      const pWeights = { high: 3, medium: 2, low: 1 }
      filtered.sort((a, b) => (pWeights[b.priority] || 0) - (pWeights[a.priority] || 0))
    } else if (sort === 'alphabetical') {
      filtered.sort((a, b) => a.title.localeCompare(b.title))
    } else {
      // Default: Persistent Custom Order (or newest if equal)
      filtered.sort((a, b) => {
        const orderA = typeof a.order === 'number' ? a.order : 9999
        const orderB = typeof b.order === 'number' ? b.order : 9999
        if (orderA !== orderB) return orderA - orderB
        return new Date(b.createdAt) - new Date(a.createdAt)
      })
    }

    res.json(filtered)
  } catch (error) {
    console.error('Failed to get tasks:', error)
    res.status(500).json({ error: 'Failed to retrieve tasks' })
  }
})

// 4. POST /api/tasks - Create a new task
app.post('/api/tasks', (req, res) => {
  try {
    const { title, priority = 'medium', category = 'General' } = req.body

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ error: 'Task title is required and cannot be empty' })
    }

    const validPriorities = ['low', 'medium', 'high']
    const normalizedPriority = validPriorities.includes(priority?.toLowerCase())
      ? priority.toLowerCase()
      : 'medium'
    const normalizedCategory = normalizeCategory(category)

    // Shift existing order numbers so new task is at top (order 0)
    tasks = tasks.map((t) => ({ ...t, order: (typeof t.order === 'number' ? t.order : 0) + 1 }))

    const newTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: title.trim(),
      priority: normalizedPriority,
      category: normalizedCategory,
      order: 0,
      completed: false,
      createdAt: new Date().toISOString()
    }

    tasks.unshift(newTask)
    saveTasks()

    logActivity(
      'create',
      `Created task "${newTask.title}" [${newTask.category} • ${newTask.priority.toUpperCase()}]`,
      { taskId: newTask.id }
    )

    res.status(201).json(newTask)
  } catch (error) {
    console.error('Failed to create task:', error)
    res.status(500).json({ error: 'Failed to create task' })
  }
})

// 5. PATCH /api/tasks/reorder - Reorder task sequences persistently
// Note: Must be declared BEFORE /api/tasks/:id
app.patch('/api/tasks/reorder', (req, res) => {
  try {
    const { orderedIds } = req.body

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ error: 'orderedIds must be an array of task IDs' })
    }

    const taskMap = new Map(tasks.map((t) => [t.id, t]))
    const reorderedTasks = []

    // Reorder matching tasks
    orderedIds.forEach((id, index) => {
      if (taskMap.has(id)) {
        const task = taskMap.get(id)
        task.order = index
        task.updatedAt = new Date().toISOString()
        reorderedTasks.push(task)
        taskMap.delete(id)
      }
    })

    // Append any remaining tasks
    let nextIndex = orderedIds.length
    for (const remainingTask of taskMap.values()) {
      remainingTask.order = nextIndex++
      reorderedTasks.push(remainingTask)
    }

    tasks = reorderedTasks
    saveTasks()

    logActivity(
      'reorder',
      `Reordered task list sequence (${orderedIds.length} items)`,
      { count: orderedIds.length }
    )

    res.json({
      message: 'Tasks reordered successfully',
      count: orderedIds.length,
      tasks
    })
  } catch (error) {
    console.error('Failed to reorder tasks:', error)
    res.status(500).json({ error: 'Failed to reorder tasks' })
  }
})

// 6. PATCH /api/tasks/batch-complete - Batch toggle status for multiple tasks
// Note: Must be declared BEFORE /api/tasks/:id
app.patch('/api/tasks/batch-complete', (req, res) => {
  try {
    const { taskIds, completed = true } = req.body

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'taskIds must be a non-empty array of task IDs' })
    }

    let updatedCount = 0
    const updatedTasks = []

    tasks = tasks.map((task) => {
      if (taskIds.includes(task.id)) {
        updatedCount++
        const updated = {
          ...task,
          completed: Boolean(completed),
          updatedAt: new Date().toISOString()
        }
        updatedTasks.push(updated)
        return updated
      }
      return task
    })

    if (updatedCount > 0) {
      saveTasks()
      const statusLabel = completed ? 'completed' : 'active'
      logActivity(
        'batch-complete',
        `Marked ${updatedCount} task${updatedCount === 1 ? '' : 's'} as ${statusLabel}`,
        { count: updatedCount }
      )
    }

    res.json({
      message: `Updated ${updatedCount} task${updatedCount === 1 ? '' : 's'}`,
      updatedCount,
      updatedTasks
    })
  } catch (error) {
    console.error('Failed to batch update tasks:', error)
    res.status(500).json({ error: 'Failed to batch update tasks' })
  }
})

// 7. DELETE /api/tasks/completed - Clear all completed tasks
// Note: Must be declared BEFORE /api/tasks/:id
app.delete('/api/tasks/completed', (req, res) => {
  try {
    const beforeCount = tasks.length
    tasks = tasks.filter((t) => !t.completed)
    const removedCount = beforeCount - tasks.length
    saveTasks()

    if (removedCount > 0) {
      logActivity(
        'clear-completed',
        `Purged ${removedCount} completed task${removedCount === 1 ? '' : 's'}`,
        { count: removedCount }
      )
    }

    res.json({
      message: `Cleared ${removedCount} completed task${removedCount === 1 ? '' : 's'}`,
      clearedCount: removedCount
    })
  } catch (error) {
    console.error('Failed to clear completed tasks:', error)
    res.status(500).json({ error: 'Failed to clear completed tasks' })
  }
})

// 8. PATCH /api/tasks/:id - Update task (toggle complete, edit title/priority/category/order)
app.patch('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params
    const { completed, title, priority, category, order } = req.body

    const taskIndex = tasks.findIndex((t) => t.id === id)
    if (taskIndex === -1) {
      return res.status(404).json({ error: `Task with id '${id}' not found` })
    }

    const task = tasks[taskIndex]
    const changes = []

    if (typeof completed === 'boolean' && task.completed !== completed) {
      task.completed = completed
      changes.push(`marked as ${completed ? 'completed' : 'active'}`)
    }

    if (typeof title === 'string' && title.trim() !== '' && task.title !== title.trim()) {
      const oldTitle = task.title
      task.title = title.trim()
      changes.push(`renamed to "${task.title}" (was "${oldTitle}")`)
    }

    if (
      priority &&
      ['low', 'medium', 'high'].includes(priority.toLowerCase()) &&
      task.priority !== priority.toLowerCase()
    ) {
      task.priority = priority.toLowerCase()
      changes.push(`priority set to ${task.priority.toUpperCase()}`)
    }

    if (category) {
      const normCat = normalizeCategory(category)
      if (task.category !== normCat) {
        task.category = normCat
        changes.push(`category set to ${normCat}`)
      }
    }

    if (typeof order === 'number') {
      task.order = order
    }

    task.updatedAt = new Date().toISOString()
    tasks[taskIndex] = task
    saveTasks()

    if (changes.length > 0) {
      logActivity('update', `Task "${task.title}": ${changes.join(', ')}`, {
        taskId: task.id
      })
    }

    res.json(task)
  } catch (error) {
    console.error('Failed to update task:', error)
    res.status(500).json({ error: 'Failed to update task' })
  }
})

// 9. DELETE /api/tasks/:id - Delete a specific task
app.delete('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params
    const taskIndex = tasks.findIndex((t) => t.id === id)

    if (taskIndex === -1) {
      return res.status(404).json({ error: `Task with id '${id}' not found` })
    }

    const [deletedTask] = tasks.splice(taskIndex, 1)
    saveTasks()

    logActivity('delete', `Deleted task "${deletedTask.title}"`, {
      taskId: deletedTask.id
    })

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
const server = app.listen(PORT, () => {
  console.log(`========================================`)
  console.log(` Utilitarian Task REST API Server active`)
  console.log(` URL: http://localhost:${PORT}`)
  console.log(` CORS Allowed: ${CLIENT_ORIGIN}`)
  console.log(` Initialized with ${tasks.length} tasks and ${activities.length} activities`)
  console.log(`========================================`)
})

// Process error and termination handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Process terminated gracefully')
  })
})

process.on('SIGINT', () => {
  server.close(() => {
    console.log('Process interrupted gracefully')
  })
})
