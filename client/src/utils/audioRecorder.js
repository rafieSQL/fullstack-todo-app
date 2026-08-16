import { parseCommandWithAI } from './aiService.js'

let mediaStream = null
let mediaRecorder = null
let audioChunks = []
let recognition = null
let silenceTimer = null
let maxDurationTimer = null
let audioContext = null
let audioAnalyser = null
let silenceCheckInterval = null

export function isSpeechRecognitionSupported() {
  return (
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  )
}

export function isRecordingSupported() {
  return !!(
    typeof window !== 'undefined' &&
    (isSpeechRecognitionSupported() ||
      (navigator.mediaDevices && navigator.mediaDevices.getUserMedia))
  )
}

export function isRecording() {
  return (
    recognition !== null ||
    (mediaRecorder !== null && mediaRecorder.state === 'recording')
  )
}

/**
 * Transcribe audio blob by sending base64 to /api/transcribe (Gemini / Whisper backend)
 */
export async function transcribeAudioBlob(audioBlob) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('Suara tidak terdengar jelas, silakan coba lagi.')
  }

  const mimeType = audioBlob.type || 'audio/webm'

  // Convert Blob to Base64
  const base64Data = await new Promise((resolve, reject) => {
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

  // 1. Send to serverless /api/transcribe
  try {
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: base64Data,
        mimeType: mimeType.split(';')[0]
      })
    })

    const data = await res.json()
    if (res.ok && data.text) {
      return data.text.trim()
    }
  } catch (apiErr) {
    console.warn('/api/transcribe request failed, attempting direct Groq fallback:', apiErr.message)
  }

  // 2. Direct Groq Whisper API fallback
  const apiKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim()
  if (apiKey) {
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      const file = new File([audioBlob], `speech.${ext}`, { type: mimeType })
      const formData = new FormData()
      formData.append('file', file)
      formData.append('model', 'whisper-large-v3')
      formData.append('language', 'id')

      const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData
      })

      if (whisperRes.ok) {
        const whisperData = await whisperRes.json()
        if (whisperData.text?.trim()) {
          return whisperData.text.trim()
        }
      }
    } catch (whisperErr) {
      console.warn('Direct Whisper fallback failed:', whisperErr.message)
    }
  }

  throw new Error('Gagal mentranskripsikan audio. Silakan coba lagi.')
}

export const transcribeAudioWithWhisper = transcribeAudioBlob

/**
 * Start raw audio recording using native MediaRecorder
 */
export const startRecording = async ({ onStatusChange, onError } = {}) => {
  try {
    cancelRecording()
    audioChunks = []
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4'

    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined)

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data)
      }
    }

    mediaRecorder.start(250) // Capture chunks every 250ms
    onStatusChange?.('🎙️ Merekam suara... Klik tombol mic lagi jika sudah selesai.')
    return { mimeType }
  } catch (err) {
    console.error('MediaRecorder Error:', err)
    cancelRecording()
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      onError?.(new Error('Izin mikrofon ditolak oleh browser.'))
    } else {
      onError?.(new Error('Gagal mengakses hardware mikrofon.'))
    }
  }
}

/**
 * Stop raw audio recording, convert to base64, and transcribe via /api/transcribe
 */
