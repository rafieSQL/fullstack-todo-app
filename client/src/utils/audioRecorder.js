/**
 * Client-Side Voice Partner Engine (Direct Text-to-LLM with Zero-Fail Fallback)
 * Native browser speech recognition + direct Groq Llama 3 Chat Completions + Local Rule Engine Fallback.
 * Zero audio blob uploads. Zero backend /api dependencies. 100% CORS-safe.
 */

import { parseCommandWithAI } from './aiService.js'

let activeRecognition = null

export function isSpeechRecognitionSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function isRecordingSupported() {
  return isSpeechRecognitionSupported()
}

/**
 * Process a text command directly with AI or local intent parser
 */
export async function processTextCommand(text, currentTimeISO = new Date().toISOString()) {
  const clean = (text || '').trim()
  if (!clean) {
    throw new Error('Perintah tidak boleh kosong.')
  }
  const result = await parseCommandWithAI(clean, currentTimeISO)
  return { transcript: clean, result }
}

/**
 * Captures speech from the browser microphone and processes
 * intent via Groq Chat Completions API with zero-fail fallback.
 */
export async function listenAndProcessSpeech(onStatusChange) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

  if (!SpeechRecognition) {
    throw new Error('Browser Anda belum mendukung Speech Recognition. Gunakan Chrome atau Edge.')
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
        const result = await parseCommandWithAI(transcript, new Date().toISOString())
        hasResolved = true
        cleanup()
        resolve({ transcript, result })
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
        reject(new Error('Izin mikrofon ditolak browser.'))
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
