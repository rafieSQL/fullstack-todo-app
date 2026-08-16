import { parseVoiceIntent } from './voiceCommandEngine.js'
import { fetchWithTimeout } from './fetchWithTimeout.js'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const PRIMARY_MODEL = 'llama-3.3-70b-versatile'
const FALLBACK_MODEL = 'llama-3.1-8b-instant'

function capitalizeFirstLetter(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

/**
 * Get client's local timezone offset formatted as "+07:00" or "-05:00"
 */
export function getLocalTimezoneOffsetString(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absMin = Math.abs(offsetMinutes)
  const hours = String(Math.floor(absMin / 60)).padStart(2, '0')
  const minutes = String(absMin % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

/**
 * Format Date object to full local ISO string including timezone offset (e.g. 2026-08-18T13:00:00+07:00)
 */
export function formatToLocalISOString(date = new Date(), offsetStr = null) {
  const offset = offsetStr || getLocalTimezoneOffsetString(date)
  const pad = (n) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const min = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  return `${y}-${m}-${d}T${h}:${min}:${s}${offset}`
}

function isValidISO(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false
  const d = new Date(dateStr)
  return !isNaN(d.getTime())
}

/**
 * Normalize an ISO string from LLM to match the user's local timezone offset
 */
function normalizeTimezoneISO(isoStr, offsetStr) {
  if (!isoStr || typeof isoStr !== 'string') return isoStr
  let clean = isoStr.trim()
  if (clean.endsWith('Z') || clean.endsWith('z')) {
    clean = clean.replace(/\.\d{1,3}Z$/i, '').replace(/Z$/i, '') + offsetStr
  } else if (!/[+-]\d{2}:\d{2}$/.test(clean)) {
    clean = clean.replace(/\.\d{1,3}$/, '') + offsetStr
  }
  return clean
}

/**
 * Infer a sensible default deadline (today at 23:59:00 or tomorrow morning) formatted in local timezone
 */
function getDefaultDueDate(refDate = new Date(), offsetStr = null) {
  const d = new Date(refDate)
  const offset = offsetStr || getLocalTimezoneOffsetString(d)
  if (d.getHours() >= 23) {
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
  } else {
    d.setHours(23, 59, 0, 0)
  }
  return formatToLocalISOString(d, offset)
}

/**
 * Extract clean JSON object from LLM response
 */
function extractJSON(text) {
  if (!text) return null
  const cleaned = text.trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const matchJsonBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (matchJsonBlock && matchJsonBlock[1]) {
      try {
        return JSON.parse(matchJsonBlock[1].trim())
      } catch {
        // continue
      }
    }
    const matchObject = cleaned.match(/\{[\s\S]*\}/)
    if (matchObject) {
      try {
        return JSON.parse(matchObject[0])
      } catch {
        // continue
      }
    }
    return null
  }
}

function fallbackToLocal(transcript, currentTimeISO = null, activeTasks = []) {
  const local = parseVoiceIntent(transcript)
  let action = 'UNKNOWN'
  let replySummary = `Perintah: "${transcript}"`
  let targetView = null
  let targetTaskId = null
  const refDate = currentTimeISO ? new Date(currentTimeISO) : new Date()
  const offsetStr = getLocalTimezoneOffsetString(refDate)
  const defaultDue = getDefaultDueDate(refDate, offsetStr)

  const tasks = []

  // Check if user is completing or deleting a task from active tasks
  const lowerTranscript = transcript.toLowerCase()
  if (
    lowerTranscript.includes('selesai') ||
    lowerTranscript.includes('beres') ||
    lowerTranscript.includes('kelar') ||
    lowerTranscript.includes('complete')
  ) {
    const matched = activeTasks.find((t) => lowerTranscript.includes(t.title?.toLowerCase()))
    if (matched) {
      action = 'COMPLETE_TASK'
      targetTaskId = matched.id
      replySummary = `Siap bro, tugas "${matched.title}" udah ditandai selesai!`
    }
  } else if (
    lowerTranscript.includes('hapus') ||
    lowerTranscript.includes('delete') ||
    lowerTranscript.includes('batal')
  ) {
    const matched = activeTasks.find((t) => lowerTranscript.includes(t.title?.toLowerCase()))
    if (matched) {
      action = 'DELETE_TASK'
      targetTaskId = matched.id
      replySummary = `Siap bro, tugas "${matched.title}" berhasil dihapus.`
    }
  }

  if (action === 'UNKNOWN') {
    if (local.type === 'ADD_TASK') {
      action = 'CREATE_TASKS'
      const due = local.startTime ? normalizeTimezoneISO(local.startTime, offsetStr) : defaultDue
      tasks.push({
        title: local.title || transcript,
        category: local.category || 'General',
        workspace: local.category || 'General',
        priority: local.priority ? capitalizeFirstLetter(local.priority) : 'Medium',
        due_date: due,
        scheduled_at: due,
        duration_minutes: 30
      })
      replySummary = `Siap bro, tugas "${local.title || transcript}" udah masuk kalender.`
    } else if (local.type === 'SCHEDULE_TASK') {
      action = 'CREATE_TASKS'
      const due = local.startTime ? normalizeTimezoneISO(local.startTime, offsetStr) : defaultDue
      tasks.push({
        title: local.title || transcript,
        category: local.category || 'General',
        workspace: local.category || 'General',
        priority: local.priority ? capitalizeFirstLetter(local.priority) : 'Medium',
        due_date: due,
        scheduled_at: due,
        duration_minutes: 60
      })
      replySummary = `Siap bro, jadwal "${local.title}" berhasil diatur untuk ${new Date(due).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.`
    } else if (local.type === 'NAVIGATE') {
      action = 'NAVIGATE'
      targetView = local.view
      replySummary = `Siap bro, beralih ke ${
        local.view === 'calendar' ? 'Kalender' : local.view === 'focus' ? 'Fokus' : 'Tugas'
      }.`
    } else if (local.type === 'CLEAR_COMPLETED') {
      action = 'CLEAR_COMPLETED'
      replySummary = 'Siap bro, tugas yang telah selesai berhasil dibersihkan.'
    }
  }

  return {
    action,
    target_task_id: targetTaskId,
    tasks,
    title: local.title || transcript,
    start_time: local.startTime ? normalizeTimezoneISO(local.startTime, offsetStr) : defaultDue,
    scheduled_at: local.startTime ? normalizeTimezoneISO(local.startTime, offsetStr) : defaultDue,
    end_time: local.endTime ? normalizeTimezoneISO(local.endTime, offsetStr) : null,
    priority: local.priority ? capitalizeFirstLetter(local.priority) : 'Medium',
    category: local.category || 'General',
    workspace: local.category || 'General',
    target_view: targetView,
    is_ambiguous: false,
    confirmation_reply: replySummary,
    reply_summary: replySummary,
    raw: transcript
  }
}

function sanitizeAIResult(result, rawTranscript, offsetStr, currentTimeISO = null) {
  let action = result.action || result.intent || 'CREATE_TASKS'
  const refDate = currentTimeISO ? new Date(currentTimeISO) : new Date()
  const defaultDue = getDefaultDueDate(refDate, offsetStr)

  // Normalize action names
  if (action === 'complete' || action === 'toggle' || action === 'COMPLETE_TASK') {
    action = 'COMPLETE_TASK'
  } else if (action === 'bulk_delete' || action === 'BULK_DELETE_TASK' || action === 'BULK_DELETE') {
    action = 'BULK_DELETE_TASK'
  } else if (action === 'delete' || action === 'DELETE_TASK') {
    action = 'DELETE_TASK'
  } else if (action === 'ADD_TASK' || action === 'CREATE_TASK' || action === 'create') {
    action = 'CREATE_TASKS'
  } else if (action === 'SCHEDULE_TASK') {
    action = 'SCHEDULE_EVENT'
  }

  const targetTaskId = result.target_task_id || result.targetId || null
  const targetTaskIds = Array.isArray(result.target_task_ids) ? result.target_task_ids : []
  let tasks = []

  // If action is complete or delete, never produce new task skeletons
  if (action !== 'COMPLETE_TASK' && action !== 'DELETE_TASK' && action !== 'BULK_DELETE_TASK') {
    if (Array.isArray(result.tasks) && result.tasks.length > 0) {
      action = 'CREATE_TASKS'
      tasks = result.tasks.map((t) => {
      const cleanTitle = (t.title || '').trim() || 'Tugas Baru'
      const catVal = t.workspace || t.category || 'General'
      const cat = ['General', 'Engineering', 'Design', 'Personal'].includes(capitalizeFirstLetter(catVal))
        ? capitalizeFirstLetter(catVal)
        : 'General'
      const prio = ['High', 'Medium', 'Low'].includes(capitalizeFirstLetter(t.priority))
        ? capitalizeFirstLetter(t.priority)
        : 'Medium'
      const rawDue = t.scheduled_at || t.due_date || defaultDue
      const due = normalizeTimezoneISO(rawDue, offsetStr)
      const duration = Math.max(15, parseInt(t.duration_minutes, 10) || 30)

      return {
        title: cleanTitle,
        category: cat,
        workspace: cat,
        priority: prio,
        due_date: isValidISO(due) ? due : defaultDue,
        scheduled_at: isValidISO(due) ? due : defaultDue,
        duration_minutes: duration
      }
    })
  } else if (result.title) {
    const cleanTitle = result.title.trim()
    const catVal = result.workspace || result.category || 'General'
    const cat = ['General', 'Engineering', 'Design', 'Personal'].includes(capitalizeFirstLetter(catVal))
      ? capitalizeFirstLetter(catVal)
      : 'General'
    const prio = ['High', 'Medium', 'Low'].includes(capitalizeFirstLetter(result.priority))
      ? capitalizeFirstLetter(result.priority)
      : 'Medium'
    const rawDue = result.scheduled_at || result.due_date || result.start_time || defaultDue
    const due = normalizeTimezoneISO(rawDue, offsetStr)

    tasks = [
      {
        title: cleanTitle,
        category: cat,
        workspace: cat,
        priority: prio,
        due_date: isValidISO(due) ? due : defaultDue,
        scheduled_at: isValidISO(due) ? due : defaultDue,
        duration_minutes: 30
      }
    ]
  }
}

  let targetView = result.target_view
  if (action === 'NAVIGATE' && !targetView) {
    const lower = (rawTranscript || '').toLowerCase()
    if (lower.includes('kalender') || lower.includes('calendar') || lower.includes('jadwal')) {
      targetView = 'calendar'
    } else if (lower.includes('focus') || lower.includes('fokus')) {
      targetView = 'focus'
    } else {
      targetView = 'tasks'
    }
  }

  let replySummary = result.confirmation_reply || result.reply_summary
  if (!replySummary) {
    if (action === 'COMPLETE_TASK') {
      replySummary = 'Siap bro, tugas udah ditandai selesai!'
    } else if (action === 'DELETE_TASK') {
      replySummary = 'Siap bro, tugas berhasil dihapus.'
    } else if (tasks.length > 1) {
      replySummary = `Siap bro, ${tasks.length} tugas terjadwal udah masuk kalender.`
    } else if (tasks.length === 1) {
      replySummary = `Siap bro, tugas "${tasks[0].title}" udah masuk kalender.`
    } else {
      replySummary = `Perintah diproses: "${result.title || rawTranscript}"`
    }
  }

  const rawStartTime = result.scheduled_at || result.start_time || tasks[0]?.due_date || defaultDue
  const rawEndTime = result.end_time
  const catVal = result.workspace || result.category || tasks[0]?.category || 'General'
  const isAmbiguous = Boolean(result.is_ambiguous)

  return {
    action,
    target_task_id: targetTaskId,
    target_task_ids: targetTaskIds,
    tasks,
    title: result.title ? result.title.trim() : tasks[0]?.title || '',
    start_time: normalizeTimezoneISO(rawStartTime, offsetStr),
    scheduled_at: normalizeTimezoneISO(rawStartTime, offsetStr),
    end_time: rawEndTime ? normalizeTimezoneISO(rawEndTime, offsetStr) : null,
    priority: result.priority ? capitalizeFirstLetter(result.priority) : tasks[0]?.priority || 'Medium',
    category: capitalizeFirstLetter(catVal),
    workspace: capitalizeFirstLetter(catVal),
    target_view: targetView || null,
    is_ambiguous: isAmbiguous,
    confirmation_reply: replySummary,
    reply_summary: replySummary,
    raw: rawTranscript
  }
}

/**
 * Parse user voice or text command into structured intent with real-time context payload and active task memory
 */
export async function parseCommandWithAI(
  transcript,
  currentTimeISO = null,
  customTimezone = null,
  activeTasks = []
) {
  const now = currentTimeISO ? new Date(currentTimeISO) : new Date()
  const userTimezone =
    customTimezone ||
    (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Jakarta')
  const clientCurrentTime = now.toISOString()
  const offsetStr = getLocalTimezoneOffsetString(now)
  const localReferenceISO = formatToLocalISOString(now, offsetStr)

  const activeContextTasks = (activeTasks || []).slice(0, 20).map((t) => ({
    id: t.id || t._id,
    title: t.title || t.text,
    completed: Boolean(t.completed),
    category: t.category || t.workspace || 'General',
    workspace: t.category || t.workspace || 'General',
    priority: t.priority || 'Medium',
    dueDate: t.due_date || t.dueDate || t.scheduled_at || null,
    time: t.due_date || t.scheduled_at || 'tanpa jadwal'
  }))

  // 1. Try Vercel Serverless /api/partner route first with 7-second safety net timeout
  try {
    const res = await fetchWithTimeout(
      '/api/partner',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: transcript,
          transcript,
          clientTime: clientCurrentTime,
          timezone: userTimezone,
          tasks: activeContextTasks,
          activeTasks: activeContextTasks
        })
      },
      7000
    )

    if (res.ok) {
      const responseData = await res.json()
      if (responseData.data) {
        return sanitizeAIResult(responseData.data, transcript, offsetStr, clientCurrentTime)
      }
    }
  } catch (apiErr) {
    if (apiErr.message && apiErr.message.includes('TIMEOUT')) {
      throw apiErr
    }
    console.debug('/api/partner server route unavailable, trying direct LLM:', apiErr.message)
  }

  // 2. Direct client-side Groq Llama 3 fallback with 7-second safety net timeout
  const apiKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim()
  if (!apiKey) {
    console.warn('VITE_GROQ_API_KEY is not configured. Using local intent parser.')
    return fallbackToLocal(transcript, clientCurrentTime, activeContextTasks)
  }

  const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayNamesId = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
  const dayOfWeekEn = dayNamesEn[now.getDay()]
  const dayOfWeekId = dayNamesId[now.getDay()]

  const systemPrompt = `Kamu adalah AI pengelola to-do list & kalender.
WAKTU SEKARANG (User): ${localReferenceISO} (${dayOfWeekEn} / ${dayOfWeekId}).
TIMEZONE: ${userTimezone} (Offset: ${offsetStr}).

DAFTAR TUGAS AKTIF SAAT INI:
${JSON.stringify(activeContextTasks, null, 2)}

ATURAN WAJIB INTENT RECOGNITION:
1. Jika user menyebut kata "ubah", "selesaikan", "sudah", "beres", "done", "centang", "kelar", atau "tandai" diikuti nama tugas yang MIRIP dengan daftar di atas:
   - JANGAN PERNAH membuat task baru (DILARANG KERAS aksi CREATE / ADD / CREATE_TASKS)!
   - Cari task paling cocok dari daftar di atas, ambil properti 'id'-nya.
   - Kembalikan response JSON:
   {
     "action": "COMPLETE_TASK",
     "target_task_id": "<ID_PERSIS_DARI_LIST>",
     "targetId": "<ID_PERSIS_DARI_LIST>",
     "reply": "Tugas '<NAMA_TUGAS>' sudah ditandai selesai!",
     "confirmation_reply": "Tugas '<NAMA_TUGAS>' sudah ditandai selesai!"
   }
2. Jika user menyebut kata "hapus", "delete", atau "batalkan" diikuti nama tugas dari daftar di atas:
   - JANGAN membuat task baru!
   - Masukkan ID-nya ke 'target_task_id' dan pilih action 'DELETE_TASK'.
3. HANYA gunakan aksi 'CREATE_TASKS' jika user secara eksplisit ingin menambahkan tugas/jadwal baru yang belum ada di daftar.
4. "due_date" / "scheduled_at" harus berupa string ISO dengan offset "${offsetStr}" (contoh: YYYY-MM-DDTHH:MM:00${offsetStr}).
5. "confirmation_reply" & "reply": Balasan suara ramah & natural khas Partner.

Return STRICT JSON ONLY matching this schema:
{
  "action": "COMPLETE_TASK" | "DELETE_TASK" | "CREATE_TASKS" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "target_task_id": "string or null",
  "targetId": "string or null",
  "title": "string",
  "workspace": "General" | "Engineering" | "Design" | "Personal",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "priority": "High" | "Medium" | "Low",
  "scheduled_at": "YYYY-MM-DDTHH:MM:00${offsetStr}",
  "due_date": "YYYY-MM-DDTHH:MM:00${offsetStr}",
  "duration_minutes": 30,
  "is_ambiguous": false,
  "reply": "Balasan ramah Partner",
  "confirmation_reply": "Balasan ramah Partner",
  "reply_summary": "Balasan ramah Partner",
  "tasks": [
    {
      "title": "string",
      "workspace": "General" | "Engineering" | "Design" | "Personal",
      "category": "General" | "Engineering" | "Design" | "Personal",
      "priority": "High" | "Medium" | "Low",
      "scheduled_at": "YYYY-MM-DDTHH:MM:00${offsetStr}",
      "due_date": "YYYY-MM-DDTHH:MM:00${offsetStr}",
      "duration_minutes": 30
    }
  ]
}`

  const userPrompt = `User Command: "${transcript}"`

  try {
    const response = await fetchWithTimeout(
      GROQ_API_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: PRIMARY_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      },
      7000
    )

    if (!response.ok) {
      console.warn(
        `Groq primary model failed (${response.status}). Trying fallback model ${FALLBACK_MODEL}...`
      )
      const fallbackResp = await fetchWithTimeout(
        GROQ_API_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: FALLBACK_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
          })
        },
        7000
      )

      if (!fallbackResp.ok) {
        throw new Error(
          `Groq API request failed (${fallbackResp.status}): ${fallbackResp.statusText}`
        )
      }

      const fbData = await fallbackResp.json()
      const content = fbData.choices?.[0]?.message?.content
      const parsed = extractJSON(content)
      if (parsed) return sanitizeAIResult(parsed, transcript, offsetStr, clientCurrentTime)
    } else {
      const data = await response.json()
      const content = data.choices?.[0]?.message?.content
      const parsed = extractJSON(content)
      if (parsed) return sanitizeAIResult(parsed, transcript, offsetStr, clientCurrentTime)
    }

    throw new Error('Could not parse valid JSON from Groq AI response.')
  } catch (err) {
    if (err.message && err.message.includes('TIMEOUT')) {
      throw err
    }
    console.error('Groq AI parseCommand error:', err)
    return fallbackToLocal(transcript, clientCurrentTime, activeContextTasks)
  }
}
