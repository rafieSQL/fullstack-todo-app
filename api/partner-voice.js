/**
 * Vercel Serverless Function for Partner Voice Processing
 * Transcribes audio via Groq Whisper and extracts structured action via Groq Llama 3
 */

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-current-time')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const groqApiKey = (process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || '').trim()
    if (!groqApiKey) {
      return res.status(500).json({
        error: 'GROQ_API_KEY is not configured on the server.',
        details: 'Please set GROQ_API_KEY in Vercel Environment Variables.'
      })
    }

    let audioBuffer = null
    let mimeType = 'audio/webm'
    let currentTimeISO = new Date().toISOString()

    // Handle JSON payload with audioBase64
    if (req.body && typeof req.body === 'object') {
      const { audioBase64, mimeType: incomingMime, currentTimeISO: incomingTime } = req.body
      if (audioBase64) {
        audioBuffer = Buffer.from(audioBase64, 'base64')
        if (incomingMime) mimeType = incomingMime
        if (incomingTime) currentTimeISO = incomingTime
      }
    }

    // Handle raw string payload
    if (!audioBuffer && typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body)
        if (parsed.audioBase64) {
          audioBuffer = Buffer.from(parsed.audioBase64, 'base64')
          if (parsed.mimeType) mimeType = parsed.mimeType
          if (parsed.currentTimeISO) currentTimeISO = parsed.currentTimeISO
        }
      } catch {
        // ignore
      }
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({
        error: 'No audio data received.',
        details: 'Expected JSON payload { audioBase64, mimeType, currentTimeISO }'
      })
    }

    // Step A: Speech-to-Text via Groq Whisper (whisper-large-v3)
    const whisperFormData = new FormData()
    const audioBlob = new Blob([audioBuffer], { type: mimeType })
    whisperFormData.append('file', audioBlob, 'voice_recording.webm')
    whisperFormData.append('model', 'whisper-large-v3')
    whisperFormData.append('response_format', 'json')

    const whisperResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`
      },
      body: whisperFormData
    })

    if (!whisperResponse.ok) {
      const errText = await whisperResponse.text()
      console.error('[Vercel Partner Voice] Whisper transcription error:', errText)
      return res.status(502).json({
        error: 'Whisper audio transcription failed',
        details: errText
      })
    }

    const whisperData = await whisperResponse.json()
    const transcript = (whisperData.text || '').trim()

    if (!transcript) {
      return res.status(200).json({
        transcript: '',
        result: {
          action: 'UNKNOWN',
          title: '',
          reply_summary: 'Suara tidak terdeteksi. Silakan coba lagi.'
        }
      })
    }

    // Step B: Intent Reasoning via Groq Llama 3 (llama-3.3-70b-versatile)
    const systemPrompt = `You are an intelligent task & calendar assistant for a productivity application.
Extract task/schedule actions from the user's Indonesian or English command.
Current local ISO time: ${currentTimeISO}.

Return STRICT JSON ONLY matching this schema without markdown blocks:
{
  "action": "CREATE_TASK" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "title": "Concise task or event title (omit command verbs like 'tambah' or 'add')",
  "start_time": "ISO-8601 string or null",
  "end_time": "ISO-8601 string or null",
  "priority": "High" | "Medium" | "Low",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "target_view": "calendar" | "tasks" | "focus" | null,
  "reply_summary": "Friendly Indonesian acknowledgment (e.g. 'Tugas [judul] berhasil ditambahkan', 'Jadwal [judul] diatur pukul [jam]')"
}`

    const llamaResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `User Command: "${transcript}"` }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!llamaResponse.ok) {
      const errText = await llamaResponse.text()
      console.error('[Vercel Partner Voice] Llama reasoning error:', errText)
      return res.status(502).json({
        error: 'Llama intent reasoning failed',
        transcript,
        details: errText
      })
    }

    const llamaData = await llamaResponse.json()
    const content = llamaData.choices?.[0]?.message?.content || '{}'

    let result
    try {
      result = JSON.parse(content)
    } catch {
      const match = content.match(/\{[\s\S]*\}/)
      result = match ? JSON.parse(match[0]) : { action: 'UNKNOWN', reply_summary: content }
    }

    return res.status(200).json({
      transcript,
      result: {
        action: result.action || 'UNKNOWN',
        title: (result.title || '').trim(),
        start_time: result.start_time || null,
        end_time: result.end_time || null,
        priority: result.priority || 'Medium',
        category: result.category || 'General',
        target_view: result.target_view || null,
        reply_summary: result.reply_summary || `Perintah diproses: "${transcript}"`
      }
    })
  } catch (error) {
    console.error('[Vercel Partner Voice] Server error:', error)
    return res.status(500).json({
      error: 'Internal server error while processing partner voice command.',
      details: error.message
    })
  }
}
