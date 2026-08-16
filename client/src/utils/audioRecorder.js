/**
 * Partner Clean Audio Recorder & Direct Client-Side Groq AI Pipeline
 * 100% Client-Side Direct Execution (Zero Server /api/ Dependencies).
 * Captures raw microphone audio via MediaRecorder and calls Groq Whisper & Llama 3 directly.
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
 * Send audio blob directly to Groq API (Whisper + Llama 3) from client side
 */
export async function sendAudioToPartnerVoice(
  audioBlob,
  currentTimeISO = new Date().toISOString()
) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('No audio captured. Please speak into the mic before stopping.')
  }

  const GROQ_API_KEY = (import.meta.env.VITE_GROQ_API_KEY || '').trim()
  if (!GROQ_API_KEY) {
    throw new Error('Groq API Key is missing in .env!')
  }

  // ==========================================
  // STEP A: Speech-to-Text (Whisper)
  // Target: https://api.groq.com/openai/v1/audio/transcriptions
  // ==========================================
  const formData = new FormData()
  formData.append('file', audioBlob, 'recording.webm')
  formData.append('model', 'whisper-large-v3')
  formData.append('language', 'id')
  formData.append('response_format', 'json')

  const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`
    },
    body: formData
  })

  if (!whisperRes.ok) {
    const errData = await whisperRes.json().catch(() => ({}))
    throw new Error(errData.error?.message || `Whisper Error: ${whisperRes.status}`)
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

  console.log('[Partner Voice] Transcribed:', transcript)

  // ==========================================
  // STEP B: Structured Intent Extraction (Llama 3)
  // Target: https://api.groq.com/openai/v1/chat/completions
  // ==========================================
  const systemPrompt = `You are an elite productivity AI. Reference ISO time: ${currentTimeISO}. Parse the Indonesian/English transcript into STRICT JSON without markdown:
{
  "action": "CREATE_TASK" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "title": "concise clean title",
  "start_time": "ISO string or null",
  "end_time": "ISO string or null",
  "priority": "High" | "Medium" | "Low",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "target_view": "calendar" | "tasks" | "focus" | null,
  "reply_summary": "Indonesian feedback message"
}`

  const chatRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        { role: 'user', content: transcript }
      ],
      temperature: 0.1
    })
  })

  if (!chatRes.ok) {
    const errData = await chatRes.json().catch(() => ({}))
    throw new Error(errData.error?.message || `Groq LLM Error: ${chatRes.status}`)
  }

  const chatData = await chatRes.json()
  const rawContent = (chatData.choices?.[0]?.message?.content || '{}')
    .replace(/```(?:json)?|```/g, '')
    .trim()

  let parsedResult
  try {
    parsedResult = JSON.parse(rawContent)
  } catch {
    const match = rawContent.match(/\{[\s\S]*\}/)
    parsedResult = match ? JSON.parse(match[0]) : { action: 'UNKNOWN', reply_summary: rawContent }
  }

  console.log('[Partner Voice] Action result:', parsedResult)

  return {
    transcript,
    result: {
      action: parsedResult.action || 'UNKNOWN',
      title: (parsedResult.title || '').trim(),
      start_time: parsedResult.start_time || null,
      end_time: parsedResult.end_time || null,
      priority: parsedResult.priority || 'Medium',
      category: parsedResult.category || 'General',
      target_view: parsedResult.target_view || null,
      reply_summary: parsedResult.reply_summary || `Perintah diproses: "${transcript}"`
    }
  }
}
