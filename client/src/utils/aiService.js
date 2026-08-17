import { parseVoiceIntent } from './voiceCommandEngine.js'

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
 * If LLM returned "Z" or bare datetime, rewrite suffix with offsetStr to prevent UTC double-conversion.
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
 * Extract clean JSON object from LLM response (handling potential markdown formatting)
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

function fallbackToLocal(transcript, currentTimeISO = null) {
  const local = parseVoiceIntent(transcript)
  let action = 'UNKNOWN'
  let replySummary = `Perintah: "${transcript}"`
  let targetView = null
  const refDate = currentTimeISO ? new Date(currentTimeISO) : new Date()
  const offsetStr = getLocalTimezoneOffsetString(refDate)
  const defaultDue = getDefaultDueDate(refDate, offsetStr)

  const tasks = []

  if (local.type === 'ADD_TASK') {
    action = 'CREATE_TASKS'
    const due = local.startTime ? normalizeTimezoneISO(local.startTime, offsetStr) : defaultDue
    tasks.push({
      title: local.title || transcript,
      category: local.category || 'General',
      priority: local.priority ? capitalizeFirstLetter(local.priority) : 'Medium',
      due_date: due,
      duration_minutes: 30
    })
    replySummary = `Tugas "${local.title || transcript}" berhasil dibuat dengan tenggat ${new Date(due).toLocaleDateString('id-ID')}.`
  } else if (local.type === 'SCHEDULE_TASK') {
    action = 'CREATE_TASKS'
    const due = local.startTime ? normalizeTimezoneISO(local.startTime, offsetStr) : defaultDue
    tasks.push({
      title: local.title || transcript,
      category: local.category || 'General',
      priority: local.priority ? capitalizeFirstLetter(local.priority) : 'Medium',
      due_date: due,
      duration_minutes: 60
    })
    replySummary = `Jadwal "${local.title}" berhasil diatur untuk ${new Date(due).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.`
  } else if (local.type === 'NAVIGATE') {
    action = 'NAVIGATE'
    targetView = local.view
    replySummary = `Beralih ke ${
      local.view === 'calendar' ? 'Kalender' : local.view === 'focus' ? 'Fokus' : 'Tugas'
    }.`
  } else if (local.type === 'CLEAR_COMPLETED') {
    action = 'CLEAR_COMPLETED'
    replySummary = 'Membersihkan tugas yang telah selesai.'
  }

  // Focus Mode voice control checks
  const lower = (transcript || '').toLowerCase().trim()
  if (
    /tutup (mode )?fokus|keluar (dari )?fokus|selesai fokus|akhiri fokus|exit focus|end focus|close focus/.test(
      lower
    )
  ) {
    action = 'EXIT_FOCUS'
    replySummary = 'Menutup sesi Focus Mode.'
  } else if (
    /minimize (mode )?fokus|kecilkan (mode )?fokus|\bminimize\b/.test(lower)
  ) {
    action = 'MINIMIZE_FOCUS'
    replySummary = 'Memperkecil Focus Mode ke floating mini-player.'
  } else if (
    /(?:tandai|mark)\s+(?:task|tugas)?\s*(?:saat ini|ini|fokus|current)?\s*(?:selesai|as done|done)|selesaikan\s+(?:task|tugas|fokus(?:\s+task)?)/i.test(
      lower
    )
  ) {
    action = 'COMPLETE_ACTIVE_TASK'
    replySummary = 'Menandai task aktif saat ini selesai.'
    return {
      action,
      tasks: [],
      reply_summary: replySummary,
      raw: transcript
    }
  } else {
    // Focus task targeting & duration regex: e.g. "Fokus ke task Review PR selama 25 menit" or "Kerjakan database 30 menit"
    const focusTargetMatch = lower.match(
      /(?:fokus(?:kan)?(?:\s+(?:ke|pada))?|kerjakan)\s+(?:task|tugas)?\s*(.+?)(?:\s+(?:selama|for)\s+(\d+)\s*(?:menit|mins?|m)|\s+(\d+)\s*(?:menit|mins?|m))?$/i
    )
    if (focusTargetMatch && !/tutup|keluar|selesai|akhiri|minimize|kalender|calendar/.test(focusTargetMatch[1])) {
      const rawTarget = focusTargetMatch[1].replace(/^(?:task|tugas)\s+/i, '').trim()
      const rawMinutes = parseInt(focusTargetMatch[2] || focusTargetMatch[3], 10) || null
      action = 'FOCUS_TASK'
      return {
        action,
        tasks: [],
        target_task_title: rawTarget,
        duration_minutes: rawMinutes,
        reply_summary: `Mengarahkan fokus ke "${rawTarget}"${rawMinutes ? ` selama ${rawMinutes} menit` : ''}.`,
        raw: transcript
      }
    }
  }

  return {
    action,
    tasks,
    title: local.title || transcript,
    start_time: local.startTime ? normalizeTimezoneISO(local.startTime, offsetStr) : defaultDue,
    end_time: local.endTime ? normalizeTimezoneISO(local.endTime, offsetStr) : null,
    priority: local.priority ? capitalizeFirstLetter(local.priority) : 'Medium',
    category: local.category || 'General',
    target_view: targetView,
    reply_summary: replySummary,
    raw: transcript
  }
}

