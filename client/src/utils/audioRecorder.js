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
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function isRecordingSupported() {
  return !!(
    typeof window !== 'undefined' &&
    (isSpeechRecognitionSupported() || (navigator.mediaDevices && navigator.mediaDevices.getUserMedia))
  )
}

export function isRecording() {
  return (
    (recognition !== null) ||
    (mediaRecorder !== null && mediaRecorder.state === 'recording')
  )
}

/**
 * Transcribe audio blob using direct Groq Whisper API (whisper-large-v3) with /api/transcribe fallback
 */
export async function transcribeAudioWithWhisper(audioBlob) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('Suara tidak terdengar jelas, silakan coba lagi.')
  }

  const apiKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim()
  const mimeType = audioBlob.type || 'audio/webm'
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
  const file = new File([audioBlob], `speech.${ext}`, { type: mimeType })

  // 1. Direct Groq Whisper API
  if (apiKey) {
    try {
      const formData = new FormData()
      formData.append('file', file)
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
        const transcript = whisperData.text?.trim() || ''
        if (transcript) return transcript
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
        if (proxyData.text?.trim()) {
          return proxyData.text.trim()
        }
      }
    }
  } catch (proxyErr) {
    console.warn('Serverless proxy transcribe error:', proxyErr.message)
  }

  throw new Error('Suara tidak terdengar jelas atau API Whisper belum terkonfigurasi. Silakan coba lagi.')
}

/**
 * Start Voice Listening with 3-Second Silence Detection and 60-Second Max Duration
 * Continuous listening with real-time live preview words
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

      const resetSilenceTimer = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        // User dianggap selesai bicara jika DIAM selama 3 detik penuh
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

      let retryCount = 0

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
            // fallback below
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
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          onError?.(new Error(`Voice error: ${event.error}`))
        }
      }

      recognition.start()
      resetSilenceTimer()

      // Safety net maksimal: 60 detik (1 menit)
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

  // Fallback: Use MediaRecorder with volume energy silence detection
  startMediaRecorderSilenceFallback({
    onTranscriptChange,
    onStatusChange,
    onComplete,
    onError,
    silenceTimeoutMs,
    maxDurationMs
  })
}

/**
 * Fallback MediaRecorder with Web Audio silence detection
 */
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
      : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : ''

    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined)

    // Setup Web Audio API Analyser for Voice Silence Detection
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

        // Volume threshold for speech detection
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
        onStatusChange?.('⚡ Mentranskripsi via Groq Whisper...')
        const transcript = await transcribeAudioWithWhisper(audioBlob)
        if (transcript) {
          onComplete?.(transcript)
        }
      } catch (err) {
        onError?.(err)
      }
    }

    mediaRecorder.start(100)

    // Safety net maksimal 60 detik
    maxDurationTimer = setTimeout(() => {
      stopVoiceListening()
    }, maxDurationMs)
  } catch (error) {
    onError?.(error)
  }
}

/**
 * Stop active voice listening cleanly
 */
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

/**
 * Cancel and cleanly release microphone stream tracks
 */
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

/**
 * Start raw recording microphone audio (legacy helper)
 */
export async function startRecording() {
  if (!isRecordingSupported()) {
    throw new Error('Browser tidak mendukung perekaman audio.')
  }
  cancelRecording()

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
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
  return { mimeType }
}

/**
 * Stop legacy recording and return combined audio Blob
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
          mediaStream.getTracks().forEach((track) => track.stop())
        } catch {}
        mediaStream = null
      }

      const mimeType = mediaRecorder ? mediaRecorder.mimeType : 'audio/webm'
      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' })
      audioChunks = []

      if (!audioBlob || audioBlob.size === 0) {
        reject(new Error('Suara tidak terdengar jelas, silakan coba lagi.'))
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
 * Process a text command directly with AI or local intent parser
 */
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

/**
 * Stop recording, transcribe via Groq Whisper, and parse intent via Groq Llama 3
 */
export async function stopAndProcessAudio(
  onStatusChange,
  currentTimeISO = new Date().toISOString(),
  activeTasks = []
) {
  onStatusChange?.('⚡ Menghentikan rekaman...')
  const audioBlob = await stopRecording()

  onStatusChange?.('⚡ Mengubah suara ke teks via Groq Whisper...')
  const transcript = await transcribeAudioWithWhisper(audioBlob)

  if (!transcript) {
    throw new Error('Suara tidak terdengar jelas, silakan coba lagi.')
  }

  onStatusChange?.(`🧠 Memproses: "${transcript}"...`)
  const result = await parseCommandWithAI(transcript, currentTimeISO, null, activeTasks)

  return { transcript, result }
}