export const stopRecording = async ({ onStatusChange, onError } = {}) => {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      cancelRecording()
      resolve(null)
      return
    }

    onStatusChange?.('⏳ Memproses audio...')

    mediaRecorder.onstop = async () => {
      try {
        const mime = mediaRecorder?.mimeType || 'audio/webm'
        const audioBlob = new Blob(audioChunks, { type: mime })
        audioChunks = []

        if (mediaStream) {
          mediaStream.getTracks().forEach((track) => track.stop())
          mediaStream = null
        }

        if (!audioBlob || audioBlob.size === 0) {
          resolve(null)
          return
        }

        const text = await transcribeAudioBlob(audioBlob)
        resolve(text)
      } catch (err) {
        console.error('Processing Audio Error:', err)
        onError?.(err)
        resolve(null)
      } finally {
        cancelRecording()
      }
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
 * Start Voice Listening with continuous speech, 3-Second Silence Detection and 60-Second Max Duration
 */
export function startVoiceListening({
  onTranscriptChange,
  onStatusChange,
  onComplete,
  onError,
  silenceTimeoutMs = 3000,
  maxDurationMs = 60000
}) {
  stopVoiceListening()

  const SpeechRecognitionClass =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)

  if (SpeechRecognitionClass) {
    try {
      recognition = new SpeechRecognitionClass()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'id-ID'

      let fullTranscript = ''
      let isCompleted = false
      let retryCount = 0

      const resetSilenceTimer = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        silenceTimer = setTimeout(() => {
          if (!isCompleted && recognition) {
            onStatusChange?.('⚡ Mengunci transkrip...')
            try {
              recognition.stop()
            } catch {}
          }
        }, silenceTimeoutMs)
      }

      recognition.onstart = () => {
        onStatusChange?.('🎙️ Mendengarkan suara Anda... (Bicara sekarang)')
        resetSilenceTimer()
      }

      recognition.onresult = (event) => {
        let interimTranscript = ''
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            fullTranscript += event.results[i][0].transcript + ' '
          } else {
            interimTranscript += event.results[i][0].transcript
          }
        }

        const currentText = (fullTranscript + interimTranscript).trim()
        if (currentText) {
          onTranscriptChange?.(currentText)
        }
        resetSilenceTimer()
      }

      recognition.onend = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        if (maxDurationTimer) clearTimeout(maxDurationTimer)

        if (!isCompleted) {
          isCompleted = true
          const finalClean = fullTranscript.trim()
          if (finalClean) {
            onComplete?.(finalClean)
          } else {
            onStatusChange?.('Suara tidak terdeteksi. Silakan coba lagi.')
          }
        }
      }

      recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error)

        if (event.error === 'network' && retryCount < 1) {
          retryCount++
          onStatusChange?.('🔄 Mencoba menghubungkan kembali suara...')
          try {
            recognition.stop()
            setTimeout(() => {
              try {
                if (recognition) recognition.start()
              } catch {
                if (silenceTimer) clearTimeout(silenceTimer)
                if (maxDurationTimer) clearTimeout(maxDurationTimer)
                const netErr = new Error(
                  'Gangguan koneksi suara ke browser. Silakan ketik perintah secara manual.'
                )
                netErr.name = 'NetworkError'
                onError?.(netErr)
              }
            }, 300)
            return
          } catch {
            // fallback
          }
        }

        if (silenceTimer) clearTimeout(silenceTimer)
        if (maxDurationTimer) clearTimeout(maxDurationTimer)

        if (event.error === 'network') {
          const netErr = new Error(
            'Gangguan koneksi suara ke browser. Silakan ketik perintah secara manual.'
          )
          netErr.name = 'NetworkError'
          onError?.(netErr)
        } else if (event.error === 'audio-capture') {
          onError?.(
            new Error(
              'Mikrofon tidak terdeteksi atau sedang dipakai aplikasi lain. Pastikan mic terpasang dan diizinkan.'
            )
          )
        } else if (event.error === 'not-allowed') {
          onError?.(
            new Error('Izin mikrofon ditolak oleh browser. Silakan izinkan akses mic di URL bar.')
          )
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          onError?.(new Error(`Voice error: ${event.error}`))
        }
      }

      recognition.start()
      resetSilenceTimer()

      maxDurationTimer = setTimeout(() => {
        if (!isCompleted && recognition) {
          try {
            recognition.stop()
          } catch {}
        }
      }, maxDurationMs)

      return
    } catch (err) {
      console.warn('SpeechRecognition failed, falling back to MediaRecorder:', err)
    }
  }

  // Fallback: MediaRecorder with Web Audio silence detection
  startMediaRecorderSilenceFallback({
    onTranscriptChange,
    onStatusChange,
    onComplete,
    onError,
    silenceTimeoutMs,
    maxDurationMs
  })
}