function sanitizeAIResult(result, rawTranscript, offsetStr, currentTimeISO = null) {
  let action = result.action || 'UNKNOWN'
  const refDate = currentTimeISO ? new Date(currentTimeISO) : new Date()
  const defaultDue = getDefaultDueDate(refDate, offsetStr)

  // Normalize action names
  if (action === 'ADD_TASK' || action === 'CREATE_TASK') {
    action = 'CREATE_TASKS'
  }
  if (action === 'SCHEDULE_TASK') {
    action = 'SCHEDULE_EVENT'
  }

  let tasks = []

  if (Array.isArray(result.tasks) && result.tasks.length > 0) {
    action = 'CREATE_TASKS'
    tasks = result.tasks.map((t) => {
      const cleanTitle = (t.title || '').trim() || 'Tugas Baru'
      const cat = ['General', 'Engineering', 'Design', 'Personal'].includes(capitalizeFirstLetter(t.category))
        ? capitalizeFirstLetter(t.category)
        : 'General'
      const prio = ['High', 'Medium', 'Low'].includes(capitalizeFirstLetter(t.priority))
        ? capitalizeFirstLetter(t.priority)
        : 'Medium'
      const rawDue = t.due_date || defaultDue
      const due = normalizeTimezoneISO(rawDue, offsetStr)
      const duration = Math.max(15, parseInt(t.duration_minutes, 10) || 30)

      return {
        title: cleanTitle,
        category: cat,
        priority: prio,
        due_date: isValidISO(due) ? due : defaultDue,
        duration_minutes: duration
      }
    })
  } else if (result.title && action === 'CREATE_TASKS') {
    const cleanTitle = result.title.trim()
    const cat = ['General', 'Engineering', 'Design', 'Personal'].includes(capitalizeFirstLetter(result.category))
      ? capitalizeFirstLetter(result.category)
      : 'General'
    const prio = ['High', 'Medium', 'Low'].includes(capitalizeFirstLetter(result.priority))
      ? capitalizeFirstLetter(result.priority)
      : 'Medium'
    const rawDue = result.due_date || result.start_time || defaultDue
    const due = normalizeTimezoneISO(rawDue, offsetStr)

    tasks = [
      {
        title: cleanTitle,
        category: cat,
        priority: prio,
        due_date: isValidISO(due) ? due : defaultDue,
        duration_minutes: 30
      }
    ]
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

  let replySummary = result.reply_summary
  if (!replySummary) {
    if (tasks.length > 1) {
      replySummary = `Berhasil memecah dan menjadwalkan ${tasks.length} tugas ke kalender.`
    } else if (tasks.length === 1) {
      replySummary = `Tugas "${tasks[0].title}" berhasil dijadwalkan (${new Date(tasks[0].due_date).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}).`
    } else {
      replySummary = `Perintah diproses: "${result.title || rawTranscript}"`
    }
  }

  const rawStartTime = result.start_time || tasks[0]?.due_date || defaultDue
  const rawEndTime = result.end_time

  return {
    action,
    tasks,
    title: result.title ? result.title.trim() : tasks[0]?.title || '',
    target_task_title: result.target_task_title || result.target_task || result.title || null,
    duration_minutes: result.duration_minutes ? parseInt(result.duration_minutes, 10) : null,
    start_time: normalizeTimezoneISO(rawStartTime, offsetStr),
    end_time: rawEndTime ? normalizeTimezoneISO(rawEndTime, offsetStr) : null,
    priority: result.priority ? capitalizeFirstLetter(result.priority) : tasks[0]?.priority || 'Medium',
    category: result.category ? capitalizeFirstLetter(result.category) : tasks[0]?.category || 'General',
    target_view: targetView || null,
    reply_summary: replySummary,
    raw: rawTranscript
  }
}

/**
 * Parse user voice or text command into structured intent using Groq Llama 3 with exact Local Timezone Offset preservation
 */
export async function parseCommandWithAI(transcript, currentTimeISO = null) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY

  if (!apiKey || apiKey.trim() === '') {
    console.warn('VITE_GROQ_API_KEY is not configured. Using local intent parser.')
    return fallbackToLocal(transcript, currentTimeISO)
  }

  const now = currentTimeISO ? new Date(currentTimeISO) : new Date()
  const offsetStr = getLocalTimezoneOffsetString(now)
  const localReferenceISO = formatToLocalISOString(now, offsetStr)

  const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayNamesId = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
  const dayOfWeekEn = dayNamesEn[now.getDay()]
  const dayOfWeekId = dayNamesId[now.getDay()]

  const systemPrompt = `You are an elite productivity AI agent and multi-task scheduling engine.
Current Local Datetime: ${localReferenceISO} (${dayOfWeekEn} / ${dayOfWeekId}).
User's Local Timezone Offset: ${offsetStr} (e.g., UTC+7 WIB).

Your job is to parse user commands (Indonesian or English) into structured actions.
KEY CAPABILITY: MULTI-TASK DECOMPOSITION & MANDATORY DEADLINES.
If the user provides a sentence containing one or more tasks, steps, plans, or deadlines (e.g. "Ada ujian matematika hari selasa jam 13, paginya mau belajar 30 menit jam 7"):
Decompose them into an array of actionable tasks under "action": "CREATE_TASKS".
If user gives a single task, also output "action": "CREATE_TASKS" with 1 item in "tasks" array.

CRITICAL TIMEZONE & OFFSET RULES:
1. The user's local timezone offset is: ${offsetStr}.
2. When user specifies an hour (e.g. "jam 13" or "jam 07" or "13:00" or "pukul 13"), this refers to their LOCAL time (${offsetStr}).
3. ALWAYS output "due_date", "start_time", and "end_time" formatted with the user's exact timezone offset "${offsetStr}" (e.g. "YYYY-MM-DDTHH:MM:00${offsetStr}").
4. NEVER output "Z" UTC timestamps and NEVER shift or convert the user's requested local hours into UTC.
   - Example: If user says "ujian matematika selasa jam 13:00", the "due_date" MUST literally be "2026-08-18T13:00:00${offsetStr}".
   - Example: If user says "belajar jam 7 pagi", the "due_date" MUST literally be "2026-08-18T07:00:00${offsetStr}".
5. If only a date is mentioned without time (e.g., "besok", "hari jumat"), set due_date to that date at 17:00:00${offsetStr} or 23:59:00${offsetStr}.
6. If no deadline or time is mentioned at all, infer a sensible default (e.g., today at 23:59:00${offsetStr} or tomorrow morning).
7. "duration_minutes": Duration in minutes (default 30 or 60).
8. "priority": "High" | "Medium" | "Low". (Exams, tests, urgent deadlines = "High").
9. "category": "General" | "Engineering" | "Design" | "Personal".
10. If user asks to close, exit, end, or finish focus mode (e.g. "tutup mode fokus", "keluar dari fokus", "selesai fokus", "akhiri fokus", "exit focus", "end focus", "close focus"):
    Output "action": "EXIT_FOCUS", "reply_summary": "Menutup sesi Focus Mode."
11. If user asks to minimize focus mode or reduce to mini player (e.g. "minimize fokus", "kecilkan mode fokus", "minimize"):
    Output "action": "MINIMIZE_FOCUS", "reply_summary": "Memperkecil Focus Mode ke floating mini-player."
12. If user asks to target a task in focus mode with/without custom duration (e.g. "Fokus ke task Review PR selama 25 menit", "Kerjakan Audit database 30 menit", "Fokus belajar kimia", "Focus on PR review for 45 mins"):
    Output "action": "FOCUS_TASK", "target_task_title": "Clean extracted task title", "duration_minutes": 25, "reply_summary": "Mengarahkan fokus ke task tersebut."
13. If user asks to mark current active focus task as completed (e.g. "Tandai task saat ini selesai", "Task ini selesai", "Selesaikan fokus task", "Mark current task as done", "Tandai tugas ini selesai"):
    Output "action": "COMPLETE_ACTIVE_TASK", "reply_summary": "Menandai task aktif saat ini selesai."

Return STRICT JSON ONLY matching this schema without markdown blocks:
{
  "action": "CREATE_TASKS" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "EXIT_FOCUS" | "MINIMIZE_FOCUS" | "FOCUS_TASK" | "COMPLETE_ACTIVE_TASK" | "UNKNOWN",
  "tasks": [
    {
      "title": "Clean, concise actionable title",
      "category": "General" | "Engineering" | "Design" | "Personal",
      "priority": "High" | "Medium" | "Low",
      "due_date": "YYYY-MM-DDTHH:MM:00${offsetStr}",
      "duration_minutes": 30
    }
  ],
  "title": "Clean concise title for single event/task",
  "target_task_title": "Title of task to target for FOCUS_TASK or null",
  "duration_minutes": 30,
  "start_time": "YYYY-MM-DDTHH:MM:00${offsetStr} or null",
  "end_time": "YYYY-MM-DDTHH:MM:00${offsetStr} or null",
  "priority": "High" | "Medium" | "Low",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "target_view": "calendar" | "tasks" | "focus" | null,
  "reply_summary": "Friendly Indonesian acknowledgment (e.g., 'Berhasil memecah dan menambahkan 2 tugas terjadwal ke kalender.')"
}`

  const userPrompt = `User Command: "${transcript}"`

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`
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
    })

    if (!response.ok) {
      console.warn(
        `Groq primary model failed (${response.status}). Trying fallback model ${FALLBACK_MODEL}...`
      )
      const fallbackResp = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`
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
      })

      if (!fallbackResp.ok) {
        throw new Error(
          `Groq API request failed (${fallbackResp.status}): ${fallbackResp.statusText}`
        )
      }

      const fbData = await fallbackResp.json()
      const content = fbData.choices?.[0]?.message?.content
      const parsed = extractJSON(content)
      if (parsed) return sanitizeAIResult(parsed, transcript, offsetStr, currentTimeISO)
    } else {
      const data = await response.json()
      const content = data.choices?.[0]?.message?.content
      const parsed = extractJSON(content)
      if (parsed) return sanitizeAIResult(parsed, transcript, offsetStr, currentTimeISO)
    }

    throw new Error('Could not parse valid JSON from Groq AI response.')
  } catch (err) {
    console.error('Groq AI parseCommand error:', err)
    return fallbackToLocal(transcript, currentTimeISO)
  }
}
