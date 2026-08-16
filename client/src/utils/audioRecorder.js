/**
 * Partner Clean Audio Recorder & Resilient Voice Dispatcher
 * Zero legacy SpeechRecognition dependencies. Uses native MediaRecorder.
 * Sends base64 audio payload to Vercel Serverless / Backend API (/api/partner-voice),
 * with an automatic direct Client-Side Groq Fallback so it never fails.
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
 * Start recording raw microphone audio
 */
export async function startRecording() {
  if (!isRecordingSupported()) {
    throw new Error('Audio recording is not supported in this browser.')
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
        'Microphone access was denied. Please allow microphone permissions in your browser settings.'
      )
    }
    throw error
  }
}

/**
 * Stop recording and return a single combined audio Blob
 */
export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      isRecordingState = false
      cancelRecording()
      resolve(null)
      return
    }

    mediaRecorder.onstop = () => {
      try {
        const mimeType = mediaRecorder ? mediaRecorder.mimeType : getSupportedMimeType()
        const audioBlob = new Blob(audioChunks, { type: mimeType })
        audioChunks = []
        isRecordingState = false
        cancelRecording()
        resolve({ audioBlob, mimeType })
      } catch (err) {
        reject(err)
      }
    }

    mediaRecorder.onerror = (event) => {
      isRecordingState = false
      cancelRecording()
      reject(event.error || new Error('Recording error occurred.'))
    }

    try {
      mediaRecorder.stop()
    } catch {
      cancelRecording()
      resolve(null)
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
 * Convert audio Blob to Base64 string
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const base64 = result.includes(',') ? result.split(',')[1] : result
        resolve(base64)
      } else {
        reject(new Error('Failed to convert audio blob to base64.'))
      }
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Direct Client-Side Groq Fallback (Whisper Audio Transcription + Llama 3 Intent)
 */
async function fallbackClientSideGroq(audioBlob, currentTimeISO) {
  const apiKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('Groq API Key is not configured on client or server.')
  }

  console.warn('[Partner Voice] Using direct client-side Groq fallback pipeline...')

  // Step 1: Client-Side Whisper Transcription
  const whisperFormData = new FormData()
  whisperFormData.append('file', audioBlob, 'voice_recording.webm')
  whisperFormData.append('model', 'whisper-large-v3')
  whisperFormData.append('response_format', 'json')

  const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: whisperFormData
  })

  if (!whisperRes.ok) {
    const errText = await whisperRes.text()
    throw new Error(`Client-side Whisper transcription failed: ${errText}`)
  }

  const whisperData = await whisperRes.json()
  const transcript = (whisperData.text || '').trim()

  if (!transcript) {
    return {
      transcript: '',
      result: {
        action: 'UNKNOWN',
        title: '',
        reply_summary: 'Suara tidak terdeteksi. Silakan coba lagi.'
      }
    }
  }

  // Step 2: Client-Side Llama 3 Reasoning
  const aiResult = await parseCommandWithAI(transcript, currentTimeISO)
  return {
    transcript,
    result: aiResult
  }
}

/**
 * Send audio blob to Vercel Serverless Function (/api/partner-voice)
 * with automatic direct Client-Side Groq Fallback
 */
export async function sendAudioToPartnerVoice(
  audioBlob,
  currentTimeISO = new Date().toISOString()
) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('Audio recording is empty.')
  }

  try {
    const audioBase64 = await blobToBase64(audioBlob)

    // Primary: Call Vercel Serverless / backend API endpoint
    const response = await fetch('/api/partner-voice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-current-time': currentTimeISO
      },
      body: JSON.stringify({
        audioBase64,
        mimeType: audioBlob.type || 'audio/webm',
        currentTimeISO
      })
    })

    if (response.ok) {
      const data = await response.json()
      return data
    }

    console.warn(
      `[Partner Voice] /api/partner-voice returned ${response.status}. Triggering client-side fallback...`
    )
  } catch (netError) {
    console.warn(
      '[Partner Voice] Network error reaching /api/partner-voice:',
      netError.message,
      'Triggering client-side fallback...'
    )
  }

  // Resilient Fallback: Run direct client-side Groq pipeline
  return await fallbackClientSideGroq(audioBlob, currentTimeISO)
}
