/**
 * Voice-Back Text-To-Speech (TTS) Engine
 * Attempts browser SpeechSynthesis with /api/tts fallback
 */
export function speakBack(text) {
  if (!text || typeof text !== 'string') return

  const cleanText = text
    .replace(/[#*`_~]/g, '') // remove markdown symbols
    .trim()

  if (!cleanText) return

  // 1. Browser SpeechSynthesis (Instant, Low Latency, Native)
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel() // Stop any previous speech
      const utterance = new SpeechSynthesisUtterance(cleanText)
      utterance.lang = 'id-ID'
      utterance.rate = 1.0
      utterance.pitch = 1.0

      const voices = window.speechSynthesis.getVoices()
      const idVoice = voices.find((v) => v.lang === 'id-ID' || v.lang.startsWith('id'))
      if (idVoice) {
        utterance.voice = idVoice
      }

      window.speechSynthesis.speak(utterance)
      return
    } catch (synthErr) {
      console.warn('SpeechSynthesis error:', synthErr)
    }
  }

  // 2. Serverless /api/tts API fallback
  try {
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText })
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) {
          const audioUrl = URL.createObjectURL(blob)
          const audio = new Audio(audioUrl)
          audio.onended = () => URL.revokeObjectURL(audioUrl)
          audio.play().catch(() => {})
        }
      })
      .catch(() => {})
  } catch {
    // ignore
  }
}
