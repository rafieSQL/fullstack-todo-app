let currentAudio = null

/**
 * Clean text from markdown formatting or symbols for smooth voice pronunciation
 */
export function cleanTextForSpeech(text) {
  if (!text) return ''
  return text
    .replace(/[*_~`#\[\]\(\)\{\}>]/g, '')
    .replace(/⚡|🎙️|✓|🤝|🧠|📅|⚠️|🔥|✅/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fallback to browser's native SpeechSynthesis
 */
export function speakWithBrowserSynthesis(text, lang = 'id-ID') {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

  try {
    window.speechSynthesis.cancel() // Stop previous speech
    const utterance = new SpeechSynthesisUtterance(cleanTextForSpeech(text))
    utterance.lang = lang
    utterance.rate = 1.05
    utterance.pitch = 1.0

    // Try to pick an Indonesian voice if available
    const voices = window.speechSynthesis.getVoices()
    const idVoice = voices.find((v) => v.lang && (v.lang.includes('id') || v.lang.includes('ID')))
    if (idVoice) utterance.voice = idVoice

    window.speechSynthesis.speak(utterance)
  } catch (err) {
    console.debug('Browser speech synthesis error:', err)
  }
}

/**
 * Speak back message using Vercel /api/tts (OpenAI TTS) with instant Web Speech fallback
 */
export async function speakBack(message, voice = 'alloy') {
  const clean = cleanTextForSpeech(message)
  if (!clean) return

  // Cancel any currently playing TTS audio
  if (currentAudio) {
    try {
      currentAudio.pause()
      currentAudio.currentTime = 0
    } catch {}
    currentAudio = null
  }

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, voice })
    })

    if (res.ok) {
      const contentType = res.headers.get('content-type') || ''
      if (
        contentType.includes('audio') ||
        contentType.includes('mpeg') ||
        contentType.includes('octet-stream')
      ) {
        const blob = await res.blob()
        if (blob.size > 100) {
          const audioUrl = URL.createObjectURL(blob)
          const audio = new Audio(audioUrl)
          currentAudio = audio
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl)
            if (currentAudio === audio) currentAudio = null
          }
          await audio.play()
          return
        }
      }
    }
  } catch (err) {
    console.warn('Server TTS unavailable, falling back to Web Speech Synthesis:', err.message)
  }

  // Instant fallback to browser SpeechSynthesis if API endpoint returns error or is not reachable
  speakWithBrowserSynthesis(clean, 'id-ID')
}
