/**
 * Partner Clean Audio Recorder Utility
 * Zero SpeechRecognition dependencies. Uses native navigator.mediaDevices.getUserMedia and MediaRecorder.
 */

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
 * Send audio blob to serverless / backend Groq Whisper + Llama 3 pipeline
 */
export async function sendAudioToPartnerVoice(
  audioBlob,
  currentTimeISO = new Date().toISOString()
) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('Audio recording is empty.')
  }

  const formData = new FormData()
  formData.append('audio', audioBlob, 'voice_recording.webm')
  formData.append('currentTimeISO', currentTimeISO)

  const endpoints = ['/api/partner-voice', 'http://localhost:5000/api/partner-voice']
  let lastError = null

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-current-time': currentTimeISO
        },
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          errorData.error || errorData.details || `Server responded with status ${response.status}`
        )
      }

      const data = await response.json()
      return data
    } catch (err) {
      lastError = err
      console.warn(`Partner voice call failed on ${url}:`, err.message)
    }
  }

  throw lastError || new Error('Could not reach Partner voice processing server.')
}