async function startMediaRecorderSilenceFallback({
  onStatusChange,
  onComplete,
  onError,
  silenceTimeoutMs = 3000,
  maxDurationMs = 60000
}) {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioChunks = []

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4'

    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined)

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (AudioContextClass) {
      audioContext = new AudioContextClass()
      const source = audioContext.createMediaStreamSource(mediaStream)
      audioAnalyser = audioContext.createAnalyser()
      audioAnalyser.fftSize = 512
      source.connect(audioAnalyser)

      const bufferLength = audioAnalyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      let lastSpeechTime = Date.now()

      silenceCheckInterval = setInterval(() => {
        if (!audioAnalyser || !mediaRecorder || mediaRecorder.state !== 'recording') return
        audioAnalyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i]
        }
        const average = sum / bufferLength

        if (average > 10) {
          lastSpeechTime = Date.now()
        } else if (Date.now() - lastSpeechTime > silenceTimeoutMs) {
          onStatusChange?.('⚡ Mengunci rekaman...')
          stopVoiceListening()
        }
      }, 200)
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.onstart = () => {
      onStatusChange?.('🎙️ Mendengarkan suara Anda... (Bicara sekarang)')
    }

    mediaRecorder.onstop = async () => {
      if (silenceCheckInterval) clearInterval(silenceCheckInterval)
      if (audioContext) {
        try {
          audioContext.close()
        } catch {}
        audioContext = null
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop())
        mediaStream = null
      }

      try {
        const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' })
        audioChunks = []
        if (!audioBlob || audioBlob.size === 0) return
        onStatusChange?.('⚡ Mentranskripsi via /api/transcribe...')
        const transcript = await transcribeAudioBlob(audioBlob)
        if (transcript) {
          onComplete?.(transcript)
        }
      } catch (err) {
        onError?.(err)
      }
    }

    mediaRecorder.start(100)

    maxDurationTimer = setTimeout(() => {
      stopVoiceListening()
    }, maxDurationMs)
  } catch (error) {
    onError?.(error)
  }
}

export function stopVoiceListening() {
  if (silenceTimer) {
    clearTimeout(silenceTimer)
    silenceTimer = null
  }
  if (maxDurationTimer) {
    clearTimeout(maxDurationTimer)
    maxDurationTimer = null
  }
  if (silenceCheckInterval) {
    clearInterval(silenceCheckInterval)
    silenceCheckInterval = null
  }

  if (recognition) {
    try {
      recognition.stop()
    } catch {}
    recognition = null
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    try {
      mediaRecorder.stop()
    } catch {}
  }
}

export function cancelRecording() {
  stopVoiceListening()
  if (mediaStream) {
    try {
      mediaStream.getTracks().forEach((track) => track.stop())
    } catch {}
    mediaStream = null
  }
  mediaRecorder = null
  audioChunks = []
}

export async function processTextCommand(
  text,
  currentTimeISO = new Date().toISOString(),
  activeTasks = []
) {
  const clean = (text || '').trim()
  if (!clean) {
    throw new Error('Perintah tidak boleh kosong.')
  }
  const result = await parseCommandWithAI(clean, currentTimeISO, null, activeTasks)
  return { transcript: clean, result }
}

export async function stopAndProcessAudio(
  onStatusChange,
  currentTimeISO = new Date().toISOString(),
  activeTasks = []
) {
  onStatusChange?.('⚡ Menghentikan rekaman...')
  const transcript = await stopRecording({ onStatusChange })

  if (!transcript) {
    throw new Error('Suara tidak terdengar jelas, silakan coba lagi.')
  }

  onStatusChange?.(`🧠 Memproses: "${transcript}"...`)
  const result = await parseCommandWithAI(transcript, currentTimeISO, null, activeTasks)

  return { transcript, result }
}
