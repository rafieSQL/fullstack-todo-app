/**
 * Partner Ambient Voice Command & Intent Recognition Engine
 * Zero external dependencies, built on native Web Speech API
 */

let recognitionInstance = null
let isListeningState = false

export function isSpeechRecognitionSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

function capitalizeFirstLetter(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Parse time string to ISO start & end times for today
 */
export function parseScheduleTimes(timeStr) {
  const now = new Date()
  let hour = 9
  let minute = 0

  const cleaned = (timeStr || '').toLowerCase().trim()

  // Match 14:00 or 14.30
  const matchColon = cleaned.match(/(\d{1,2})[:.](\d{2})/)
  if (matchColon) {
    hour = parseInt(matchColon[1], 10)
    minute = parseInt(matchColon[2], 10)
  } else {
    // Match single hour with am/pm or sore/pagi/siang/malam
    const matchNum = cleaned.match(/(\d{1,2})/)
    if (matchNum) {
      hour = parseInt(matchNum[1], 10)
      if (
        (cleaned.includes('sore') ||
          cleaned.includes('pm') ||
          cleaned.includes('malam') ||
          cleaned.includes('siang')) &&
        hour < 12
      ) {
        hour += 12
      } else if ((cleaned.includes('pagi') || cleaned.includes('am')) && hour === 12) {
        hour = 0
      }
    }
  }

  hour = Math.min(23, Math.max(0, hour))
  minute = Math.min(59, Math.max(0, minute))

  const start = new Date(now)
  start.setHours(hour, minute, 0, 0)
  const end = new Date(start.getTime() + 3600000) // Default 1 hour duration

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString()
  }
}

/**
 * Regex Intent Parser supporting Indonesian ('id-ID') & English ('en-US')
 */
export function parseVoiceIntent(rawTranscript) {
  if (!rawTranscript || typeof rawTranscript !== 'string') {
    return { type: 'UNKNOWN', raw: rawTranscript }
  }

  const text = rawTranscript.trim().toLowerCase()

  // 1. Navigation / View Switching
  const navMatch = text.match(
    /(?:buka|lihat|tampilkan|open|switch to|go to|view)\s+(kalender|calendar|jadwal|tugas|task|tasks|registry|focus|fokus)/i
  )
  if (navMatch) {
    const target = navMatch[1].toLowerCase()
    if (['kalender', 'calendar', 'jadwal'].includes(target)) {
      return { type: 'NAVIGATE', view: 'calendar', raw: text }
    }
    if (['tugas', 'task', 'tasks', 'registry'].includes(target)) {
      return { type: 'NAVIGATE', view: 'tasks', raw: text }
    }
    if (['focus', 'fokus'].includes(target)) {
      return { type: 'NAVIGATE', view: 'focus', raw: text }
    }
  }

  // 2. Clear Completed Tasks
  if (
    /(?:hapus|bersihkan|clear|purge|delete)\s+(?:yang\s+)?(?:selesai|completed|done)/i.test(text)
  ) {
    return { type: 'CLEAR_COMPLETED', raw: text }
  }

  // 3. Schedule Task: e.g. "jadwalkan [task title] jam 14:00" or "schedule [task title] at 3pm"
  const scheduleMatch = text.match(
    /(?:jadwalkan|jadwal|schedule)\s+(.+?)\s+(?:jam|pukul|at)\s+(.+)/i
  )
  if (scheduleMatch) {
    const rawTitle = scheduleMatch[1].trim()
    const rawTime = scheduleMatch[2].trim()

    const { startTime, endTime } = parseScheduleTimes(rawTime)
    return {
      type: 'SCHEDULE_TASK',
      title: capitalizeFirstLetter(rawTitle),
      startTime,
      endTime,
      category: 'General',
      priority: 'medium',
      raw: text
    }
  }

  // 4. Add Task: e.g. "tambah tugas [title] prioritas tinggi" or "add task [title] priority high"
  const addTaskMatch = text.match(/(?:tambah|buat|add|create|new)\s+(?:tugas|task|todo)\s+(.+)/i)
  if (addTaskMatch) {
    let remainder = addTaskMatch[1].trim()
    let priority = 'medium'
    let category = 'General'

    // Check priority
    const prioMatch = remainder.match(
      /(?:prioritas|priority)\s+(tinggi|sedang|rendah|high|medium|low)/i
    )
    if (prioMatch) {
      const p = prioMatch[1].toLowerCase()
      if (['tinggi', 'high'].includes(p)) priority = 'high'
      else if (['rendah', 'low'].includes(p)) priority = 'low'
      else priority = 'medium'
      remainder = remainder.replace(prioMatch[0], '').trim()
    }

    // Check category
    const catMatch = remainder.match(
      /(?:kategori|category)\s+(engineering|design|personal|general)/i
    )
    if (catMatch) {
      const c = catMatch[1].toLowerCase()
      if (c === 'engineering') category = 'Engineering'
      else if (c === 'design') category = 'Design'
      else if (c === 'personal') category = 'Personal'
      else category = 'General'
      remainder = remainder.replace(catMatch[0], '').trim()
    }

    const title = capitalizeFirstLetter(remainder.replace(/^[:\-–]\s*/, '').trim())
    if (title) {
      return {
        type: 'ADD_TASK',
        title,
        priority,
        category,
        raw: text
      }
    }
  }

  return { type: 'UNKNOWN', raw: text }
}

/**
 * Initialize and start voice recognition
 */
export function startListening({
  onInterimResult = () => {},
  onFinalCommand = () => {},
  onError = () => {},
  onEnd = () => {},
  lang = 'id-ID'
} = {}) {
  if (!isSpeechRecognitionSupported()) {
    onError(new Error('SpeechRecognition is not supported in this browser.'))
    return null
  }

  stopListening()

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  const recognition = new SpeechRecognition()

  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = lang

  recognition.onresult = (event) => {
    let interimTranscript = ''
    let finalTranscript = ''

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        finalTranscript += transcript
      } else {
        interimTranscript += transcript
      }
    }

    if (interimTranscript) {
      onInterimResult(interimTranscript)
    }

    if (finalTranscript) {
      const intent = parseVoiceIntent(finalTranscript)
      onFinalCommand(intent, finalTranscript)
    }
  }

  recognition.onerror = (event) => {
    // Ignore benign non-fatal events like no-speech
    if (event.error === 'no-speech' || event.error === 'aborted') return
    console.debug('Speech recognition error:', event.error)
    onError(event)
  }

  recognition.onend = () => {
    isListeningState = false
    onEnd()
  }

  try {
    recognition.start()
    isListeningState = true
    recognitionInstance = recognition
  } catch (err) {
    isListeningState = false
    onError(err)
  }

  return recognition
}

/**
 * Stop active speech recognition
 */
export function stopListening() {
  if (recognitionInstance) {
    try {
      recognitionInstance.stop()
    } catch {
      // ignore
    }
    recognitionInstance = null
  }
  isListeningState = false
}

export function isListening() {
  return isListeningState
}
