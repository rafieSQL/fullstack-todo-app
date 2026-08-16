/**
 * Client-Side Voice Partner Engine (Direct Text-to-LLM Pipeline)
 * Native browser speech recognition + direct Groq Llama 3 Chat Completions.
 * Zero audio blob uploads. Zero backend dependencies. 100% CORS-safe.
 */

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
    throw new Error('VITE_GROQ_API_KEY belum dipasang di .env / Vercel Environment Variables.')
  }

  return new Promise((resolve, reject) => {
    let recognition
    try {
      recognition = new SpeechRecognition()
    } catch (err) {
      reject(new Error(`Failed to initialize Speech Recognition: ${err.message}`))
      return
    }

    recognition.lang = 'id-ID'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.continuous = false

    onStatusChange?.('🎙️ Mendengarkan suara Anda...')

    recognition.onresult = async (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() || ''
      if (!transcript) {
        reject(new Error('Tidak ada suara terdengar. Silakan coba bicara lagi.'))
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
                content: `You are an elite productivity AI. Reference ISO time: ${new Date().toISOString()}.
Parse the user's natural language command (Indonesian/English) into STRICT JSON ONLY without markdown backticks:
{
  "action": "CREATE_TASK" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "title": "Clean extracted title",
  "start_time": "ISO-8601 string or null",
  "end_time": "ISO-8601 string or null",
  "priority": "High" | "Medium" | "Low",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "target_view": "calendar" | "tasks" | "focus" | null,
  "reply_summary": "Pesan konfirmasi singkat bahasa Indonesia"
}`
              },
              { role: 'user', content: transcript }
            ],
            temperature: 0.1
          })
        })

        if (!response.ok) {
          const errBody = await response.text()
          throw new Error(`Groq API returned ${response.status}: ${errBody}`)
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

        resolve({ transcript, result: parsed })
      } catch (err) {
        reject(err)
      }
    }

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        reject(new Error('Tidak ada suara terdengar. Silakan coba bicara lagi.'))
      } else if (event.error === 'not-allowed') {
        reject(new Error('Izin mikrofon ditolak browser.'))
      } else {
        reject(new Error(`Speech error: ${event.error}`))
      }
    }

    try {
      recognition.start()
    } catch (err) {
      reject(err)
    }
  })
}
