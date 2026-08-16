/**
 * Partner Ambient Voice Command & Intent Recognition Engine
 * Resilient Web Speech API wrapper with automatic restart loop,
 * 1.2s silence interim fallback, and relaxed regex intent matching.
 */

let recognitionInstance = null
let shouldKeepListening = false
let restartTimeout = null
let silenceDebounceTimer = null
let lastProcessedCommand = ''
let lastProcessedTime = 0

export function isSpeechRecognitionSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

function capitalizeFirstLetter(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function normalizeTranscript(text) {
  if (!text || typeof text !== 'string') return ''
  return text
    .toLowerCase()
    .replace(/[.,?!:;]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
          cleaned.includes('siang') ||
          cleaned.includes('mlm')) &&
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
  const end = new Date(start.getTime() + 3600000) // Default 1 hour slot

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString()
  }
}

/**
 * Highly Permissive Regex Intent Parser supporting Indonesian & English
 */
export function parseVoiceIntent(rawTranscript) {
  const text = normalizeTranscript(rawTranscript)
  if (!text) {
    return { type: 'UNKNOWN', raw: rawTranscript }
  }

  console.log('🎤 Final Clean Transcript:', text)

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
    /(?:hapus|bersihkan|clear|purge|delete)\s+(?:yang\s+)?(?:selesai|completed|done|task selesai)/i.test(
      text
    )
  ) {
    return { type: 'CLEAR_COMPLETED', raw: text }
  }

  // 3. Schedule Task: e.g. "jadwalkan [task title] jam 14:00" or "schedule [task title] at 3pm"
  const scheduleMatch = text.match(
    /(?:jadwalkan|jadwal|schedule)\s+(.+?)\s+(?:jam|pukul|at|for)\s+(.+)/i
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

  // 4. Add Task: Highly permissive regex
  // Matches: "tambah tugas ABC", "tambah ABC", "tambahkan tugas ABC", "buat tugas ABC", "bikin task ABC", "add task ABC", "add ABC", "create ABC"
  const addTaskMatch =
    text.match(/^(?:tambah(?:kan)?|buat|bikin|add|create|new)\s+(?:tugas|task|todo)?\s*(.+)$/i) ||
    text.match(/(?:tambah(?:kan)?|buat|bikin|add|create|new)\s+(?:tugas|task|todo)\s+(.+)/i)

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
    if (title && title.length >= 1) {
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
 * Initialize and start voice recognition with automatic restart and 1.2s silence fallback
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
  shouldKeepListening = true

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

  const initRecognition = () => {
    if (!shouldKeepListening) return null

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.lang = lang || (typeof navigator !== 'undefined' ? navigator.language : 'id-ID')

    recognition.onresult = (event) => {
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const item = event.results[i]
        const transcript = item[0]?.transcript || ''
        if (item.isFinal) {
          finalTranscript += transcript
        } else {
          interimTranscript += transcript
        }
      }

      const cleanInterim = normalizeTranscript(interimTranscript)
      const cleanFinal = normalizeTranscript(finalTranscript)

      if (cleanInterim) {
        onInterimResult(cleanInterim)

        // 1.2-Second Silence Debounce on Interim Results:
        // Automatically process command if no new words arrive and a valid intent is matched
        clearTimeout(silenceDebounceTimer)
        const prospectiveIntent = parseVoiceIntent(cleanInterim)
        if (prospectiveIntent.type !== 'UNKNOWN') {
          silenceDebounceTimer = setTimeout(() => {
            const now = Date.now()
            if (now - lastProcessedTime > 2000 || lastProcessedCommand !== cleanInterim) {
              lastProcessedTime = now
              lastProcessedCommand = cleanInterim
              console.log('🎤 Executing via silence debounce:', cleanInterim)
              onFinalCommand(prospectiveIntent, cleanInterim)
            }
          }, 1200)
        }
      }

      if (cleanFinal) {
        clearTimeout(silenceDebounceTimer)
        const now = Date.now()
        if (now - lastProcessedTime > 2000 || lastProcessedCommand !== cleanFinal) {
          lastProcessedTime = now
          lastProcessedCommand = cleanFinal
          console.log('🎤 Final Clean Transcript:', cleanFinal)
          onInterimResult(cleanFinal)
          const intent = parseVoiceIntent(cleanFinal)
          onFinalCommand(intent, cleanFinal)
        }
      }
    }

    recognition.onerror = (event) => {
      // Benign non-fatal events
      if (event.error === 'no-speech' || event.error === 'network') {
        return
      }

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        shouldKeepListening = false
        onError(
          new Error(
            'Microphone access was denied. Please allow microphone permissions in your browser settings.'
          )
        )
        return
      }

      if (event.error === 'aborted') {
        return
      }

      console.debug('Speech recognition error:', event.error)
      onError(event)
    }

    recognition.onend = () => {
      // If Partner is still active, automatically restart recognition
      if (shouldKeepListening) {
        clearTimeout(restartTimeout)
        restartTimeout = setTimeout(() => {
          if (shouldKeepListening) {
            try {
              recognitionInstance = initRecognition()
            } catch (err) {
              console.debug('Restart recognition error:', err)
            }
          }
        }, 200)
      } else {
        onEnd()
      }
    }

    try {
      recognition.start()
      return recognition
    } catch (err) {
      if (err.name !== 'InvalidStateError') {
        console.debug('Recognition start error:', err)
        onError(err)
      }
      return recognition
    }
  }

  recognitionInstance = initRecognition()
  return recognitionInstance
}

/**
 * Stop active speech recognition completely
 */
export function stopListening() {
  shouldKeepListening = false
  clearTimeout(restartTimeout)
  clearTimeout(silenceDebounceTimer)

  if (recognitionInstance) {
    try {
      recognitionInstance.abort()
    } catch {
      // ignore
    }
    recognitionInstance = null
  }
}

export function isListening() {
  return shouldKeepListening
}
