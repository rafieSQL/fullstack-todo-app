import { parseCommandWithAI } from './aiService.js'

let mediaStream = null
let mediaRecorder = null
let audioChunks = []
let recordingStartTime = 0

export function isRecordingSupported() {
  return !!(
    typeof window !== 'undefined' &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia
  )
}

export function isSpeechRecognitionSupported() {
  return isRecordingSupported()
}

export function isRecording() {
  return mediaRecorder && mediaRecorder.state === 'recording'
}

/**
 * Transcribe audio blob using direct Groq Whisper API (whisper-large-v3) with /api/transcribe fallback
 */
export async function transcribeAudioWithWhisper(audioBlob) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('Suara tidak terdengar jelas, silakan coba lagi.')
  }

  console.log('Audio Blob Size:', audioBlob.size, 'bytes', 'Type:', audioBlob.type)

  const apiKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim()
  const mimeType = audioBlob.type || 'audio/webm'
  const file = new File([audioBlob], 'audio.webm', { type: mimeType || 'audio/webm' })

  // 1. Direct Groq Whisper API (whisper-large-v3)
  if (apiKey) {
    try {
      const formData = new FormData()
      formData.append('file', file, 'audio.webm')
      formData.append('model', 'whisper-large-v3')
      formData.append('language', 'id')

      const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: formData
      })

      if (whisperRes.ok) {
        const whisperData = await whisperRes.json()
        const transcriptText = whisperData.text !== undefined && whisperData.text !== null
          ? String(whisperData.text).trim()
          : ''
        console.log('Whisper raw transcript:', transcriptText)
        if (transcriptText) return transcriptText
      } else {
        const errText = await whisperRes.text().catch(() => '')
        console.warn(`Direct Groq Whisper API returned ${whisperRes.status}: ${errText}`)
      }
    } catch (directErr) {
      console.warn('Direct Groq Whisper failed, trying serverless proxy:', directErr.message)
    }
  }

  // 2. Serverless proxy fallback (/api/transcribe)
  try {
    const base64String = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const res = reader.result
        if (typeof res === 'string') {
          resolve(res.includes(',') ? res.split(',')[1] : res)
        } else {
          resolve('')
        }
      }
      reader.onerror = reject
      reader.readAsDataURL(audioBlob)
    })

    if (base64String) {
      const proxyRes = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: base64String, mimeType })
      })

      if (proxyRes.ok) {
        const proxyData = await proxyRes.json()
        const proxyTranscript = proxyData.text !== undefined && proxyData.text !== null
          ? String(proxyData.text).trim()
          : ''
        console.log('Whisper raw transcript:', proxyTranscript)
        if (proxyTranscript) {
          return proxyTranscript
        }
      }
    }
  } catch (proxyErr) {
    console.warn('Serverless proxy transcribe error:', proxyErr.message)
  }

  if (!apiKey) {
    throw new Error('VITE_GROQ_API_KEY belum dikonfigurasi di file environment .env.')
  }

  throw new Error('Suara tidak terdengar jelas atau mikrofon terlalu jauh. Silakan coba lagi.')
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
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      })
    } catch {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    }

    audioChunks = []

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : ''

    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined)

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.start(100)
    recordingStartTime = Date.now()
    return { mimeType }
  } catch (error) {
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

    const recorder = mediaRecorder
    const stream = mediaStream

    recorder.onstop = () => {
      const mimeType = recorder ? recorder.mimeType : 'audio/webm'
      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' })
      audioChunks = []

      // Matikan hardware tracks SETELAH blob terkumpul sempurna
      if (stream) {
        try {
          stream.getTracks().forEach((t) => {
            try {
              t.stop()
            } catch {
              // ignore
            }
          })
        } catch {
          // ignore
        }
      }
      mediaStream = null
      mediaRecorder = null

      if (!audioBlob || audioBlob.size === 0) {
        reject(new Error('Audio recording is empty'))
        return
      }

      resolve(audioBlob)
    }

    recorder.onerror = (event) => {
      cancelRecording()
      reject(event.error || new Error('Terjadi kesalahan saat merekam suara.'))
    }

    const elapsed = Date.now() - recordingStartTime
    const minDelay = Math.max(0, 300 - elapsed)

    setTimeout(() => {
      try {
        if (recorder.state !== 'inactive') {
          recorder.requestData()
          recorder.stop()
        }
      } catch {
        cancelRecording()
        reject(new Error('Gagal menghentikan rekaman suara.'))
      }
    }, minDelay)
  })
}

