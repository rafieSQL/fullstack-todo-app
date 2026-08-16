/**
 * Client-Side Voice Partner Engine (Direct Text-to-LLM Pipeline)
 * Native browser speech recognition + direct Groq Llama 3 Chat Completions.
 * Zero audio blob uploads. Zero backend dependencies. 100% CORS-safe.
 */

let activeRecognition = null

export function isSpeechRecognitionSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function isRecordingSupported() {
  return isSpeechRecognitionSupported()
}

/**
 * Captures speech from the browser microphone and directly processes
 * intent via Groq Chat Completions API.
 */
export async function listenAndProcessSpeech(onStatusChange) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

  if (!SpeechRecognition) {
    throw new Error('Browser Anda belum mendukung Speech Recognition. Gunakan Chrome atau Edge.')
  }

  const apiKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('Missing VITE_GROQ_API_KEY in environment (.env or Vercel Environment Variables).')
  }

  // Abort any existing running recognition session
  if (activeRecognition) {
    try {
      activeRecognition.abort()
    } catch {
      // ignore
    }
    activeRecognition = null
  }

  return new Promise((resolve, reject) => {
    let recognition
    try {
      recognition = new SpeechRecognition()
    } catch (err) {
      reject(new Error(`Failed to initialize Speech Recognition: ${err.message}`))
      return
    }

    activeRecognition = recognition
    recognition.lang = 'id-ID'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.continuous = false

    let hasResolved = false
    const cleanup = () => {
      activeRecognition = null
    }

    onStatusChange?.('🎙️ Mendengarkan suara Anda...')

    recognition.onresult = async (event) => {
      if (hasResolved) return
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() || ''
      if (!transcript) {
        hasResolved = true
        cleanup()
        reject(new Error('No speech detected, try again.'))
        return
      }

      onStatusChange?.(`⚡ Memproses: "${transcript}"...`)

      try {
        // Send pure text to Groq LLM (CORS-safe standard REST JSON)
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              {
                role: 'system',
                content: `You are an elite productivity AI assistant. Reference ISO time: ${new Date().toISOString()}.
Parse the user's natural language command (Indonesian or English) into STRICT JSON ONLY without markdown backticks:
{
  "action": "CREATE_TASK" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "title": "Clean concise task or event title (omit command words like 'tambah', 'bikin', 'add')",
  "start_time": "ISO-8601 string or null",
  "end_time": "ISO-8601 string or null",
  "priority": "High" | "Medium" | "Low",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "target_view": "calendar" | "tasks" | "focus" | null,
  "reply_summary": "Pesan konfirmasi singkat bahasa Indonesia (e.g. 'Tugas [judul] berhasil ditambahkan')"
}`
              },
              { role: 'user', content: transcript }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
          })
        })

        if (!response.ok) {
          const errBody = await response.text().catch(() => '')
          throw new Error(`Groq API returned ${response.status}: ${errBody || response.statusText}`)
        }

        const data = await response.json()
        const rawContent = (data.choices?.[0]?.message?.content || '{}')
          .replace(/```(?:json)?|```/g, '')
          .trim()

        let parsed
        try {
          parsed = JSON.parse(rawContent)
        } catch {
          const match = rawContent.match(/\{[\s\S]*\}/)
          parsed = match ? JSON.parse(match[0]) : { action: 'UNKNOWN', reply_summary: rawContent }
        }

        hasResolved = true
        cleanup()
        resolve({ transcript, result: parsed })
      } catch (err) {
        hasResolved = true
        cleanup()
        reject(err)
      }
    }

    recognition.onerror = (event) => {
      if (hasResolved) return
      hasResolved = true
      cleanup()
      if (event.error === 'no-speech') {
        reject(new Error('No speech detected, try again.'))
      } else if (event.error === 'not-allowed') {
        reject(new Error('Microphone permission denied by browser.'))
      } else {
        reject(new Error(`Speech recognition error: ${event.error}`))
      }
    }

    recognition.onend = () => {
      cleanup()
    }

    try {
      recognition.start()
    } catch (err) {
      hasResolved = true
      cleanup()
      reject(new Error(`Could not start microphone listener: ${err.message}`))
    }
  })
}
