/**
 * Partner Groq Whisper Audio Recorder & AI Intent Pipeline
 * Native MediaRecorder microphone capture + direct Groq Whisper STT + Groq Llama 3 Intent Reasoning.
 * Works seamlessly across Brave, Chrome, Edge, Safari, Firefox without Web Speech network issues.
 */

import { parseCommandWithAI } from './aiService.js'

let mediaStream = null
let mediaRecorder = null
let audioChunks = []
let isRecordingState = false

export function isRecordingSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(
    window.navigator &&
      window.navigator.mediaDevices &&
      typeof window.navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window.MediaRecorder === 'function'
  )
}

export function isSpeechRecognitionSupported() {
  return isRecordingSupported()
}

function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'

  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/wav'
  ]

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }

  return 'audio/webm'
}

/**
 * Start recording microphone audio
 */
export async function startRecording() {
  if (!isRecordingSupported()) {
    throw new Error('Perekaman audio tidak didukung di browser ini.')
  }

  cancelRecording()

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    const mimeType = getSupportedMimeType()
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType })
    audioChunks = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data)
      }
    }

    mediaRecorder.start(100) // Chunk every 100ms
    isRecordingState = true
    return { mimeType }
  } catch (error) {
    isRecordingState = false
    cancelRecording()
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      throw new Error(
        'Izin mikrofon ditolak oleh browser. Harap izinkan akses mikrofon di pengaturan browser Anda.'
      )
    }
    throw error
  }
}

/**
 * Stop recording and return combined audio Blob
 */
export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      cancelRecording()
      reject(new Error('Tidak ada rekaman suara aktif.'))
      return
    }

    mediaRecorder.onstop = () => {
      if (mediaStream) {
        try {
          if (mediaStream._autoStopTimer) {
            clearTimeout(mediaStream._autoStopTimer)
          }
          mediaStream.getTracks().forEach((track) => track.stop())
        } catch {
          // ignore
        }
        mediaStream = null
      }

      const mimeType = mediaRecorder ? mediaRecorder.mimeType : getSupportedMimeType()
      const audioBlob = new Blob(audioChunks, { type: mimeType })
      audioChunks = []
      isRecordingState = false

      if (!audioBlob || audioBlob.size === 0) {
        reject(new Error('Tidak ada suara terdeteksi. Silakan coba bicara lagi.'))
        return
      }

      resolve(audioBlob)
    }

    mediaRecorder.onerror = (event) => {
      cancelRecording()
      reject(event.error || new Error('Terjadi kesalahan saat merekam suara.'))
    }

    try {
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.requestData()
        mediaRecorder.stop()
      }
    } catch {
      cancelRecording()
      reject(new Error('Gagal menghentikan rekaman suara.'))
    }
  })
}

/**
 * Cancel and cleanly release microphone stream tracks
 */
export function cancelRecording() {
  isRecordingState = false
  if (mediaStream) {
    try {
      if (mediaStream._autoStopTimer) {
        clearTimeout(mediaStream._autoStopTimer)
      }
      mediaStream.getTracks().forEach((track) => track.stop())
    } catch {
      // ignore
    }
    mediaStream = null
  }
  mediaRecorder = null
  audioChunks = []
}

export function isRecording() {
  return isRecordingState
}

/**
 * Transcribe audio blob using Groq Whisper API (whisper-large-v3)
 */
export async function transcribeAudioWithWhisper(audioBlob) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('Tidak ada data suara untuk ditranskripsi.')
  }

  const apiKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('VITE_GROQ_API_KEY belum dipasang di environment.')
  }

  const formData = new FormData()
  formData.append('file', audioBlob, 'audio.webm')
  formData.append('model', 'whisper-large-v3')
  formData.append('language', 'id')
  formData.append('response_format', 'json')

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Groq Whisper gagal (${res.status}): ${errText || res.statusText}`)
  }

  const data = await res.json()
  return (data.text || '').trim()
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
 * Stop recording, transcribe via Groq Whisper, and parse intent via Groq Llama 3
 */
export async function stopAndProcessAudio(onStatusChange, currentTimeISO = new Date().toISOString()) {
  onStatusChange?.('⚡ Menghentikan rekaman...')
  const audioBlob = await stopRecording()

  onStatusChange?.('⚡ Mentranskripsi suara via Groq Whisper...')
  const transcript = await transcribeAudioWithWhisper(audioBlob)

  if (!transcript) {
    throw new Error('Tidak ada suara terdengar. Silakan coba bicara lagi.')
  }

  onStatusChange?.(`⚡ Memproses niat: "${transcript}"...`)
  const result = await parseCommandWithAI(transcript, currentTimeISO)

  return { transcript, result }
}

/**
 * Listen and process speech (starts recording, auto-stops after duration or processes immediately)
 */
export async function listenAndProcessSpeech(onStatusChange) {
  await startRecording()
  onStatusChange?.('🎙️ Merekam suara... Bicara sekarang (tekan V jika sudah selesai)')

  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      try {
        const res = await stopAndProcessAudio(onStatusChange)
        resolve(res)
      } catch (err) {
        reject(err)
      }
    }, 5000)

    if (mediaStream) {
      mediaStream._autoStopTimer = timer
    }
  })
}