/**
 * Cancel and cleanly release microphone stream tracks
 */
export function cancelRecording() {
  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // ignore
        }
      })
    } catch {
      // ignore
    }
    mediaStream = null
  }
  mediaRecorder = null
  audioChunks = []
}

/**
 * Process a text command directly with AI or local intent parser
 */
export async function processTextCommand(text, currentTimeISO = new Date().toISOString(), existingTasks = []) {
  const clean = (text || '').trim()
  if (!clean) {
    throw new Error('Perintah tidak boleh kosong.')
  }
  const taskTitles = Array.isArray(existingTasks)
    ? existingTasks.map((t) => (typeof t === 'string' ? t : t.title)).filter(Boolean)
    : []
  const result = await parseCommandWithAI(clean, currentTimeISO, taskTitles)
  return { transcript: clean, result }
}

/**
 * Stop recording, transcribe via Groq Whisper, and parse intent via Groq Llama 3
 */
export async function stopAndProcessAudio(onStatusChange, currentTimeISO = new Date().toISOString(), existingTasks = []) {
  onStatusChange?.('⚡ Menghentikan rekaman...')
  const audioBlob = await stopRecording()

  onStatusChange?.('⚡ Mengubah suara ke teks via Groq Whisper...')
  const transcript = await transcribeAudioWithWhisper(audioBlob)

  if (!transcript) {
    throw new Error('Suara tidak terdengar jelas, silakan coba lagi.')
  }

  onStatusChange?.(`🧠 Memproses: "${transcript}"...`)
  const taskTitles = Array.isArray(existingTasks)
    ? existingTasks.map((t) => (typeof t === 'string' ? t : t.title)).filter(Boolean)
    : []
  const result = await parseCommandWithAI(transcript, currentTimeISO, taskTitles)

  return { transcript, result }
}

/**
 * Listen and process speech (starts recording, auto-stops after 4 seconds or processes immediately)
 */
export async function listenAndProcessSpeech(onStatusChange) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY

  if (!apiKey) {
    throw new Error('VITE_GROQ_API_KEY belum disetel di environment variables!')
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  audioChunks = []

  // Gunakan MIME type yang didukung browser
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
    ? 'audio/webm'
    : MediaRecorder.isTypeSupported('audio/mp4')
    ? 'audio/mp4'
    : ''

  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

  return new Promise((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.onstart = () => {
      onStatusChange?.('🎙️ Mendengarkan suara Anda... (Bicara sekarang)')
    }

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop())
      onStatusChange?.('⚡ Mengubah suara ke teks via Groq Whisper...')

      try {
        const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' })
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
        const file = new File([audioBlob], `speech.${ext}`, { type: mimeType || 'audio/webm' })

        const formData = new FormData()
        formData.append('file', file)
        formData.append('model', 'whisper-large-v3')
        formData.append('language', 'id')

        // Request langsung ke Groq Whisper
        const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`
          },
          body: formData
        })

        if (!whisperRes.ok) {
          const errText = await whisperRes.text()
          throw new Error(`Whisper API gagal (${whisperRes.status}): ${errText}`)
        }

        const whisperData = await whisperRes.json()
        const transcript = whisperData.text?.trim() || ''

        if (!transcript) {
          throw new Error('Suara tidak terdengar jelas, silakan coba lagi.')
        }

        onStatusChange?.(`🧠 Memproses: "${transcript}"...`)
        const result = await parseCommandWithAI(transcript, new Date().toISOString())
        resolve({ transcript, result })
      } catch (err) {
        reject(err)
      }
    }

    mediaRecorder.start()

    // Hentikan rekaman otomatis setelah 4 detik bicara
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop()
      }
    }, 4000)
  })
}
