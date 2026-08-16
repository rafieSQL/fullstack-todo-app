/**
 * Partner Clean Audio Recorder & Vercel Serverless Bridge
 * Captures raw microphone audio via MediaRecorder and sends base64 payload to /api/partner-voice.
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
        noiseSuppression: true
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
      cancelRecording()
      reject(new Error('No audio captured. Please speak into the mic before stopping.'))
      return
    }

    mediaRecorder.onstop = () => {
      // Always stop tracks to release mic hardware & avoid memory leaks
      if (mediaStream) {
        try {
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
        reject(new Error('No audio captured. Please speak into the mic before stopping.'))
        return
      }

      resolve(audioBlob)
    }

    mediaRecorder.onerror = (event) => {
      cancelRecording()
      reject(event.error || new Error('Recording error occurred.'))
    }

    // Force dump any buffered audio before stopping
    try {
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.requestData()
        mediaRecorder.stop()
      }
    } catch {
      cancelRecording()
      reject(new Error('No audio captured. Please speak into the mic before stopping.'))
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
 * Send audio blob to Vercel Serverless Function (/api/partner-voice)
 */
export async function sendAudioToPartnerVoice(audioBlob, currentTimeISO) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('No audio captured. Please speak into the mic before stopping.')
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(audioBlob)
    reader.onloadend = async () => {
      try {
        const base64Data = reader.result.split(',')[1]
        const response = await fetch('/api/partner-voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: base64Data,
            currentTimeISO: currentTimeISO || new Date().toISOString()
          })
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || `Server responded with ${response.status}`)
        }
        resolve(data)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read recorded audio'))
  })
}
