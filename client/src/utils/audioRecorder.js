import { parseCommandWithAI } from './aiService.js'

let mediaStream = null
let mediaRecorder = null
let audioChunks = []
let isRecordingState = false

export function isRecordingSupported() {
  if (typeof window === 'undefined') return false
  return !!(
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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const res = reader.result
      if (typeof res === 'string') {
        const base64String = res.includes(',') ? res.split(',')[1] : res
        resolve(base64String)
      } else {
        resolve('')
      }
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Transcribe audio blob using Vercel Serverless proxy (/api/transcribe)
 */
export async function transcribeAudioWithWhisper(audioBlob) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('Tidak ada data suara untuk ditranskripsi.')
  }

  const mimeType = audioBlob.type || 'audio/webm'
  const audioBase64 = await blobToBase64(audioBlob)

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, mimeType })
  })

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    throw new Error(errData.error || `Server transcribe error (${res.status})`)
  }

  const { text } = await res.json()
  if (!text || !text.trim()) {
    throw new Error('Suara tidak terdeteksi jelas, silakan coba lagi.')
  }

  return text.trim()
}

/**
 * Start recording microphone audio
 */
export async function startRecording() {
  if (!isRecordingSupported()) {
    throw new Error('Browser tidak mendukung perekaman audio.')
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
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined)
    audioChunks = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data)
      }
    }

    mediaRecorder.start(100)
    isRecordingState = true
    return { mimeType }
  } catch (error) {
    isRecordingState = false
    cancelRecording()
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      throw new Error(
        'Izin mikrofon ditolak oleh browser. Harap izinkan akses mikrofon di pengaturan browser Anda.',
        { cause: error }
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
      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' })
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
 * Stop recording, transcribe via /api/transcribe, and parse intent via Groq Llama 3
 */
export async function stopAndProcessAudio(onStatusChange, currentTimeISO = new Date().toISOString()) {
  onStatusChange?.('⚡ Menghentikan rekaman...')
  const audioBlob = await stopRecording()

  onStatusChange?.('⚡ Mengubah suara ke teks...')
  const transcript = await transcribeAudioWithWhisper(audioBlob)

  onStatusChange?.(`🧠 Memproses: "${transcript}"...`)
  const result = await parseCommandWithAI(transcript, currentTimeISO)

  return { transcript, result }
}

/**
 * Listen and process speech (starts recording, auto-stops after duration or processes immediately)
 */
export async function listenAndProcessSpeech(onStatusChange) {
  if (!isRecordingSupported()) {
    throw new Error('Browser tidak mendukung perekaman audio.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  audioChunks = []

  const mimeType = MediaRecorder.isTypeSupported('audio/webm')
    ? 'audio/webm'
    : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : ''

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

  return new Promise((resolve, reject) => {
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data)
      }
    }

    mediaRecorder.onstart = () => {
      onStatusChange?.('🎙️ Mendengarkan suara Anda... (Bicara sekarang, berhenti otomatis dalam 5 dtk)')
    }

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop())
      onStatusChange?.('⚡ Mengubah suara ke teks...')

      try {
        const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' })
        const base64 = await blobToBase64(audioBlob)

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64: base64, mimeType: mimeType || 'audio/webm' })
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData.error || `Server transcribe error (${res.status})`)
        }

        const { text } = await res.json()
        if (!text || !text.trim()) {
          throw new Error('Suara tidak terdeteksi jelas, silakan coba lagi.')
        }

        onStatusChange?.(`🧠 Memproses: "${text}"...`)
        const result = await parseCommandWithAI(text, new Date().toISOString())
        resolve({ transcript: text, result })
      } catch (err) {
        reject(err)
      }
    }

    mediaRecorder.start()

    // Auto-stop recording after 4.5 seconds of speaking
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop()
      }
    }, 4500)
  })
}
